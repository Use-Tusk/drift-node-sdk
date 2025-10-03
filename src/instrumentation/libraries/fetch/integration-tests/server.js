const { TuskDrift } = require("tusk-drift-sdk");

TuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Test endpoint using fetch GET
app.get("/test/fetch-get", async (req, res) => {
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
  } catch (error) {
    console.log("error", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch POST
app.post("/test/fetch-post", async (req, res) => {
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch with custom headers
app.get("/test/fetch-headers", async (req, res) => {
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch with JSON response
app.get("/test/fetch-json", async (req, res) => {
  try {
    const response = await fetch("https://jsonplaceholder.typicode.com/users");

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    res.json({
      success: true,
      data: data.slice(0, 3), // Return first 3 users to keep response smaller
      status: response.status,
      contentType: response.headers.get("content-type"),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using fetch with URL object
app.get("/test/fetch-url-object", async (req, res) => {
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  if (TuskDrift.isAppReady()) {
    res.json({ success: true, message: "Fetch integration test server is ready" });
  } else {
    res.status(500).json({ success: false, error: "App not ready" });
  }
});

app.listen(PORT, () => {
  TuskDrift.markAppAsReady();
  console.log(`Fetch integration test server running on port ${PORT}`);
  console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE || "record"}`);
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
