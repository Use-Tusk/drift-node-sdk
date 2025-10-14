process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "debug",
});
TuskDrift.markAppAsReady();

import test from "ava";
import { SpanKind } from "@opentelemetry/api";
import { SpanUtils } from "../../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../../core/TuskDrift";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { CleanSpanData } from "../../../../core/types";
import { GrpcClientInputValue, GrpcOutputValue, GrpcErrorOutput } from "../types";
import * as path from "path";

// Use require() instead of import to ensure the module under test is loaded AFTER TuskDrift initialization
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

// gRPC server is running in Docker on port 50051
const GRPC_SERVER_ADDRESS = process.env.GRPC_SERVER_ADDRESS || "127.0.0.1:50051";

const PROTO_PATH_GREETER = path.join(__dirname, "protos/greeter.proto");
const PROTO_PATH_CALCULATOR = path.join(__dirname, "protos/calculator.proto");
const PROTO_PATH_USER = path.join(__dirname, "protos/user.proto");
const PROTO_PATH_FILE = path.join(__dirname, "protos/file.proto");

async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

/** These tests don't have a root span because there's no server or anything.
 * TODO: create a proper server like http */
async function withRootSpan<T>(fn: () => Promise<T>): Promise<T> {
  return SpanUtils.createAndExecuteSpan(
    TuskDriftMode.RECORD,
    () => {
      throw new Error("Should not be called - test should run within span context");
    },
    {
      name: "test-root-span",
      kind: SpanKind.SERVER,
      packageName: "test",
      instrumentationName: "TestInstrumentation",
      submodule: "test",
      inputValue: {},
      isPreAppStart: false,
    },
    async (_spanInfo) => await fn(),
  );
}

// Helper to promisify gRPC calls
function grpcCallPromise<TRequest, TResponse>(
  client: any,
  methodName: string,
  request: TRequest,
  metadata?: any,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const meta = metadata || new grpc.Metadata();
    client[methodName](request, meta, (error: any, response: TResponse) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

let spanAdapter: InMemorySpanAdapter;
let greeterClient: any;
let calculatorClient: any;
let userClient: any;
let fileClient: any;

test.before(async (t) => {
  spanAdapter = new InMemorySpanAdapter();
  registerInMemoryAdapter(spanAdapter);

  // Load proto files
  const packageDefinitionGreeter = protoLoader.loadSync(PROTO_PATH_GREETER, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const packageDefinitionCalculator = protoLoader.loadSync(PROTO_PATH_CALCULATOR, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const packageDefinitionUser = protoLoader.loadSync(PROTO_PATH_USER, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const packageDefinitionFile = protoLoader.loadSync(PROTO_PATH_FILE, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const greeterProto = grpc.loadPackageDefinition(packageDefinitionGreeter).greeter;
  const calculatorProto = grpc.loadPackageDefinition(packageDefinitionCalculator).calculator;
  const userProto = grpc.loadPackageDefinition(packageDefinitionUser).user;
  const fileProto = grpc.loadPackageDefinition(packageDefinitionFile).file;

  // Create clients
  greeterClient = new greeterProto.Greeter(GRPC_SERVER_ADDRESS, grpc.credentials.createInsecure());

  calculatorClient = new calculatorProto.Calculator(
    GRPC_SERVER_ADDRESS,
    grpc.credentials.createInsecure(),
  );

  userClient = new userProto.UserService(GRPC_SERVER_ADDRESS, grpc.credentials.createInsecure());

  fileClient = new fileProto.FileService(GRPC_SERVER_ADDRESS, grpc.credentials.createInsecure());

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const deadline = new Date(Date.now() + 30000); // 30 second timeout
    greeterClient.waitForReady(deadline, (error: Error | null) => {
      if (error) {
        reject(error);
      } else {
        console.log("[Test] gRPC server is ready");
        resolve();
      }
    });
  });

  // Clear spans from setup
  await waitForSpans();
  spanAdapter.clear();
});

test.after.always(async () => {
  if (greeterClient) {
    greeterClient.close();
  }
  if (calculatorClient) {
    calculatorClient.close();
  }
  if (userClient) {
    userClient.close();
  }
  if (fileClient) {
    fileClient.close();
  }
  clearRegisteredInMemoryAdapters();
});

test.beforeEach(() => {
  spanAdapter.clear();
});

test.serial("should capture spans for simple gRPC request", async (t) => {
  // Execute real gRPC call
  const response: any = await withRootSpan(async () =>
    await grpcCallPromise(greeterClient, "SayHello", {
      name: "World",
      greeting_type: "formal",
    }),
  );

  t.is(response.message, "Hello, World!");
  t.is(response.success, true);
  t.truthy(response.timestamp);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "SayHello");
  t.is(inputValue.service, "greeter.Greeter");
  t.is(inputValue.body.name, "World");
  t.is(inputValue.body.greeting_type, "formal");

  const outputValue = span.outputValue as GrpcOutputValue;
  t.is(outputValue.body.message, "Hello, World!");
  t.is(outputValue.body.success, true);
  t.is(outputValue.status.code, 0); // OK status
});

test.serial("should capture spans for gRPC request with metadata", async (t) => {
  const metadata = new grpc.Metadata();
  metadata.add("user-id", "test-user-123");
  metadata.add("request-id", "req-456");

  const response: any = await withRootSpan(async () =>
    grpcCallPromise(
      greeterClient,
      "SayHello",
      {
        name: "Alice",
        greeting_type: "excited",
      },
      metadata,
    ),
  );

  t.is(response.message, "Hello Alice!!!");
  t.is(response.success, true);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "SayHello");
  t.truthy(inputValue.metadata);
  t.truthy(inputValue.metadata["user-id"]);
  t.truthy(inputValue.metadata["request-id"]);
});

test.serial("should capture spans for calculator operations", async (t) => {
  const response: any = await withRootSpan(async () =>
    grpcCallPromise(calculatorClient, "Add", {
      num1: 10.5,
      num2: 5.3,
      operation: "addition",
    }),
  );

  t.is(response.result, 15.8);
  t.is(response.operation, "addition");
  t.is(response.success, true);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "Add");
  t.is(inputValue.service, "calculator.Calculator");
  t.is(inputValue.body.num1, 10.5);
  t.is(inputValue.body.num2, 5.3);

  const outputValue = span.outputValue as GrpcOutputValue;
  t.is(outputValue.body.result, 15.8);
});

test.serial("should capture spans for error responses (division by zero)", async (t) => {
  const error = await t.throwsAsync(async () => {
    await withRootSpan(async () =>
      grpcCallPromise(calculatorClient, "Divide", {
        num1: 10,
        num2: 0,
        operation: "division",
      }),
    );
  });

  t.truthy(error);
  t.true((error as any).message.includes("Division by zero"));
  t.is((error as any).code, grpc.status.INVALID_ARGUMENT);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "Divide");

  const outputValue = span.outputValue as GrpcErrorOutput;
  t.truthy(outputValue.error);
  t.true(outputValue.error.message.includes("Division by zero"));
  t.is(outputValue.status.code, grpc.status.INVALID_ARGUMENT);
});

test.serial("should capture spans for complex nested objects (User)", async (t) => {
  const response: any = await withRootSpan(async () =>
    grpcCallPromise(userClient, "CreateUser", {
      name: "Test User",
      email: "test@example.com",
      age: 30,
      roles: ["admin", "user", "moderator"],
    }),
  );

  t.is(response.name, "Test User");
  t.is(response.email, "test@example.com");
  t.is(response.age, 30);
  t.deepEqual(response.roles, ["admin", "user", "moderator"]);
  t.truthy(response.metadata);
  t.truthy(response.metadata.created_at);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "CreateUser");
  t.is(inputValue.service, "user.UserService");
  t.deepEqual(inputValue.body.roles, ["admin", "user", "moderator"]);

  const outputValue = span.outputValue as GrpcOutputValue;
  t.is(outputValue.body.name, "Test User");
  t.deepEqual(outputValue.body.roles, ["admin", "user", "moderator"]);
  t.truthy(outputValue.body.metadata);
});

test.serial("should capture spans for user retrieval", async (t) => {
  const response: any = await withRootSpan(async () => grpcCallPromise(userClient, "GetUser", { id: 1 }));

  t.is(response.id, 1);
  t.is(response.name, "Alice Johnson");
  t.is(response.email, "alice@example.com");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "GetUser");
  t.is(inputValue.body.id, 1);

  const outputValue = span.outputValue as GrpcOutputValue;
  t.is(outputValue.body.name, "Alice Johnson");
});

test.serial("should capture spans for user not found error", async (t) => {
  const error = await t.throwsAsync(async () => {
    await withRootSpan(async () => grpcCallPromise(userClient, "GetUser", { id: 99999 }));
  });

  t.truthy(error);
  t.true((error as any).message.includes("not found"));
  t.is((error as any).code, grpc.status.NOT_FOUND);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const outputValue = span.outputValue as GrpcErrorOutput;
  t.truthy(outputValue.error);
  t.is(outputValue.status.code, grpc.status.NOT_FOUND);
});

test.serial("should capture spans for binary data (file upload)", async (t) => {
  const binaryContent = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG header
    0x48,
    0x65,
    0x6c,
    0x6c,
    0x6f,
    0x20,
    0x57,
    0x6f,
    0x72,
    0x6c,
    0x64, // "Hello World"
  ]);

  const response: any = await withRootSpan(async () =>
    grpcCallPromise(fileClient, "UploadFile", {
      filename: "test.png",
      content: binaryContent,
      content_type: "image/png",
    }),
  );

  t.truthy(response.file_id);
  t.is(response.size, binaryContent.length);
  t.truthy(response.thumbnail);
  t.true(Buffer.isBuffer(response.thumbnail));
  t.is(response.message, "File test.png uploaded successfully");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "UploadFile");
  t.is(inputValue.service, "file.FileService");
  t.is(inputValue.body.filename, "test.png");
  // Binary content should be replaced with placeholder
  t.is(inputValue.body.content, "__tusk_drift_buffer_replaced__");
  // But should be in bufferMap
  t.truthy(inputValue.inputMeta.bufferMap);
  t.truthy(inputValue.inputMeta.bufferMap["content"]);

  const outputValue = span.outputValue as GrpcOutputValue;
  t.truthy(outputValue.body.file_id);
  // Thumbnail should also be in bufferMap
  t.is(outputValue.body.thumbnail, "__tusk_drift_buffer_replaced__");
  t.truthy(outputValue.bufferMap);
  t.truthy(outputValue.bufferMap["thumbnail"]);
});

test.serial("should capture spans for file download", async (t) => {
  // First upload a file
  const uploadContent = Buffer.from("Test file content");
  const uploadResponse: any = await withRootSpan(async () =>
    grpcCallPromise(fileClient, "UploadFile", {
      filename: "download-test.txt",
      content: uploadContent,
      content_type: "text/plain",
    }),
  );

  const fileId = uploadResponse.file_id;

  // Clear spans from upload
  spanAdapter.clear();

  // Now download it
  const downloadResponse: any = await withRootSpan(async () =>
    grpcCallPromise(fileClient, "DownloadFile", {
      file_id: fileId,
    }),
  );

  t.is(downloadResponse.filename, "download-test.txt");
  t.is(downloadResponse.content_type, "text/plain");
  t.true(Buffer.isBuffer(downloadResponse.content));
  t.deepEqual(downloadResponse.content, uploadContent);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const downloadSpan = grpcSpans.find(
    (s: CleanSpanData) => (s.inputValue as GrpcClientInputValue)?.method === "DownloadFile",
  );
  t.truthy(downloadSpan);

  const inputValue = downloadSpan?.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "DownloadFile");

  const outputValue = downloadSpan?.outputValue as GrpcOutputValue;
  t.is(outputValue.body.filename, "download-test.txt");
  t.is(outputValue.body.content, "__tusk_drift_buffer_replaced__");
  t.truthy(outputValue.bufferMap["content"]);
});

test.serial("should handle concurrent gRPC calls", async (t) => {
  const calls = [
    withRootSpan(() =>
      grpcCallPromise(greeterClient, "SayHello", {
        name: "Concurrent1",
        greeting_type: "formal",
      }),
    ),
    withRootSpan(() =>
      grpcCallPromise(calculatorClient, "Add", {
        num1: 5,
        num2: 3,
        operation: "addition",
      }),
    ),
    withRootSpan(() =>
      grpcCallPromise(greeterClient, "SayHello", {
        name: "Concurrent2",
        greeting_type: "casual",
      }),
    ),
    withRootSpan(() =>
      grpcCallPromise(calculatorClient, "Multiply", {
        num1: 4,
        num2: 7,
        operation: "multiplication",
      }),
    ),
  ];

  const results = await Promise.all(calls);
  t.is(results.length, 4);
  t.is((results[0] as any).message, "Hello, Concurrent1!");
  t.is((results[1] as any).result, 8);
  t.is((results[2] as any).message, "Hey Concurrent2!");
  t.is((results[3] as any).result, 28);

  await waitForSpans();

  const spans = spanAdapter.getSpansByInstrumentation("Grpc");
  t.true(spans.length >= 4);

  // Verify each call has its own span
  const greetSpans = spans.filter(
    (s: CleanSpanData) =>
      (s.inputValue as GrpcClientInputValue)?.method === "SayHello" &&
      (s.inputValue as GrpcClientInputValue)?.body?.name?.includes("Concurrent"),
  );
  t.is(greetSpans.length, 2);
});

test.serial("should handle sequential calls to different services", async (t) => {
  // Call greeter service
  const greeting: any = await withRootSpan(async () =>
    grpcCallPromise(greeterClient, "SayHello", {
      name: "Sequential",
      greeting_type: "formal",
    }),
  );
  t.is(greeting.message, "Hello, Sequential!");

  // Call calculator service
  const calculation: any = await withRootSpan(async () =>
    grpcCallPromise(calculatorClient, "Subtract", {
      num1: 20,
      num2: 8,
      operation: "subtraction",
    }),
  );
  t.is(calculation.result, 12);

  // Call user service
  const user: any = await withRootSpan(async () => grpcCallPromise(userClient, "GetUser", { id: 2 }));
  t.is(user.name, "Bob Smith");

  await waitForSpans();

  const spans = spanAdapter.getSpansByInstrumentation("Grpc");
  t.true(spans.length >= 3);

  // Verify different services were called
  const services = spans.map((s: CleanSpanData) => (s.inputValue as GrpcClientInputValue)?.service);
  t.true(services.includes("greeter.Greeter"));
  t.true(services.includes("calculator.Calculator"));
  t.true(services.includes("user.UserService"));
});

test.serial("should capture callback-style gRPC calls", async (t) => {
  await new Promise<void>((resolve, reject) => {
    withRootSpan(async () => {
      greeterClient.SayHelloAgain(
        { name: "Callback", greeting_type: "formal" },
        new grpc.Metadata(),
        async (err: Error | null, response: any) => {
          try {
            t.is(err, null);
            t.is(response.message, "Hello again, Callback!");

            await waitForSpans();

            const spans = spanAdapter.getAllSpans();
            const grpcSpans = spans.filter(
              (input: CleanSpanData) =>
                input.instrumentationName === "GrpcInstrumentation" &&
                (input.inputValue as GrpcClientInputValue)?.method === "SayHelloAgain",
            );
            t.true(grpcSpans.length > 0);

            resolve();
          } catch (error) {
            reject(error);
          }
        },
      );
    });
  });
});

test.serial("should handle list operations with pagination", async (t) => {
  const response: any = await withRootSpan(async () =>
    grpcCallPromise(userClient, "ListUsers", {
      limit: 10,
      offset: 0,
    }),
  );

  t.truthy(response.users);
  t.true(Array.isArray(response.users));
  t.true(response.users.length >= 2); // At least the seed users
  t.truthy(response.total);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const grpcSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "GrpcInstrumentation",
  );
  t.true(grpcSpans.length > 0);

  const span = grpcSpans[0];
  const inputValue = span.inputValue as GrpcClientInputValue;
  t.is(inputValue.method, "ListUsers");

  const outputValue = span.outputValue as GrpcOutputValue;
  t.true(Array.isArray(outputValue.body.users));
});
