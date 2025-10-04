import http from "http";
import express from "express";
import axios from "axios";

export async function waitForSpans(timeoutMs: number = 500): Promise<void> {
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

  serviceAApp.get("/api/data", (req, res) => {
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

  serviceBApp.get("/api/public", (req, res) => {
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

  // Endpoint that calls service A's sensitive endpoint
  mainApp.post("/call-service-a-sensitive", async (req, res) => {
    try {
      const response = await axios.post(
        `http://127.0.0.1:${serviceAPort}/api/sensitive`,
        { userId: req.body.userId },
        { proxy: false },
      );
      res.json({ upstream: response.data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint that calls service A's public endpoint
  mainApp.get("/call-service-a-public", async (req, res) => {
    try {
      const response = await axios.get(`http://127.0.0.1:${serviceAPort}/api/data`, {
        proxy: false,
      });
      res.json({ upstream: response.data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Endpoint that calls service B
  mainApp.get("/call-service-b", async (req, res) => {
    try {
      const response = await axios.get(`http://127.0.0.1:${serviceBPort}/api/public`, {
        headers: { "X-API-Key": "super-secret-api-key-12345" },
        proxy: false,
      });
      res.json({ upstream: response.data });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint (should be dropped on inbound)
  mainApp.get("/admin/users", (req, res) => {
    res.json({ users: [{ id: 1, name: "Admin" }] });
  });

  // Login endpoint with password (should redact password)
  mainApp.post("/auth/login", (req, res) => {
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
