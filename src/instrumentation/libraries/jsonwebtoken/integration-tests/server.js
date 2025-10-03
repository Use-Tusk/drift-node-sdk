const { TuskDrift } = require("tusk-drift-sdk");

TuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

const express = require("express");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Test secrets and tokens
const TEST_SECRET = "test-secret-key-for-jwt-testing-12345";

// Pre-generated tokens for testing
let VALID_TOKEN;
let EXPIRED_TOKEN;

function initializeTestTokens() {
  // Create a valid token
  VALID_TOKEN = jwt.sign({ userId: 123, username: "testuser" }, TEST_SECRET, {
    expiresIn: "1h",
    issuer: "test-issuer",
  });

  // Create an expired token (expires in 1ms, then wait)
  EXPIRED_TOKEN = jwt.sign({ userId: 456, username: "expireduser" }, TEST_SECRET, {
    expiresIn: "1ms",
  });

  console.log("Test tokens initialized");
  console.log(`Valid token: ${VALID_TOKEN.substring(0, 50)}...`);
  console.log(`Expired token: ${EXPIRED_TOKEN.substring(0, 50)}...`);
}

// JWT Sign - Synchronous
app.post("/test/jwt-sign-sync", async (req, res) => {
  try {
    const { payload, secret, options } = req.body;
    const token = await Promise.resolve(jwt.sign(payload, secret || TEST_SECRET, options));

    res.json({
      success: true,
      token: token,
      operationType: "sign-sync",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      operationType: "sign-sync",
    });
  }
});

// JWT Sign - Asynchronous (callback)
app.post("/test/jwt-sign-async", async (req, res) => {
  try {
    const { payload, secret, options } = req.body;

    jwt.sign(payload, secret || TEST_SECRET, options || {}, (error, token) => {
      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          operationType: "sign-async",
        });
      } else {
        res.json({
          success: true,
          token: token,
          operationType: "sign-async",
        });
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      operationType: "sign-async",
    });
  }
});

// JWT Verify - Synchronous
app.post("/test/jwt-verify-sync", async (req, res) => {
  try {
    const { token, secret, options } = req.body;
    const tokenToVerify = token === "valid-jwt-token-placeholder" ? VALID_TOKEN : token;

    const decoded = await Promise.resolve(
      jwt.verify(tokenToVerify, secret || TEST_SECRET, options),
    );

    res.json({
      success: true,
      decoded: decoded,
      operationType: "verify-sync",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: error.name,
      operationType: "verify-sync",
    });
  }
});

// JWT Verify - Asynchronous (callback)
app.post("/test/jwt-verify-async", async (req, res) => {
  try {
    const { token, secret, options } = req.body;
    const tokenToVerify = token === "valid-jwt-token-placeholder" ? VALID_TOKEN : token;

    jwt.verify(tokenToVerify, secret || TEST_SECRET, options || {}, (error, decoded) => {
      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          errorType: error.name,
          operationType: "verify-async",
        });
      } else {
        res.json({
          success: true,
          decoded: decoded,
          operationType: "verify-async",
        });
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      operationType: "verify-async",
    });
  }
});

// JWT Sign - With Options
app.post("/test/jwt-sign-with-options", async (req, res) => {
  try {
    const { payload, secret, options } = req.body;

    const token = await Promise.resolve(
      jwt.sign(
        payload,
        secret || TEST_SECRET,
        options || { expiresIn: "1h", issuer: "test-issuer" },
      ),
    );

    res.json({
      success: true,
      token: token,
      operationType: "sign-with-options",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      operationType: "sign-with-options",
    });
  }
});

// JWT Verify - With Options
app.post("/test/jwt-verify-with-options", async (req, res) => {
  try {
    const { token, secret, options } = req.body;
    const tokenToVerify = token === "valid-jwt-token-placeholder" ? VALID_TOKEN : token;

    const decoded = await Promise.resolve(
      jwt.verify(tokenToVerify, secret || TEST_SECRET, options || { issuer: "test-issuer" }),
    );

    res.json({
      success: true,
      decoded: decoded,
      operationType: "verify-with-options",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: error.name,
      operationType: "verify-with-options",
    });
  }
});

// JWT Decode (no verification)
app.post("/test/jwt-decode", async (req, res) => {
  try {
    const { token, options } = req.body;
    const tokenToDecode = token === "valid-jwt-token-placeholder" ? VALID_TOKEN : token;

    const decoded = await Promise.resolve(jwt.decode(tokenToDecode, options));

    res.json({
      success: true,
      decoded: decoded,
      operationType: "decode",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      operationType: "decode",
    });
  }
});

// Test endpoint for callback-based verify with complete option
app.post("/test/jwt-verify-complete-async", async (req, res) => {
  try {
    const { token, secret } = req.body;
    const tokenToVerify = token === "valid-jwt-token-placeholder" ? VALID_TOKEN : token;

    jwt.verify(tokenToVerify, secret || TEST_SECRET, { complete: true }, (error, decoded) => {
      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          errorType: error.name,
          operationType: "verify-complete-async",
        });
      } else {
        res.json({
          success: true,
          decoded: decoded,
          operationType: "verify-complete-async",
        });
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      operationType: "verify-complete-async",
    });
  }
});

// Test endpoint for sync verify with complete option
app.post("/test/jwt-verify-complete-sync", async (req, res) => {
  try {
    const { token, secret } = req.body;
    const tokenToVerify = token === "valid-jwt-token-placeholder" ? VALID_TOKEN : token;

    const decoded = await Promise.resolve(
      jwt.verify(tokenToVerify, secret || TEST_SECRET, { complete: true }),
    );

    res.json({
      success: true,
      decoded: decoded,
      operationType: "verify-complete-sync",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      errorType: error.name,
      operationType: "verify-complete-sync",
    });
  }
});

app.get("/health", (req, res) => {
  if (TuskDrift.isAppReady()) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "App not ready" });
  }
});

// Start server
app.listen(PORT, async () => {
  try {
    // Initialize test tokens after a short delay to ensure they're properly created
    initializeTestTokens();

    // Mark app as ready
    TuskDrift.markAppAsReady();
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
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
