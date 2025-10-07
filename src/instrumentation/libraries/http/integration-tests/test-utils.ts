import { AddressInfo } from "net";

export async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  // Wait longer than the batch span processor delay (2000ms) to ensure spans are exported
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export interface TestServers {
  mainServer: http.Server;
  serviceAServer: http.Server;
  serviceBServer: http.Server;
  mainServerPort: number;
  serviceAPort: number;
  serviceBPort: number;
}

export async function setupTestServers(): Promise<TestServers> {
  const http = require("http");
  const express = require("express");
  // Start service A (sensitive service we want to drop)
  const serviceAApp = express();
  serviceAApp.use(express.json());

  serviceAApp.post("/api/sensitive", (req, res) => {
    res.json({
      status: "success",
      sensitiveData: "TOP_SECRET_123",
      userId: req.body.userId,
    });
  });

  serviceAApp.get("/api/data", (_, res) => {
    res.json({ data: "public data from service A" });
  });

  const serviceAServer = await new Promise<http.Server>((resolve) => {
    const s = serviceAApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const serviceAPort = (serviceAServer.address() as AddressInfo).port;

  // Start service B (normal service)
  const serviceBApp = express();
  serviceBApp.use(express.json());

  serviceBApp.get("/api/public", (_, res) => {
    res.json({ message: "Hello from service B" });
  });

  const serviceBServer = await new Promise<http.Server>((resolve) => {
    const s = serviceBApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const serviceBPort = (serviceBServer.address() as AddressInfo).port;

  // Start main server
  const mainApp = express();
  mainApp.use(express.json());

  // Endpoint that calls service A's sensitive endpoint using native http
  mainApp.post("/call-service-a-sensitive", async (req, res) => {
    const postData = JSON.stringify({ userId: req.body.userId });
    const options = {
      hostname: "127.0.0.1",
      port: serviceAPort,
      path: "/api/sensitive",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const httpReq = http.request(options, (httpRes) => {
      let data = "";
      httpRes.on("data", (chunk) => (data += chunk));
      httpRes.on("end", () => {
        res.json({ upstream: JSON.parse(data) });
      });
    });
    httpReq.on("error", (error) => {
      res.status(500).json({ error: error.message });
    });
    httpReq.write(postData);
    httpReq.end();
  });

  // Endpoint that calls service A's public endpoint using native http
  mainApp.get("/call-service-a-public", async (_, res) => {
    const options = {
      hostname: "127.0.0.1",
      port: serviceAPort,
      path: "/api/data",
      method: "GET",
    };

    const httpReq = http.request(options, (httpRes) => {
      let data = "";
      httpRes.on("data", (chunk) => (data += chunk));
      httpRes.on("end", () => {
        res.json({ upstream: JSON.parse(data) });
      });
    });
    httpReq.on("error", (error) => {
      res.status(500).json({ error: error.message });
    });
    httpReq.end();
  });

  // Endpoint that calls service B using native http
  mainApp.get("/call-service-b", async (_, res) => {
    const options = {
      hostname: "127.0.0.1",
      port: serviceBPort,
      path: "/api/public",
      method: "GET",
      headers: { "X-API-Key": "super-secret-api-key-12345" },
    };

    const httpReq = http.request(options, (httpRes) => {
      let data = "";
      httpRes.on("data", (chunk) => (data += chunk));
      httpRes.on("end", () => {
        res.json({ upstream: JSON.parse(data) });
      });
    });
    httpReq.on("error", (error) => {
      res.status(500).json({ error: error.message });
    });
    httpReq.end();
  });

  // Admin endpoint (should be dropped on inbound)
  mainApp.get("/admin/users", (_, res) => {
    res.json({ users: [{ id: 1, name: "Admin" }] });
  });

  // Login endpoint with password (should redact password)
  mainApp.post("/auth/login", (_, res) => {
    res.json({ success: true, token: "jwt-token" });
  });

  const mainServer = await new Promise<http.Server>((resolve) => {
    const s = mainApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const mainServerPort = (mainServer.address() as AddressInfo).port;

  return {
    mainServer,
    serviceAServer,
    serviceBServer,
    mainServerPort,
    serviceAPort,
    serviceBPort,
  };
}

export async function cleanupServers(servers: TestServers): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    servers.mainServer.close((err) => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    servers.serviceAServer.close((err) => (err ? reject(err) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    servers.serviceBServer.close((err) => (err ? reject(err) : resolve())),
  );
}
