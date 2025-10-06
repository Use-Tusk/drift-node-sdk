import type * as http from "http";
import type * as express from "express";

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
  // IMPORTANT: Import at runtime to ensure TuskDrift patches are applied first
  // The test file must initialize TuskDrift BEFORE calling setupTestServers()
  const http = require("http");
  const express = require("express");

  // Start service A (sensitive service we want to drop)
  const serviceAApp = express();
  serviceAApp.use(express.json());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceAApp.post("/api/sensitive", (req: any, res: any) => {
    res.json({
      status: "success",
      sensitiveData: "TOP_SECRET_123",
      userId: req.body.userId,
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceAApp.get("/api/data", (req: any, res: any) => {
    res.json({ data: "public data from service A" });
  });

  const serviceAServer = await new Promise<http.Server>((resolve) => {
    const s = serviceAApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const serviceAPort = (serviceAServer.address() as any).port;

  // Start service B (normal service)
  const serviceBApp = express();
  serviceBApp.use(express.json());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceBApp.get("/api/public", (req: any, res: any) => {
    res.json({ message: "Hello from service B" });
  });

  const serviceBServer = await new Promise<http.Server>((resolve) => {
    const s = serviceBApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const serviceBPort = (serviceBServer.address() as any).port;

  // Start main server
  const mainApp = express();
  mainApp.use(express.json());

  // Endpoint that calls service A's sensitive endpoint using native http
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainApp.post("/call-service-a-sensitive", async (req: any, res: any) => {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpReq = http.request(options, (httpRes: any) => {
      let data = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      httpRes.on("data", (chunk: any) => (data += chunk));
      httpRes.on("end", () => {
        res.json({ upstream: JSON.parse(data) });
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpReq.on("error", (error: any) => {
      res.status(500).json({ error: error.message });
    });
    httpReq.write(postData);
    httpReq.end();
  });

  // Endpoint that calls service A's public endpoint using native http
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainApp.get("/call-service-a-public", async (req: any, res: any) => {
    const options = {
      hostname: "127.0.0.1",
      port: serviceAPort,
      path: "/api/data",
      method: "GET",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpReq = http.request(options, (httpRes: any) => {
      let data = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      httpRes.on("data", (chunk: any) => (data += chunk));
      httpRes.on("end", () => {
        res.json({ upstream: JSON.parse(data) });
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpReq.on("error", (error: any) => {
      res.status(500).json({ error: error.message });
    });
    httpReq.end();
  });

  // Endpoint that calls service B using native http
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainApp.get("/call-service-b", async (req: any, res: any) => {
    const options = {
      hostname: "127.0.0.1",
      port: serviceBPort,
      path: "/api/public",
      method: "GET",
      headers: { "X-API-Key": "super-secret-api-key-12345" },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const httpReq = http.request(options, (httpRes: any) => {
      let data = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      httpRes.on("data", (chunk: any) => (data += chunk));
      httpRes.on("end", () => {
        res.json({ upstream: JSON.parse(data) });
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpReq.on("error", (error: any) => {
      res.status(500).json({ error: error.message });
    });
    httpReq.end();
  });

  // Admin endpoint (should be dropped on inbound)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainApp.get("/admin/users", (req: any, res: any) => {
    res.json({ users: [{ id: 1, name: "Admin" }] });
  });

  // Login endpoint with password (should redact password)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainApp.post("/auth/login", (req: any, res: any) => {
    res.json({ success: true, token: "jwt-token" });
  });

  const mainServer = await new Promise<http.Server>((resolve) => {
    const s = mainApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const mainServerPort = (mainServer.address() as any).port;

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
