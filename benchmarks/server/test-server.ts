import express, { Request, Response } from "express";
import crypto from "crypto";
import http from "http";

export interface TestServerConfig {
  port?: number;
  host?: string;
}

export class TestServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private port: number;
  private host: string;

  constructor(config: TestServerConfig = {}) {
    this.port = config.port || 0; // 0 = random port
    this.host = config.host || "127.0.0.1";
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Parse JSON bodies
    this.app.use(express.json({ limit: "50mb" }));

    // Health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok" });
    });

    // Simple endpoint - minimal processing
    this.app.get("/api/simple", (_req: Request, res: Response) => {
      res.json({ message: "Hello World", timestamp: Date.now() });
    });

    // Echo endpoint - returns what you send
    this.app.post("/api/echo", (req: Request, res: Response) => {
      res.json(req.body);
    });

    // Small payload endpoint (1KB)
    this.app.get("/api/small", (_req: Request, res: Response) => {
      const data = {
        id: "small-123",
        data: "x".repeat(1024), // 1KB of data
        timestamp: Date.now(),
      };
      res.json(data);
    });

    // Medium payload endpoint (100KB)
    this.app.get("/api/medium", (_req: Request, res: Response) => {
      const data = {
        id: "medium-456",
        data: "x".repeat(100 * 1024), // 100KB of data
        timestamp: Date.now(),
      };
      res.json(data);
    });

    // Large payload endpoint (1MB)
    this.app.get("/api/large", (_req: Request, res: Response) => {
      const data = {
        id: "large-789",
        data: "x".repeat(1024 * 1024), // 1MB of data
        timestamp: Date.now(),
      };
      res.json(data);
    });

    // Large POST endpoint - accepts and returns large payloads
    this.app.post("/api/large-post", (req: Request, res: Response) => {
      res.json({
        received: req.body,
        response: "x".repeat(1024 * 1024), // 1MB response
      });
    });

    // CPU-intensive endpoint - hashing
    this.app.post("/api/compute-hash", (req: Request, res: Response) => {
      const data = req.body.data || "default-data";
      const iterations = req.body.iterations || 1000;

      let hash = data;
      for (let i = 0; i < iterations; i++) {
        hash = crypto.createHash("sha256").update(hash).digest("hex");
      }

      res.json({ hash, iterations });
    });

    // CPU-intensive endpoint - JSON parsing/stringifying
    this.app.post("/api/compute-json", (req: Request, res: Response) => {
      const iterations = req.body.iterations || 100;
      const data = req.body.data || { test: "data", nested: { value: 123 } };

      let result = data;
      for (let i = 0; i < iterations; i++) {
        const str = JSON.stringify(result);
        result = JSON.parse(str);
        result.iteration = i;
      }

      res.json(result);
    });

    // Endpoint with sensitive data for transform testing
    this.app.post("/api/auth/login", (req: Request, res: Response) => {
      res.json({
        success: true,
        token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        user: {
          id: 123,
          email: req.body.email,
          role: "user",
        },
      });
    });

    // Endpoint with nested sensitive data
    this.app.post("/api/users", (req: Request, res: Response) => {
      res.json({
        id: Date.now(),
        username: req.body.username,
        profile: {
          email: req.body.email,
          ssn: req.body.ssn || "123-45-6789",
          creditCard: req.body.creditCard || "4111-1111-1111-1111",
        },
        createdAt: new Date().toISOString(),
      });
    });

    // Endpoint that makes an outbound HTTP call
    this.app.get("/api/proxy", async (_req: Request, res: Response) => {
      try {
        // Make a call to our own /api/simple endpoint
        const response = await fetch(`http://${this.host}:${this.port}/api/simple`);
        const data = await response.json();
        res.json({ proxied: data, timestamp: Date.now() });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Streaming endpoint for testing body capture
    this.app.post("/api/stream", (req: Request, res: Response) => {
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
      });
      req.on("end", () => {
        res.json({ receivedBytes: size });
      });
    });

    // Error endpoint
    this.app.get("/api/error", (_req: Request, res: Response) => {
      res.status(500).json({ error: "Internal Server Error" });
    });

    // Slow endpoint - simulates slow processing
    this.app.get("/api/slow", async (_req: Request, res: Response) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      res.json({ message: "Slow response", timestamp: Date.now() });
    });
  }

  async start(): Promise<{ port: number; host: string; url: string }> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          const address = this.server!.address();
          if (!address || typeof address === "string") {
            reject(new Error("Failed to get server address"));
            return;
          }
          this.port = address.port;
          const url = `http://${this.host}:${this.port}`;
          console.log(`Test server started at ${url}`);
          resolve({ port: this.port, host: this.host, url });
        });

        this.server.on("error", reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log("Test server stopped");
          this.server = null;
          resolve();
        }
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }

  getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }
}
