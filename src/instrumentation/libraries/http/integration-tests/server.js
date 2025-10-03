const { TuskDrift } = require("tusk-drift-sdk");

TuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

const express = require("express");
const axios = require("axios");
const https = require("https");
const { randomUUID } = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Test endpoint using axios GET
app.get("/test/axios-get", async (req, res) => {
  try {
    const response = await axios.get("https://jsonplaceholder.typicode.com/posts/1");
    res.json({
      success: true,
      data: response.data,
      status: response.status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// add a post endpoint that returns a json object
app.post("/test/https-post", async (req, res) => {
  try {
    const response = await axios.post("https://jsonplaceholder.typicode.com/posts", req.body);
    res.json({
      success: true,
      data: response.data,
      status: response.status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using native http module
app.get("/test/http-get", async (req, res) => {
  const options = {
    hostname: "jsonplaceholder.typicode.com",
    port: 443,
    path: "/posts/1",
    method: "GET",
  };

  const httpsReq = https.request(options, (httpsRes) => {
    let data = "";

    httpsRes.on("data", (chunk) => {
      data += chunk;
    });

    httpsRes.on("end", () => {
      try {
        const parsedData = JSON.parse(data);
        res.json({
          success: true,
          data: parsedData,
          status: httpsRes.statusCode,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });
  });

  httpsReq.on("error", (error) => {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  });

  httpsReq.end();
});

// Test endpoint using native https module
app.get("/test/https-get", async (req, res) => {
  const options = {
    hostname: "jsonplaceholder.typicode.com",
    port: 443,
    path: "/users",
    method: "GET",
  };

  const httpsReq = https.request(options, (httpsRes) => {
    let data = "";

    httpsRes.on("data", (chunk) => {
      data += chunk;
    });

    httpsRes.on("end", () => {
      try {
        const parsedData = JSON.parse(data);
        res.json({
          success: true,
          data: parsedData,
          status: httpsRes.statusCode,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });
  });

  httpsReq.on("error", (error) => {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  });

  httpsReq.end();
});

// Test endpoint using native http module with POST
app.post("/test/http-post", async (req, res) => {
  const postData = JSON.stringify({
    title: "test from tusk-drift http",
    body: "test post data",
    userId: 1,
    ...req.body,
  });

  const options = {
    hostname: "jsonplaceholder.typicode.com",
    port: 443,
    path: "/posts",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  const httpsReq = https.request(options, (httpsRes) => {
    let data = "";

    httpsRes.on("data", (chunk) => {
      data += chunk;
    });

    httpsRes.on("end", () => {
      try {
        const parsedData = JSON.parse(data);
        res.json({
          success: true,
          data: parsedData,
          status: httpsRes.statusCode,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });
  });

  httpsReq.on("error", (error) => {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  });

  httpsReq.write(postData);
  httpsReq.end();
});

// Weather endpoint that tests redirects
app.get("/weather", async (req, res) => {
  try {
    // Default to a generic location if none provided
    const weatherLocation = req.query.location || "San Francisco";

    const response = await axios.get(
      `http://wttr.in/${encodeURIComponent(weatherLocation)}?format=j1`,
    );

    console.log("Weather API call successful", { location: weatherLocation });

    const randomId = randomUUID();

    // Extract only the requested fields from current conditions
    const currentCondition = response.data.current_condition[0];
    const current = {
      temp_F: currentCondition.temp_F,
      humidity: currentCondition.humidity,
      localObsDateTime: currentCondition.localObsDateTime,
      weatherDesc: currentCondition.weatherDesc[0].value,
      pressure: currentCondition.pressure,
    };

    res.json({
      location: weatherLocation,
      current,
      source: "wttr.in",
    });
  } catch (error) {
    console.error("Error getting weather data", { error, location: req.query.location });
    res.status(500).json({
      error: "Failed to fetch weather data",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  if (TuskDrift.isAppReady()) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "App not ready" });
  }
});

app.listen(PORT, () => {
  TuskDrift.markAppAsReady();
  console.log(`HTTP integration test server running on port ${PORT}`);
  console.log(`Test mode: ${process.env.TEST_MODE || "record"}`);
});
