import { AddressInfo } from "net";
import * as http from "http";
import type { Request, Response } from "express";

export async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  // Wait longer than the batch span processor delay (2000ms) to ensure spans are exported
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export interface TestServers {
  mainServer: http.Server;
  serviceServer: http.Server;
  mainServerPort: number;
  servicePort: number;
}

export async function setupTestServers(): Promise<TestServers> {
  const express = require("express");

  // Start service server (handles /api/sensitive, /api/user endpoints)
  const serviceApp = express();
  serviceApp.use(express.json());

  serviceApp.post("/api/sensitive", (req: Request, res: Response) => {
    res.json({
      status: "success",
      sensitiveData: "TOP_SECRET_123",
      userId: req.body.userId,
    });
  });

  serviceApp.get("/api/user", (_: Request, res: Response) => {
    res.json({ userId: 123, password: "secret456", apiKey: "key-789" });
  });

  const serviceServer = await new Promise<http.Server>((resolve) => {
    const s = serviceApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const servicePort = (serviceServer.address() as AddressInfo).port;

  // Start main server (makes fetch calls to service server)
  const mainApp = express();
  mainApp.use(express.json());

  mainApp.post("/call-sensitive", async (req: Request, res: Response) => {
    try {
      const response = await fetch(`http://127.0.0.1:${servicePort}/api/sensitive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      res.json({ upstream: data });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  mainApp.post("/echo", async (req: Request, res: Response) => {
    try {
      // Forward all headers from the incoming request
      const headers: Record<string, string> = {};
      Object.keys(req.headers).forEach((key) => {
        const value = req.headers[key];
        if (typeof value === "string") {
          headers[key] = value;
        } else if (Array.isArray(value)) {
          headers[key] = value.join(", ");
        }
      });

      const response = await fetch(`http://127.0.0.1:${servicePort}/echo-internal`, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  mainApp.get("/fetch-user", async (_: Request, res: Response) => {
    try {
      const response = await fetch(`http://127.0.0.1:${servicePort}/api/user`);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  const mainServer = await new Promise<http.Server>((resolve) => {
    const s = mainApp.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const mainServerPort = (mainServer.address() as AddressInfo).port;

  // Add echo endpoint to service
  serviceApp.post("/echo-internal", (req: Request, res: Response) => {
    res.json(req.body);
  });

  return {
    mainServer,
    serviceServer,
    mainServerPort,
    servicePort,
  };
}

export async function cleanupServers(servers: TestServers): Promise<void> {
  await Promise.all([
    new Promise<void>((resolve) => servers.mainServer.close(() => resolve())),
    new Promise<void>((resolve) => servers.serviceServer.close(() => resolve())),
  ]);
}
