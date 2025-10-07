import { TuskDrift } from './tdInit.js';
import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Test endpoint using fetch GET
app.get("/test/fetch-get", async (req: Request, res: Response) => {
  try {
    const response = await fetch("https://jsonplaceholder.typicode.com/posts/1");
    const data = await response.json();

    console.log("data", data);
    console.log("response", response);

    res.json({
      success: true,
      data: data,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    });
  } catch (error: any) {
    console.log("error", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch POST
app.post("/test/fetch-post", async (req: Request, res: Response) => {
  try {
    const response = await fetch("https://jsonplaceholder.typicode.com/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    res.json({
      success: true,
      data: data,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch with custom headers
app.get("/test/fetch-headers", async (req: Request, res: Response) => {
  try {
    const response = await fetch("https://jsonplaceholder.typicode.com/posts/1", {
      method: "GET",
      headers: {
        "User-Agent": "TuskDrift-Test/1.0",
        "X-Custom-Header": "test-value",
        Accept: "application/json",
      },
    });

    const data = await response.json();

    res.json({
      success: true,
      data: data,
      status: response.status,
      requestHeaders: {
        "User-Agent": "TuskDrift-Test/1.0",
        "X-Custom-Header": "test-value",
        Accept: "application/json",
      },
      responseHeaders: Object.fromEntries(response.headers.entries()),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch with JSON response
app.get("/test/fetch-json", async (req: Request, res: Response) => {
  try {
    const response = await fetch("https://jsonplaceholder.typicode.com/users");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: any = await response.json();

    res.json({
      success: true,
      data: data.slice(0, 3), // Return first 3 users to keep response smaller
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch with URL object
app.get("/test/fetch-url-object", async (req: Request, res: Response) => {
  try {
    const url = new URL("https://jsonplaceholder.typicode.com/posts");
    url.searchParams.append("_limit", "5");

    const response = await fetch(url);
    const data = await response.json();

    res.json({
      success: true,
      data: data,
      status: response.status,
      requestUrl: url.toString(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ success: true, message: "Fetch integration test server is ready" });
});

app.listen(PORT, () => {
  TuskDrift.markAppAsReady();
  console.log(`Fetch integration test server running on port ${PORT}`);
  console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE || "record"}`);
  console.log('Available endpoints:');
  console.log('  GET  /health - Health check');
  console.log('  GET  /test/fetch-get - Test fetch GET');
  console.log('  POST /test/fetch-post - Test fetch POST');
  console.log('  GET  /test/fetch-headers - Test fetch with custom headers');
  console.log('  GET  /test/fetch-json - Test fetch with JSON response');
  console.log('  GET  /test/fetch-url-object - Test fetch with URL object');
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully");
  process.exit(0);
});
