import { TuskDrift } from "./tdInit.js";
import express, { Request, Response } from "express";
import Redis from "ioredis";

const PORT = process.env.PORT || 3000;

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || "redis",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

let redis: Redis;

async function initializeRedis() {
  console.log(`Connecting to Redis: ${redisConfig.host}:${redisConfig.port}`);

  // Initialize Redis client
  redis = new Redis(redisConfig);

  // Wait for Redis to be ready
  await new Promise((resolve, reject) => {
    redis.on("ready", () => {
      console.log("Redis client connected and ready");
      resolve(true);
    });
    redis.on("error", (err) => {
      console.error("Redis connection error:", err);
      // Don't reject immediately - let retry strategy handle it
    });
  });

  // Seed some test data
  await redis.set("test:key1", "value1");
  await redis.set("test:key2", "value2");
  await redis.set("test:key3", "value3");

  // Test hash data
  await redis.hset("test:user:1", "name", "John Doe");
  await redis.hset("test:user:1", "email", "john@example.com");
  await redis.hset("test:user:1", "age", "30");

  // Test list data
  await redis.rpush("test:list", "item1", "item2", "item3");

  // Test set data
  await redis.sadd("test:set", "member1", "member2", "member3");

  // Test sorted set data
  await redis.zadd("test:zset", 1, "score1", 2, "score2", 3, "score3");

  // Test counter
  await redis.set("test:counter", "0");

  console.log("Redis initialized with test data successfully");
}

// Create Express app with test endpoints
const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ success: true });
});

// Test basic GET operation
app.get("/test/get", async (req: Request, res: Response) => {
  try {
    const value = await redis.get("test:key1");
    res.json({
      success: true,
      data: { value },
      operation: "GET",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test basic SET operation
app.post("/test/set", async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    await redis.set(key, value);
    res.json({
      success: true,
      operation: "SET",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test DEL operation
app.post("/test/del", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    const result = await redis.del(key);
    res.json({
      success: true,
      data: { deletedCount: result },
      operation: "DEL",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test EXISTS operation
app.post("/test/exists", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    const exists = await redis.exists(key);
    res.json({
      success: true,
      data: { exists: exists === 1 },
      operation: "EXISTS",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test EXPIRE operation
app.post("/test/expire", async (req: Request, res: Response) => {
  try {
    const { key, seconds } = req.body;
    const result = await redis.expire(key, seconds);
    res.json({
      success: true,
      data: { result: result === 1 },
      operation: "EXPIRE",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test TTL operation
app.post("/test/ttl", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    const ttl = await redis.ttl(key);
    res.json({
      success: true,
      data: { ttl },
      operation: "TTL",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test INCR operation
app.get("/test/incr", async (req: Request, res: Response) => {
  try {
    const value = await redis.incr("test:counter");
    res.json({
      success: true,
      data: { value },
      operation: "INCR",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test DECR operation
app.get("/test/decr", async (req: Request, res: Response) => {
  try {
    const value = await redis.decr("test:counter");
    res.json({
      success: true,
      data: { value },
      operation: "DECR",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test MGET (multiple get)
app.get("/test/mget", async (req: Request, res: Response) => {
  try {
    const values = await redis.mget("test:key1", "test:key2", "test:key3");
    res.json({
      success: true,
      data: { values },
      operation: "MGET",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test MSET (multiple set)
app.post("/test/mset", async (req: Request, res: Response) => {
  try {
    await redis.mset("test:mkey1", "mvalue1", "test:mkey2", "mvalue2");
    res.json({
      success: true,
      operation: "MSET",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test HGET (hash get)
app.get("/test/hget", async (req: Request, res: Response) => {
  try {
    const name = await redis.hget("test:user:1", "name");
    res.json({
      success: true,
      data: { name },
      operation: "HGET",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test HSET (hash set)
app.post("/test/hset", async (req: Request, res: Response) => {
  try {
    const { key, field, value } = req.body;
    const result = await redis.hset(key, field, value);
    res.json({
      success: true,
      data: { result },
      operation: "HSET",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test HGETALL (get all hash fields)
app.get("/test/hgetall", async (req: Request, res: Response) => {
  try {
    const user = await redis.hgetall("test:user:1");
    res.json({
      success: true,
      data: { user },
      operation: "HGETALL",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test HDEL (hash delete)
app.post("/test/hdel", async (req: Request, res: Response) => {
  try {
    const { key, field } = req.body;
    const result = await redis.hdel(key, field);
    res.json({
      success: true,
      data: { deletedCount: result },
      operation: "HDEL",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test LPUSH (list push left)
app.post("/test/lpush", async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    const length = await redis.lpush(key, value);
    res.json({
      success: true,
      data: { length },
      operation: "LPUSH",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test RPUSH (list push right)
app.post("/test/rpush", async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    const length = await redis.rpush(key, value);
    res.json({
      success: true,
      data: { length },
      operation: "RPUSH",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test LPOP (list pop left)
app.post("/test/lpop", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    const value = await redis.lpop(key);
    res.json({
      success: true,
      data: { value },
      operation: "LPOP",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test RPOP (list pop right)
app.post("/test/rpop", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    const value = await redis.rpop(key);
    res.json({
      success: true,
      data: { value },
      operation: "RPOP",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test LRANGE (list range)
app.get("/test/lrange", async (req: Request, res: Response) => {
  try {
    const items = await redis.lrange("test:list", 0, -1);
    res.json({
      success: true,
      data: { items },
      operation: "LRANGE",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test LLEN (list length)
app.post("/test/llen", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    const length = await redis.llen(key);
    res.json({
      success: true,
      data: { length },
      operation: "LLEN",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test SADD (set add)
app.post("/test/sadd", async (req: Request, res: Response) => {
  try {
    const { key, member } = req.body;
    const result = await redis.sadd(key, member);
    res.json({
      success: true,
      data: { addedCount: result },
      operation: "SADD",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test SREM (set remove)
app.post("/test/srem", async (req: Request, res: Response) => {
  try {
    const { key, member } = req.body;
    const result = await redis.srem(key, member);
    res.json({
      success: true,
      data: { removedCount: result },
      operation: "SREM",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test SMEMBERS (get all set members)
app.get("/test/smembers", async (req: Request, res: Response) => {
  try {
    const members = await redis.smembers("test:set");
    res.json({
      success: true,
      data: { members },
      operation: "SMEMBERS",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test SISMEMBER (check set membership)
app.post("/test/sismember", async (req: Request, res: Response) => {
  try {
    const { key, member } = req.body;
    const isMember = await redis.sismember(key, member);
    res.json({
      success: true,
      data: { isMember: isMember === 1 },
      operation: "SISMEMBER",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test ZADD (sorted set add)
app.post("/test/zadd", async (req: Request, res: Response) => {
  try {
    const { key, score, member } = req.body;
    const result = await redis.zadd(key, score, member);
    res.json({
      success: true,
      data: { addedCount: result },
      operation: "ZADD",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test ZRANGE (sorted set range)
app.get("/test/zrange", async (req: Request, res: Response) => {
  try {
    const members = await redis.zrange("test:zset", 0, -1);
    res.json({
      success: true,
      data: { members },
      operation: "ZRANGE",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test ZREM (sorted set remove)
app.post("/test/zrem", async (req: Request, res: Response) => {
  try {
    const { key, member } = req.body;
    const result = await redis.zrem(key, member);
    res.json({
      success: true,
      data: { removedCount: result },
      operation: "ZREM",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test ZSCORE (get sorted set member score)
app.post("/test/zscore", async (req: Request, res: Response) => {
  try {
    const { key, member } = req.body;
    const score = await redis.zscore(key, member);
    res.json({
      success: true,
      data: { score },
      operation: "ZSCORE",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test KEYS (pattern matching)
app.post("/test/keys", async (req: Request, res: Response) => {
  try {
    const { pattern } = req.body;
    const keys = await redis.keys(pattern);
    res.json({
      success: true,
      data: { keys },
      operation: "KEYS",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test FLUSHDB (clear current database)
app.post("/test/flushdb", async (req: Request, res: Response) => {
  try {
    await redis.flushdb();
    // Re-seed test data
    await redis.set("test:key1", "value1");
    await redis.set("test:key2", "value2");
    res.json({
      success: true,
      operation: "FLUSHDB",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test PING
app.get("/test/ping", async (req: Request, res: Response) => {
  try {
    const result = await redis.ping();
    res.json({
      success: true,
      data: { result },
      operation: "PING",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test Pipeline (batch commands)
app.get("/test/pipeline", async (req: Request, res: Response) => {
  try {
    const pipeline = redis.pipeline();
    pipeline.set("test:pipe1", "value1");
    pipeline.set("test:pipe2", "value2");
    pipeline.get("test:pipe1");
    pipeline.get("test:pipe2");
    const results = await pipeline.exec();
    res.json({
      success: true,
      data: { results },
      operation: "PIPELINE",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test Multi (transaction)
app.get("/test/multi", async (req: Request, res: Response) => {
  try {
    const multi = redis.multi();
    multi.set("test:multi1", "value1");
    multi.set("test:multi2", "value2");
    multi.get("test:multi1");
    const results = await multi.exec();
    res.json({
      success: true,
      data: { results },
      operation: "MULTI",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test new client connection - this surfaces the 'ready' event issue during replay
app.get("/test/new-client", async (req: Request, res: Response) => {
  try {
    // Create a new Redis client within the request handler
    const newClient = new Redis(redisConfig);

    // Wait for the client to be ready - this is where the 'ready' event must be emitted
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for Redis client to be ready"));
      }, 5000);

      newClient.on("ready", () => {
        clearTimeout(timeout);
        resolve();
      });

      newClient.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Perform a simple operation with the new client
    const result = await newClient.ping();

    // Clean up
    await newClient.quit();

    res.json({
      success: true,
      data: { result },
      operation: "NEW_CLIENT",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test Buffer commands
app.get("/test/getbuffer", async (req: Request, res: Response) => {
  try {
    // Set a binary value
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    await redis.set("test:binary", binaryData);

    // Get it back as buffer
    const result = await redis.getBuffer("test:binary");

    res.json({
      success: true,
      data: {
        isBuffer: Buffer.isBuffer(result),
        base64: result ? result.toString("base64") : null,
        length: result ? result.length : 0,
      },
      operation: "GETBUFFER",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test mgetBuffer
app.get("/test/mgetbuffer", async (req: Request, res: Response) => {
  try {
    // Set some values
    await redis.set("test:mget:1", "value1");
    await redis.set("test:mget:2", "value2");

    // Get multiple values as buffers
    const result = await redis.mgetBuffer("test:mget:1", "test:mget:2");

    // Check if results are Buffers
    const isFirstBuffer = Buffer.isBuffer(result[0]);
    const isSecondBuffer = Buffer.isBuffer(result[1]);

    res.json({
      success: true,
      data: {
        count: result.length,
        isFirstBuffer,
        isSecondBuffer,
        firstValue: isFirstBuffer ? (result[0] as Buffer).toString() : String(result[0]),
        secondValue: isSecondBuffer ? (result[1] as Buffer).toString() : String(result[1]),
      },
      operation: "MGETBUFFER",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start server and initialize Redis
app.listen(PORT, async () => {
  try {
    await initializeRedis();
    TuskDrift.markAppAsReady();
    console.log(`Redis integration test server running on port ${PORT}`);
    console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  try {
    await redis.quit();
  } catch (error) {
    console.error("Error during shutdown:", error);
  }
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
