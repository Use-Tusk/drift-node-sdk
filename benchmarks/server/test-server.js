"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestServer = void 0;
const crypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const express = require("express");
class TestServer {
    constructor(config = {}) {
        this.server = null;
        this.port = config.port || 0; // 0 = random port
        this.host = config.host || "127.0.0.1";
        this.app = express();
        this.setupRoutes();
    }
    setupRoutes() {
        // Parse JSON bodies
        this.app.use(express.json({ limit: "50mb" }));
        // Health check endpoint
        this.app.get("/health", (_req, res) => {
            res.json({ status: "ok" });
        });
        // Simple endpoint - minimal processing
        this.app.get("/api/simple", (_req, res) => {
            res.json({ message: "Hello World", timestamp: Date.now() });
        });
        // Simple POST endpoint - minimal processing with small request body
        this.app.post("/api/simple-post", (req, res) => {
            res.json({ message: "Hello World", timestamp: Date.now() });
        });
        // Echo endpoint - returns what you send
        this.app.post("/api/echo", (req, res) => {
            res.json(req.body);
        });
        // Small payload endpoint (100KB)
        this.app.get("/api/small", (_req, res) => {
            const data = {
                id: "small-123",
                data: "x".repeat(100 * 1024), // 100KB of data
                timestamp: Date.now(),
            };
            res.json(data);
        });
        // Small POST endpoint - accepts and returns same size payload as GET
        this.app.post("/api/small-post", (req, res) => {
            res.json({
                id: "small-post-123",
                data: "x".repeat(100 * 1024), // 100KB of data
                timestamp: Date.now(),
            });
        });
        // Medium payload endpoint (1MB)
        this.app.get("/api/medium", (_req, res) => {
            const data = {
                id: "medium-456",
                data: "x".repeat(1024 * 1024), // 1MB of data
                timestamp: Date.now(),
            };
            res.json(data);
        });
        // Medium POST endpoint - accepts and returns same size payload as GET
        this.app.post("/api/medium-post", (req, res) => {
            res.json({
                id: "medium-post-456",
                data: "x".repeat(1024 * 1024), // 1MB of data
                timestamp: Date.now(),
            });
        });
        // Large payload endpoint (2MB)
        this.app.get("/api/large", (_req, res) => {
            const data = {
                id: "large-789",
                data: "x".repeat(2 * 1024 * 1024), // 2MB of data
                timestamp: Date.now(),
            };
            res.json(data);
        });
        // Large POST endpoint - accepts and returns same size payload as GET
        this.app.post("/api/large-post", (req, res) => {
            res.json({
                id: "large-post-789",
                data: "x".repeat(2 * 1024 * 1024), // 2MB of data
                timestamp: Date.now(),
            });
        });
        // CPU-intensive endpoint - hashing
        this.app.post("/api/compute-hash", (req, res) => {
            const data = req.body.data || "default-data";
            const iterations = req.body.iterations || 1000;
            let hash = data;
            for (let i = 0; i < iterations; i++) {
                hash = crypto.createHash("sha256").update(hash).digest("hex");
            }
            res.json({ hash, iterations });
        });
        // CPU-intensive endpoint - JSON parsing/stringifying
        this.app.post("/api/compute-json", (req, res) => {
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
        this.app.post("/api/auth/login", (req, res) => {
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
        this.app.post("/api/users", (req, res) => {
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
        this.app.get("/api/proxy", (_req, res) => __awaiter(this, void 0, void 0, function* () {
            try {
                // Make a call to our own /api/simple endpoint
                const response = yield fetch(`http://${this.host}:${this.port}/api/simple`);
                const data = yield response.json();
                res.json({ proxied: data, timestamp: Date.now() });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        }));
        // Streaming endpoint for testing body capture
        this.app.post("/api/stream", (req, res) => {
            let size = 0;
            req.on("data", (chunk) => {
                size += chunk.length;
            });
            req.on("end", () => {
                res.json({ receivedBytes: size });
            });
        });
        // Error endpoint
        this.app.get("/api/error", (_req, res) => {
            res.status(500).json({ error: "Internal Server Error" });
        });
        // Slow endpoint - simulates slow processing
        this.app.get("/api/slow", (_req, res) => __awaiter(this, void 0, void 0, function* () {
            yield new Promise((resolve) => setTimeout(resolve, 100));
            res.json({ message: "Slow response", timestamp: Date.now() });
        }));
        // High IO, Low CPU endpoint - simulates IO-bound work with minimal CPU usage
        // Multiple small async operations that await on timers
        this.app.post("/api/io-bound", (req, res) => __awaiter(this, void 0, void 0, function* () {
            const jobs = req.body.jobs || 5;
            const delayMs = req.body.delayMs || 5;
            const results = [];
            for (let i = 0; i < jobs; i++) {
                // Simulate an IO operation (database query, file read, external API call, etc.)
                yield new Promise((resolve) => setTimeout(resolve, delayMs));
                results.push({
                    jobId: i,
                    timestamp: Date.now(),
                    status: "completed",
                });
            }
            res.json({
                totalJobs: jobs,
                results,
                completedAt: Date.now(),
            });
        }));
    }
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                try {
                    this.server = this.app.listen(this.port, this.host, () => {
                        const address = this.server.address();
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
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                if (!this.server) {
                    resolve();
                    return;
                }
                this.server.close((err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        console.log("Test server stopped");
                        this.server = null;
                        resolve();
                    }
                });
            });
        });
    }
    getPort() {
        return this.port;
    }
    getHost() {
        return this.host;
    }
    getUrl() {
        return `http://${this.host}:${this.port}`;
    }
}
exports.TestServer = TestServer;
