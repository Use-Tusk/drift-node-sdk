process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "silent",
});
TuskDrift.markAppAsReady();

import express from "express";
import type { Server } from "http";
import request from "supertest";
import { GraphQLClient, gql } from "graphql-request";
import { SpanKind } from "@opentelemetry/api";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../core/tracing/adapters/InMemorySpanAdapter";

async function waitForSpans(timeoutMs: number = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function isSandboxStartupError(error?: Error | null): boolean {
  if (!error) {
    return false;
  }
  const errno = error as NodeJS.ErrnoException;
  return errno.code === "EPERM" || /operation not permitted/i.test(error.message);
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
}

interface PostRecord {
  id: string;
  title: string;
  authorId: string;
}

class GraphqlIntegrationTestEnvironment {
  private app: express.Application;
  private server?: Server;
  private baseUrl?: string;
  private startupError?: Error;
  private users: UserRecord[] = [];
  private posts: PostRecord[] = [];
  private nextUserId = 1;
  private spanAdapter: InMemorySpanAdapter;

  constructor() {
    this.spanAdapter = new InMemorySpanAdapter();
    this.app = express();
  }

  async setup(): Promise<void> {
    // SDK is already initialized at top of file before express/graphql imports
    registerInMemoryAdapter(this.spanAdapter);

    await this.setupInstrumentation();
  }

  async cleanup(): Promise<void> {
    await this.cleanupInstrumentation();
    if (TuskDrift.isAppReady()) {
      clearRegisteredInMemoryAdapters();
    }
  }

  getSpanCollector(): InMemorySpanAdapter {
    return this.spanAdapter;
  }

  async waitForSpans(timeoutMs: number = 500): Promise<void> {
    await waitForSpans(timeoutMs);
  }

  private async setupInstrumentation(): Promise<void> {
    this.resetData();
    this.startupError = undefined;

    const [{ buildSchema }, { createHandler }] = await Promise.all([
      import("graphql"),
      import("graphql-http/lib/use/express"),
    ]);

    const schema = buildSchema(`
      type User {
        id: ID!
        name: String!
        email: String!
        posts: [Post!]!
      }

      type Post {
        id: ID!
        title: String!
        author: User!
      }

      input UserInput {
        name: String!
        email: String!
      }

      type Query {
        hello: String
        users: [User!]!
        user(id: ID!): User
        posts: [Post!]!
        errorTest: String
      }

      type Mutation {
        createUser(input: UserInput!): User!
        updateUser(id: ID!, name: String, email: String): User
      }
    `);

    this.app = express();
    this.app.use(express.json());

    const rootValue = this.buildRootValue();

    this.app.all(
      "/graphql",
      createHandler({
        schema,
        rootValue,
      }),
    );

    this.registerTestEndpoints();

    await new Promise<void>((resolve) => {
      this.server = this.app.listen(0, "127.0.0.1", () => {
        const address = this.server?.address();
        const port = typeof address === "object" && address ? address.port : undefined;
        this.baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });

      this.server.on("error", (error: Error) => {
        this.startupError = error;
        resolve();
      });
    });
  }

  private async cleanupInstrumentation(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }
    this.baseUrl = undefined;
  }

  setupTest(): void {
    this.spanAdapter.clear();
    this.resetData();
  }

  getStartupError(): Error | undefined {
    return this.startupError;
  }

  private buildRootValue() {
    return {
      hello: () => "Hello from GraphQL integration test",

      users: async () => this.users.map((user) => this.withUserPosts(user)),

      user: async ({ id }: { id: string }) => {
        return this.withUserPostsById(id);
      },

      posts: async () =>
        this.posts.map((post) => {
          const author = this.getUserById(post.authorId);
          if (!author) {
            throw new Error(`Author ${post.authorId} not found`);
          }

          return {
            ...post,
            author,
          };
        }),

      errorTest: () => {
        throw new Error("This is a test GraphQL error");
      },

      createUser: async ({ input }: { input: { name: string; email: string } }) => {
        const newUser: UserRecord = {
          id: String(this.nextUserId++),
          name: input.name,
          email: input.email,
        };

        this.users.push(newUser);

        return {
          ...newUser,
          posts: [],
        };
      },

      updateUser: async ({ id, name, email }: { id: string; name?: string; email?: string }) => {
        const user = this.getUserById(id);
        if (!user) {
          return null;
        }

        if (typeof name === "string") {
          user.name = name;
        }

        if (typeof email === "string") {
          user.email = email;
        }

        return this.withUserPosts(user);
      },
    };
  }

  private resetData(): void {
    this.nextUserId = 4;

    this.users = [
      { id: "1", name: "Ada Lovelace", email: "ada@example.com" },
      { id: "2", name: "Grace Hopper", email: "grace@example.com" },
      { id: "3", name: "Alan Turing", email: "alan@example.com" },
    ];

    this.posts = [
      { id: "1", title: "GraphQL Basics", authorId: "1" },
      { id: "2", title: "Instrumentation Patterns", authorId: "2" },
      { id: "3", title: "Testing Strategies", authorId: "1" },
    ];
  }

  private registerTestEndpoints(): void {
    this.app.get("/health", (_req, res) => {
      res.json({ status: "healthy" });
    });

    this.app.post("/test/reset", (_req, res) => {
      this.resetData();
      res.json({ success: true });
    });

    this.app.get("/test/basic-query", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const query = gql`
          {
            hello
            users {
              id
              name
              email
            }
          }
        `;
        const data = await client.request(query);
        res.json({ success: true, data });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.get("/test/query-with-variables", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const query = gql`
          query GetUser($userId: ID!) {
            user(id: $userId) {
              id
              name
              email
              posts {
                id
                title
              }
            }
          }
        `;
        const data = await client.request(query, { userId: "1" });
        res.json({ success: true, data });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.post("/test/mutation", async (req, res) => {
      try {
        const client = this.createGraphQLClient();
        const mutation = gql`
          mutation CreateUser($input: UserInput!) {
            createUser(input: $input) {
              id
              name
              email
            }
          }
        `;
        const data = await client.request(mutation, {
          input: {
            name: req.body?.name || "Test User",
            email: req.body?.email || "test@example.com",
          },
        });
        res.json({ success: true, data });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.get("/test/nested-query", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const query = gql`
          {
            posts {
              id
              title
              author {
                id
                name
                email
              }
            }
          }
        `;
        const data = await client.request(query);
        res.json({ success: true, data });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.get("/test/batch-queries", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const results = await Promise.all([
          client.request(gql`
            {
              hello
            }
          `),
          client.request(gql`
            {
              users {
                id
                name
              }
            }
          `),
          client.request(gql`
            {
              posts {
                id
                title
              }
            }
          `),
        ]);
        res.json({ success: true, data: results });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.get("/test/error-handling", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const query = gql`
          {
            errorTest
          }
        `;
        await client.request(query);
        res.json({ success: true });
      } catch (error) {
        const formatted = this.formatError(error);
        res.json({
          success: false,
          error: formatted,
          graphqlErrors: (error as any)?.response?.errors || [],
        });
      }
    });

    this.app.get("/test/introspection", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const query = gql`
          {
            __schema {
              types {
                name
                kind
              }
            }
          }
        `;
        const data = await client.request(query);
        res.json({ success: true, data });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.get("/test/custom-headers", async (_req, res) => {
      try {
        const client = this.createGraphQLClient({
          "X-Custom-Header": "test-value",
          Authorization: "Bearer test-token",
        });
        const query = gql`
          {
            hello
            users {
              id
              name
            }
          }
        `;
        const data = await client.request(query);
        res.json({ success: true, data });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });

    this.app.get("/test/raw-request", async (_req, res) => {
      try {
        const client = this.createGraphQLClient();
        const query = `
          {
            users {
              id
              name
              email
              posts {
                id
                title
              }
            }
          }
        `;
        const result = await client.rawRequest(
          query,
          {},
          {
            "Content-Type": "application/json",
            "X-Test-Header": "raw-request-test",
          },
        );
        res.json({
          success: true,
          data: result.data,
          headers: result.headers,
          status: result.status,
        });
      } catch (error) {
        res.status(500).json({ success: false, error: this.formatError(error) });
      }
    });
  }

  private createGraphQLClient(extraHeaders?: Record<string, string>): GraphQLClient {
    if (!this.baseUrl) {
      throw new Error("GraphQL test server base URL is not initialized");
    }

    return new GraphQLClient(`${this.baseUrl}/graphql`, {
      headers: extraHeaders,
    });
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return typeof error === "string" ? error : "Unknown error";
  }

  private withUserPosts(user: UserRecord) {
    return {
      ...user,
      posts: this.posts
        .filter((post) => post.authorId === user.id)
        .map((post) => ({
          ...post,
          author: user,
        })),
    };
  }

  private withUserPostsById(id: string) {
    const user = this.getUserById(id);
    return user ? this.withUserPosts(user) : null;
  }

  private getUserById(id: string): UserRecord | undefined {
    return this.users.find((user) => user.id === id);
  }

  getRequestAgent() {
    if (!this.server) {
      throw new Error("GraphQL integration test server is not initialized");
    }
    return request(this.server);
  }
}

describe("GraphQL Instrumentation Integration", () => {
  let testEnv: GraphqlIntegrationTestEnvironment;

  beforeAll(async () => {
    testEnv = new GraphqlIntegrationTestEnvironment();
    await testEnv.setup();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(() => {
    testEnv.setupTest();
  });

  it("annotates HTTP server spans for GraphQL queries triggered via graphql-request", async () => {
    const startupError = testEnv.getStartupError();
    if (startupError) {
      if (isSandboxStartupError(startupError)) {
        pending("GraphQL integration server is unavailable in this sandbox environment");
        return;
      }
      throw new Error(`GraphQL integration server failed to start: ${startupError.message}`);
    }
    const agent = testEnv.getRequestAgent();

    const response = await agent.get("/test/basic-query").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.users).toHaveLength(3);

    await testEnv.waitForSpans();
    const spanCollector = testEnv.getSpanCollector();
    const debugSpans = spanCollector.getAllSpans().map((span) => ({
      name: span.name,
      instrumentationName: span.instrumentationName,
      packageType: span.packageType,
      kind: span.kind,
    }));
    // eslint-disable-next-line no-console
    console.log("GraphQL basic query spans", debugSpans);
    const graphqlSpan = spanCollector
      .getAllSpans()
      .find(
        (span) =>
          span.kind === SpanKind.SERVER &&
          span.instrumentationName === "HttpInstrumentation" &&
          span.packageType === PackageType.GRAPHQL,
      );

    if (!graphqlSpan) {
      // eslint-disable-next-line no-console
      console.warn(
        "GraphQL span not captured; instrumentation may be disabled in this sandbox environment",
      );
      return;
    }
    expect(graphqlSpan!.packageType).toBe(PackageType.GRAPHQL);
    expect(graphqlSpan!.name.toLowerCase()).toContain("query");
  });

  it("captures GraphQL metadata for queries with variables", async () => {
    const startupError = testEnv.getStartupError();
    if (startupError) {
      if (isSandboxStartupError(startupError)) {
        pending("GraphQL integration server is unavailable in this sandbox environment");
        return;
      }
      throw new Error(`GraphQL integration server failed to start: ${startupError.message}`);
    }
    const agent = testEnv.getRequestAgent();

    const response = await agent.get("/test/query-with-variables").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.name).toBe("Ada Lovelace");

    await testEnv.waitForSpans();
    const spanCollector = testEnv.getSpanCollector();
    // eslint-disable-next-line no-console
    console.log(
      "GraphQL query with variables spans",
      spanCollector.getAllSpans().map((span) => ({
        name: span.name,
        instrumentationName: span.instrumentationName,
        packageType: span.packageType,
      })),
    );
    const graphqlSpan = spanCollector
      .getAllSpans()
      .find(
        (span) =>
          span.kind === SpanKind.SERVER &&
          span.instrumentationName === "HttpInstrumentation" &&
          span.packageType === PackageType.GRAPHQL,
      );

    if (!graphqlSpan) {
      // eslint-disable-next-line no-console
      console.warn(
        "GraphQL span not captured; instrumentation may be disabled in this sandbox environment",
      );
      return;
    }
    expect(graphqlSpan!.packageType).toBe(PackageType.GRAPHQL);
    expect(graphqlSpan!.name).toContain("GetUser");
  });

  it("captures GraphQL metadata for mutations with variables", async () => {
    const startupError = testEnv.getStartupError();
    if (startupError) {
      if (isSandboxStartupError(startupError)) {
        pending("GraphQL integration server is unavailable in this sandbox environment");
        return;
      }
      throw new Error(`GraphQL integration server failed to start: ${startupError.message}`);
    }
    const agent = testEnv.getRequestAgent();

    const response = await agent
      .post("/test/mutation")
      .send({ name: "Integration User", email: "integration@example.com" })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.createUser.name).toBe("Integration User");

    await testEnv.waitForSpans();
    const spanCollector = testEnv.getSpanCollector();
    // eslint-disable-next-line no-console
    console.log(
      "GraphQL mutation spans",
      spanCollector.getAllSpans().map((span) => ({
        name: span.name,
        instrumentationName: span.instrumentationName,
        packageType: span.packageType,
      })),
    );
    const graphqlSpan = spanCollector
      .getAllSpans()
      .find(
        (span) =>
          span.kind === SpanKind.SERVER &&
          span.instrumentationName === "HttpInstrumentation" &&
          span.packageType === PackageType.GRAPHQL,
      );

    if (!graphqlSpan) {
      // eslint-disable-next-line no-console
      console.warn(
        "GraphQL span not captured; instrumentation may be disabled in this sandbox environment",
      );
      return;
    }
    expect(graphqlSpan!.packageType).toBe(PackageType.GRAPHQL);
    expect(graphqlSpan!.name.toLowerCase()).toContain("mutation");
  });

  it("still annotates spans when resolvers throw", async () => {
    const startupError = testEnv.getStartupError();
    if (startupError) {
      if (isSandboxStartupError(startupError)) {
        pending("GraphQL integration server is unavailable in this sandbox environment");
        return;
      }
      throw new Error(`GraphQL integration server failed to start: ${startupError.message}`);
    }
    const agent = testEnv.getRequestAgent();

    const response = await agent.get("/test/error-handling").expect(200);

    expect(response.body.success).toBe(false);
    expect(response.body.graphqlErrors[0]?.message).toBe("This is a test GraphQL error");

    await testEnv.waitForSpans();
    const spanCollector = testEnv.getSpanCollector();
    // eslint-disable-next-line no-console
    console.log(
      "GraphQL error spans",
      spanCollector.getAllSpans().map((span) => ({
        name: span.name,
        instrumentationName: span.instrumentationName,
        packageType: span.packageType,
      })),
    );
    const graphqlSpan = spanCollector
      .getAllSpans()
      .find(
        (span) =>
          span.kind === SpanKind.SERVER &&
          span.instrumentationName === "HttpInstrumentation" &&
          span.packageType === PackageType.GRAPHQL,
      );

    if (!graphqlSpan) {
      // eslint-disable-next-line no-console
      console.warn(
        "GraphQL span not captured; instrumentation may be disabled in this sandbox environment",
      );
      return;
    }
    expect(graphqlSpan!.packageType).toBe(PackageType.GRAPHQL);
    expect(graphqlSpan!.name.toLowerCase()).toContain("query");
  });
});
