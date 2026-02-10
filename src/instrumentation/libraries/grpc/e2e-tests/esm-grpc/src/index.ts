import { TuskDrift } from "./tdInit.js";
import express, { Request, Response } from "express";
import * as grpc from "@grpc/grpc-js";
import { startGrpcServer } from "./grpc/server.js";
import * as clients from "./grpc/clients.js";

const app = express();
const PORT = process.env.PORT || 3000;
const GRPC_PORT = 50051;

app.use(express.json());

clients.initializeClients();

const grpcServer = startGrpcServer(GRPC_PORT);

// Wait for gRPC server to be ready
setTimeout(() => {
  console.log("[Main] gRPC server should be ready");
}, 2000);

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", ready: true });
});

// Simple hello with basic request
app.get("/greet/hello", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.greeterClient,
      "SayHello",
      {
        name: "World",
        greeting_type: "formal",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /greet/hello:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Hello with metadata
app.get("/greet/hello-with-metadata", async (req: Request, res: Response) => {
  try {
    const metadata = new grpc.Metadata();
    metadata.add("user-id", "test-user-123");
    metadata.add("request-id", "req-456");
    metadata.add("custom-header", "custom-value");

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.greeterClient,
      "SayHello",
      {
        name: "Alice",
        greeting_type: "excited",
      },
      metadata,
    );

    res.json({
      success: true,
      data: response,
      metadata_sent: {
        "user-id": "test-user-123",
        "request-id": "req-456",
        "custom-header": "custom-value",
      },
    });
  } catch (error: any) {
    console.error("[Express] Error in /greet/hello-with-metadata:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Custom greeting
app.post("/greet/custom", async (req: Request, res: Response) => {
  try {
    const { name, greeting_type } = req.body;

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.greeterClient,
      "SayHello",
      {
        name: name || "Guest",
        greeting_type: greeting_type || "formal",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /greet/custom:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Say hello again
app.get("/greet/hello-again", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.greeterClient,
      "SayHelloAgain",
      {
        name: "Bob",
        greeting_type: "casual",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /greet/hello-again:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Greet many times
app.get("/greet/many-times", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.greeterClient,
      "GreetManyTimes",
      {
        name: "Charlie",
        greeting_type: "formal",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /greet/many-times:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Add operation
app.get("/calc/add", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.calculatorClient,
      "Add",
      {
        num1: 10.5,
        num2: 5.3,
        operation: "addition",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /calc/add:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Subtract operation
app.get("/calc/subtract", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.calculatorClient,
      "Subtract",
      {
        num1: 20.0,
        num2: 7.5,
        operation: "subtraction",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /calc/subtract:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Multiply operation
app.get("/calc/multiply", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.calculatorClient,
      "Multiply",
      {
        num1: 3.5,
        num2: 4.0,
        operation: "multiplication",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /calc/multiply:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Divide operation (with error handling)
app.post("/calc/divide", async (req: Request, res: Response) => {
  try {
    const { num1, num2 } = req.body;

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.calculatorClient,
      "Divide",
      {
        num1: num1 || 10,
        num2: num2 || 2,
        operation: "division",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /calc/divide:", error);
    // This is expected for division by zero
    res.status(400).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// Test division by zero error
app.get("/calc/divide-by-zero", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.calculatorClient,
      "Divide",
      {
        num1: 10,
        num2: 0,
        operation: "division",
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Expected error in /calc/divide-by-zero:", error.message);
    // This is expected
    res.status(400).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// ========== USER SERVICE ENDPOINTS ==========

// Get user by ID
app.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);

    const response: any = await clients.grpcCallPromise(clients.clientsObj.userClient, "GetUser", {
      id: userId,
    });

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /users/:id:", error);
    res.status(error.code === grpc.status.NOT_FOUND ? 404 : 500).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// Create user
app.post("/users", async (req: Request, res: Response) => {
  try {
    const { name, email, age, roles } = req.body;

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.userClient,
      "CreateUser",
      {
        name: name || "New User",
        email: email || "newuser@example.com",
        age: age || 25,
        roles: roles || ["user"],
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in POST /users:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Update user
app.put("/users/:id", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);
    const { name, email, age, roles } = req.body;

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.userClient,
      "UpdateUser",
      {
        id: userId,
        name,
        email,
        age,
        roles,
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in PUT /users/:id:", error);
    res.status(error.code === grpc.status.NOT_FOUND ? 404 : 500).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// Delete user
app.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.id);

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.userClient,
      "DeleteUser",
      {
        id: userId,
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in DELETE /users/:id:", error);
    res.status(error.code === grpc.status.NOT_FOUND ? 404 : 500).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// List users with pagination
app.get("/users", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.userClient,
      "ListUsers",
      {
        limit,
        offset,
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in GET /users:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// ========== SPECIAL TEST ENDPOINTS ==========

// Test user not found error
app.get("/test/user-not-found", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(clients.clientsObj.userClient, "GetUser", {
      id: 99999,
    });

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Expected error in /test/user-not-found:", error.message);
    // This is expected
    res.status(404).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// Test multiple sequential calls
app.get("/test/sequential-calls", async (req: Request, res: Response) => {
  try {
    // Make multiple gRPC calls sequentially
    const greeting: any = await clients.grpcCallPromise(
      clients.clientsObj.greeterClient,
      "SayHello",
      {
        name: "Sequential Test",
        greeting_type: "formal",
      },
    );

    const calculation: any = await clients.grpcCallPromise(
      clients.clientsObj.calculatorClient,
      "Add",
      {
        num1: 5,
        num2: 10,
        operation: "addition",
      },
    );

    const user: any = await clients.grpcCallPromise(clients.clientsObj.userClient, "GetUser", {
      id: 1,
    });

    res.json({
      success: true,
      data: {
        greeting,
        calculation,
        user,
      },
    });
  } catch (error: any) {
    console.error("[Express] Error in /test/sequential-calls:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Test with complex nested data
app.post("/test/complex-data", async (req: Request, res: Response) => {
  try {
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.userClient,
      "CreateUser",
      {
        name: "Complex User",
        email: "complex@example.com",
        age: 35,
        roles: ["admin", "user", "moderator", "developer"],
      },
    );

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /test/complex-data:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Upload file with binary content
app.post("/files/upload", async (req: Request, res: Response) => {
  try {
    // Create binary data to upload
    const binaryContent = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG header
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52, // IHDR chunk
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

    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.fileClient,
      "UploadFile",
      {
        filename: "test-image.png",
        content: binaryContent,
        content_type: "image/png",
      },
    );

    res.json({
      success: true,
      data: {
        file_id: response.file_id,
        size: response.size,
        message: response.message,
        thumbnail_is_buffer: Buffer.isBuffer(response.thumbnail),
        thumbnail_type: typeof response.thumbnail,
        thumbnail_length: response.thumbnail?.length,
        // Send thumbnail as base64 string for JSON serialization
        thumbnail_base64: response.thumbnail ? response.thumbnail.toString("base64") : null,
      },
    });
  } catch (error: any) {
    console.error("[Express] Error in POST /files/upload:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Download file
app.get("/files/download/:fileId", async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId;
    const response: any = await clients.grpcCallPromise(
      clients.clientsObj.fileClient,
      "DownloadFile",
      {
        file_id: fileId,
      },
    );

    res.json({
      success: true,
      data: {
        filename: response.filename,
        content_type: response.content_type,
        size: response.size,
        content_is_buffer: Buffer.isBuffer(response.content),
        content_type_check: typeof response.content,
        content_length: response.content?.length,
        // Send content as base64 string for JSON serialization
        content_base64: response.content ? response.content.toString("base64") : null,
      },
    });
  } catch (error: any) {
    console.error("[Express] Error in GET /files/download/:fileId:", error);
    res.status(error.code === grpc.status.NOT_FOUND ? 404 : 500).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
    });
  }
});

// makeUnaryRequest with callback only (no metadata)
app.get("/test/unary-callback-only", async (req: Request, res: Response) => {
  try {
    const response: any = await new Promise((resolve, reject) => {
      // Call with just callback (no metadata, no options)
      clients.clientsObj.greeterClient.SayHello(
        { name: "CallbackOnly", greeting_type: "formal" },
        (error: any, response: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        },
      );
    });

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /test/unary-callback-only:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// makeUnaryRequest with options (no metadata)
app.get("/test/unary-options-only", async (req: Request, res: Response) => {
  try {
    const options = {
      deadline: Date.now() + 30000, // 30 second deadline
    };

    const response: any = await new Promise((resolve, reject) => {
      // Call with options but no metadata
      clients.clientsObj.greeterClient.SayHello(
        { name: "OptionsOnly", greeting_type: "casual" },
        options,
        (error: any, response: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(response);
          }
        },
      );
    });

    res.json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("[Express] Error in /test/unary-options-only:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
});

// Start Express server
const server = app.listen(PORT, async () => {
  TuskDrift.markAppAsReady();
  console.log(`[Express] Server running on port ${PORT}`);
  console.log(`[Express] TUSK_DRIFT_MODE: ${process.env.TUSK_DRIFT_MODE || "DISABLED"}`);
});

// Graceful shutdown
async function shutdown() {
  console.log("[Main] Shutting down gracefully...");
  server.close(async () => {
    console.log("[Main] Express server closed");
    grpcServer.tryShutdown(() => {
      console.log("[Main] gRPC server closed");
      process.exit(0);
    });
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  console.error("[Main] Uncaught exception:", error);
  await shutdown();
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("[Main] Unhandled rejection at:", promise, "reason:", reason);
  await shutdown();
});
