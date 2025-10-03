const { TuskDrift } = require("tusk-drift-sdk");

TuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

console.log("TuskDrift SDK initialized successfully");

const express = require("express");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema } = require("graphql");
const { GraphQLClient, gql } = require("graphql-request");
const { Client } = require("pg");
const { PostgreSqlContainer } = require("@testcontainers/postgresql");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let client;
let container;
let dbConfig;

async function initializeDatabase() {
  // Start PostgreSQL container
  // If you're into: "Failed to initialize database: Error: Health check failed: unhealthy"
  // you might need to run `docker system prune` to clean up unused Docker resources.
  container = await new PostgreSqlContainer("postgres:13")
    .withDatabase("testdb")
    .withUsername("testuser")
    .withPassword("testpass")
    .withExposedPorts(5432)
    .start();

  console.log(`PostgreSQL container started on port ${container.getMappedPort(5432)}`);

  // Create database configuration from container
  dbConfig = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
    connectionTimeoutMillis: 2000,
  };

  console.log(`Connecting to database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  // Initialize client
  client = new Client(dbConfig);
  await client.connect();

  // Create test tables
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      author_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert initial test data
  await resetDatabaseState();

  console.log("Database initialized successfully");
}

async function resetDatabaseState() {
  // Clear existing data
  await client.query("DELETE FROM posts");
  await client.query("DELETE FROM users");

  // Reset sequences
  await client.query("ALTER SEQUENCE users_id_seq RESTART WITH 1");
  await client.query("ALTER SEQUENCE posts_id_seq RESTART WITH 1");

  // Insert initial users
  await client.query(`
    INSERT INTO users (name, email) VALUES 
    ('John Doe', 'john@example.com'),
    ('Jane Smith', 'jane@example.com'),
    ('Bob Johnson', 'bob@example.com')
  `);

  // Insert initial posts
  await client.query(`
    INSERT INTO posts (title, author_id) VALUES 
    ('GraphQL Basics', 1),
    ('Advanced GraphQL', 2),
    ('GraphQL Best Practices', 1)
  `);

  console.log("Database state reset to initial values");
}

// GraphQL schema definition
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
    user(id: ID!): User
    users: [User!]!
    posts: [Post!]!
    errorTest: String
  }

  type Mutation {
    createUser(input: UserInput!): User!
    updateUser(id: ID!, name: String, email: String): User
  }
`);

// Root resolver - now using PostgreSQL
const root = {
  // Queries
  hello: () => "Hello from GraphQL!",

  user: async ({ id }) => {
    const userResult = await client.query("SELECT * FROM users WHERE id = $1", [parseInt(id)]);
    if (userResult.rows.length === 0) return null;

    const user = userResult.rows[0];
    const postsResult = await client.query("SELECT * FROM posts WHERE author_id = $1", [user.id]);

    return {
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      posts: postsResult.rows.map((post) => ({
        id: post.id.toString(),
        title: post.title,
        author: user,
      })),
    };
  },

  users: async () => {
    const usersResult = await client.query("SELECT * FROM users ORDER BY id");
    const users = [];

    for (const user of usersResult.rows) {
      const postsResult = await client.query("SELECT * FROM posts WHERE author_id = $1", [user.id]);

      users.push({
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        posts: postsResult.rows.map((post) => ({
          id: post.id.toString(),
          title: post.title,
          author: user,
        })),
      });
    }

    return users;
  },

  posts: async () => {
    const postsResult = await client.query(`
      SELECT p.id, p.title, p.author_id, u.name, u.email 
      FROM posts p 
      JOIN users u ON p.author_id = u.id 
      ORDER BY p.id
    `);

    return postsResult.rows.map((row) => ({
      id: row.id.toString(),
      title: row.title,
      author: {
        id: row.author_id.toString(),
        name: row.name,
        email: row.email,
      },
    }));
  },

  errorTest: () => {
    throw new Error("This is a test GraphQL error");
  },

  // Mutations
  createUser: async ({ input }) => {
    const result = await client.query(
      "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *",
      [input.name, input.email],
    );

    const newUser = result.rows[0];
    return {
      id: newUser.id.toString(),
      name: newUser.name,
      email: newUser.email,
      posts: [],
    };
  },

  updateUser: async ({ id, name, email }) => {
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email) {
      updates.push(`email = $${paramCount++}`);
      values.push(email);
    }

    if (updates.length === 0) return null;

    values.push(parseInt(id));
    const query = `UPDATE users SET ${updates.join(", ")} WHERE id = $${paramCount} RETURNING *`;

    const result = await client.query(query, values);
    if (result.rows.length === 0) return null;

    const user = result.rows[0];
    const postsResult = await client.query("SELECT * FROM posts WHERE author_id = $1", [user.id]);

    return {
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      posts: postsResult.rows.map((post) => ({
        id: post.id.toString(),
        title: post.title,
        author: user,
      })),
    };
  },
};

// Setup GraphQL endpoint
app.all(
  "/graphql",
  createHandler({
    schema: schema,
    rootValue: root,
  }),
);

// Initialize GraphQL client for testing graphql-request
const graphqlClient = new GraphQLClient(`http://localhost:${PORT}/graphql`);

// Test endpoints that use graphql-request to test GraphQL instrumentation

// Test 1: Basic GraphQL query
app.get("/test/basic-query", async (req, res) => {
  try {
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

    const data = await graphqlClient.request(query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 2: GraphQL query with variables
app.get("/test/query-with-variables", async (req, res) => {
  try {
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

    const variables = { userId: "1" };
    const data = await graphqlClient.request(query, variables);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 3: GraphQL mutation
app.post("/test/mutation", async (req, res) => {
  try {
    const mutation = gql`
      mutation CreateUser($input: UserInput!) {
        createUser(input: $input) {
          id
          name
          email
        }
      }
    `;

    const variables = {
      input: {
        name: req.body.name || "Test User",
        email: req.body.email || `test@example.com`,
      },
    };

    const data = await graphqlClient.request(mutation, variables);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 4: Nested GraphQL query
app.get("/test/nested-query", async (req, res) => {
  try {
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

    const data = await graphqlClient.request(query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 5: Batch queries (multiple operations)
app.get("/test/batch-queries", async (req, res) => {
  try {
    const queries = [
      graphqlClient.request(gql`
        {
          hello
        }
      `),
      graphqlClient.request(gql`
        {
          users {
            id
            name
          }
        }
      `),
      graphqlClient.request(gql`
        {
          posts {
            id
            title
          }
        }
      `),
    ];

    const results = await Promise.all(queries);
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 6: Error handling
// This will not work since we assume all grapql queries recored did not error
// But leaving this in here incase we don't want to assume this
app.get("/test/error-handling", async (req, res) => {
  try {
    const query = gql`
      {
        errorTest
      }
    `;

    const data = await graphqlClient.request(query);
    res.json({ success: true, data });
  } catch (error) {
    // This should catch the GraphQL error
    res.json({
      success: false,
      error: error.message,
      errorHandled: true,
      graphqlErrors: error.response?.errors || [],
    });
  }
});

// Test 7: Introspection query
app.get("/test/introspection", async (req, res) => {
  try {
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

    const data = await graphqlClient.request(query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 8: Custom headers
app.get("/test/custom-headers", async (req, res) => {
  try {
    const clientWithHeaders = new GraphQLClient(`http://localhost:${PORT}/graphql`, {
      headers: {
        "X-Custom-Header": "test-value",
        Authorization: "Bearer test-token",
      },
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

    const data = await clientWithHeaders.request(query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test 9: Raw request method testing (specifically for the patched GraphQL client)
app.get("/test/raw-request", async (req, res) => {
  try {
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

    const variables = {};
    const requestHeaders = {
      "Content-Type": "application/json",
      "X-Test-Header": "raw-request-test",
    };

    // Use rawRequest method to test the specific patch
    const data = await graphqlClient.rawRequest(query, variables, requestHeaders);
    res.json({
      success: true,
      data: data.data,
      headers: data.headers,
      status: data.status,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/test/reset", async (req, res) => {
  try {
    await resetDatabaseState();
    res.json({ success: true, message: "Database state reset successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "graphql-integration-test-server",
  });
});

// Simple GraphiQL interface endpoint
app.get("/graphiql", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>GraphiQL</title>
      <link href="https://unpkg.com/graphiql/graphiql.min.css" rel="stylesheet" />
    </head>
    <body style="margin: 0;">
      <div id="graphiql" style="height: 100vh;"></div>
      <script crossorigin src="https://unpkg.com/react@17/umd/react.production.min.js"></script>
      <script crossorigin src="https://unpkg.com/react-dom@17/umd/react-dom.production.min.js"></script>
      <script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
      <script>
        ReactDOM.render(
          React.createElement(GraphiQL, {
            fetcher: GraphiQL.createFetcher({ url: '/graphql' }),
          }),
          document.getElementById('graphiql')
        );
      </script>
    </body>
    </html>
  `);
});

// Start server
async function startServer() {
  try {
    console.log("Starting GraphQL integration test server...");

    app.listen(PORT, async () => {
      try {
        await initializeDatabase();
        TuskDrift.markAppAsReady();
        console.log(`GraphQL integration test server running on port ${PORT}`);
        console.log(`GraphQL endpoint: http://localhost:${PORT}/graphql`);
        console.log(`GraphiQL interface: http://localhost:${PORT}/graphiql`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log(`Database reset: POST http://localhost:${PORT}/test/reset`);
        console.log("Server ready for testing");
      } catch (error) {
        console.error("Failed to initialize database:", error);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  if (client) {
    await client.end();
  }
  if (container) {
    await container.stop();
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await shutdown();
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  await shutdown();
});

// Start the server
startServer().catch(console.error);
