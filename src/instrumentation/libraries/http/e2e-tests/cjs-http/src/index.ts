import { TuskDrift } from "./tdInit";
import http from "http";
import https from "https";
import axios from "axios";

// Create HTTP server with test endpoints
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  try {
    // Test raw http.get
    if (url === "/test-http-get" && method === "GET") {
      const result = await new Promise<string>((resolve, reject) => {
        https
          .get("https://jsonplaceholder.typicode.com/posts/1", (response) => {
            let data = "";
            response.on("data", (chunk) => {
              data += chunk;
            });
            response.on("end", () => {
              resolve(data);
            });
          })
          .on("error", reject);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-http-get",
          result: JSON.parse(result),
        }),
      );
      return;
    }

    // Test raw http.request
    if (url === "/test-http-request" && method === "POST") {
      const result = await new Promise<string>((resolve, reject) => {
        const options = {
          hostname: "jsonplaceholder.typicode.com",
          port: 443,
          path: "/posts",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        };

        const request = https.request(options, (response) => {
          let data = "";
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => {
            resolve(data);
          });
        });

        request.on("error", reject);
        request.write(JSON.stringify({ test: "data" }));
        request.end();
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-http-request",
          result: JSON.parse(result),
        }),
      );
      return;
    }

    // Test https.get
    if (url === "/test-https-get" && method === "GET") {
      const result = await new Promise<string>((resolve, reject) => {
        https
          .get("https://jsonplaceholder.typicode.com/posts/1", (response) => {
            let data = "";
            response.on("data", (chunk) => {
              data += chunk;
            });
            response.on("end", () => {
              resolve(data);
            });
          })
          .on("error", reject);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-https-get",
          result: JSON.parse(result),
        }),
      );
      return;
    }

    // Test axios GET
    if (url === "/test-axios-get" && method === "GET") {
      const response = await axios.get("https://jsonplaceholder.typicode.com/posts/1");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-axios-get",
          result: response.data,
        }),
      );
      return;
    }

    // Test axios POST
    if (url === "/test-axios-post" && method === "POST") {
      const response = await axios.post("https://jsonplaceholder.typicode.com/posts", {
        test: "data from axios",
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-axios-post",
          result: response.data,
        }),
      );
      return;
    }

    // Health check endpoint
    if (url === "/health" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy" }));
      return;
    }

    if (url === "/test-url-object-get" && method === "GET") {
      const result = await new Promise<string>((resolve, reject) => {
        const urlObj = new URL("https://jsonplaceholder.typicode.com/posts/1");
        https
          .get(urlObj, (response) => {
            let data = "";
            response.on("data", (chunk) => {
              data += chunk;
            });
            response.on("end", () => {
              resolve(data);
            });
          })
          .on("error", reject);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-url-object-get",
          result: JSON.parse(result),
        }),
      );
      return;
    }

    if (url === "/test-url-object-request" && method === "POST") {
      const result = await new Promise<string>((resolve, reject) => {
        const urlObj = new URL("https://jsonplaceholder.typicode.com/posts");
        const request = https.request(
          urlObj,
          { method: "POST", headers: { "Content-Type": "application/json" } },
          (response) => {
            let data = "";
            response.on("data", (chunk) => {
              data += chunk;
            });
            response.on("end", () => {
              resolve(data);
            });
          },
        );

        request.on("error", reject);
        request.write(JSON.stringify({ test: "url-object-request" }));
        request.end();
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          endpoint: "/test-url-object-request",
          result: JSON.parse(result),
        }),
      );
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error("Error handling request:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  TuskDrift.markAppAsReady();
  console.log(`Server running on port ${PORT}`);
});
