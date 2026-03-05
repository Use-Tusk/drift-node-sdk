import { TuskDrift } from "./tdInit";
import express, { Request, Response } from "express";
import { createClient, RedisClientType } from "redis";

const PORT = process.env.PORT || 3000;

// Redis configuration
const redisConfig = {
  socket: {
    host: process.env.REDIS_HOST || "redis",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    reconnectStrategy(retries: number) {
      const delay = Math.min(retries * 50, 2000);
      return delay;
    },
  },
};

let redis: RedisClientType;

async function initializeRedis() {
  console.log(`Connecting to Redis: ${redisConfig.socket.host}:${redisConfig.socket.port}`);

  // Initialize Redis client
  redis = createClient(redisConfig);

  redis.on("error", (err) => {
    console.error("Redis connection error:", err);
  });

  redis.on("ready", () => {
    console.log("Redis client connected and ready");
  });

  // node-redis requires explicit connect()
  await redis.connect();

  // Seed some test data
  await redis.set("test:key1", "value1");
  await redis.set("test:key2", "value2");
  await redis.set("test:key3", "value3");

  // Test hash data
  await redis.hSet("test:user:1", "name", "John Doe");
  await redis.hSet("test:user:1", "email", "john@example.com");
  await redis.hSet("test:user:1", "age", "30");

  // Test list data
  await redis.rPush("test:list", ["item1", "item2", "item3"]);

  // Test set data
  await redis.sAdd("test:set", ["member1", "member2", "member3"]);

  // Test sorted set data
  await redis.zAdd("test:zset", [
    { score: 1, value: "score1" },
    { score: 2, value: "score2" },
    { score: 3, value: "score3" },
  ]);

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
      data: { result },
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
    const values = await redis.mGet(["test:key1", "test:key2", "test:key3"]);
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
    await redis.mSet([
      ["test:mkey1", "mvalue1"],
      ["test:mkey2", "mvalue2"],
    ]);
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
    const name = await redis.hGet("test:user:1", "name");
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
    const result = await redis.hSet(key, field, value);
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
    const user = await redis.hGetAll("test:user:1");
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
    const result = await redis.hDel(key, field);
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
    const length = await redis.lPush(key, value);
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
    const length = await redis.rPush(key, value);
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
    const value = await redis.lPop(key);
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
    const value = await redis.rPop(key);
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
    const items = await redis.lRange("test:list", 0, -1);
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
    const length = await redis.lLen(key);
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
    const result = await redis.sAdd(key, member);
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
    const result = await redis.sRem(key, member);
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
    const members = await redis.sMembers("test:set");
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
    const isMember = await redis.sIsMember(key, member);
    res.json({
      success: true,
      data: { isMember },
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
    const result = await redis.zAdd(key, { score, value: member });
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
    const members = await redis.zRange("test:zset", 0, -1);
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
    const result = await redis.zRem(key, member);
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
    const score = await redis.zScore(key, member);
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
    await redis.flushDb();
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

// Test Multi (transaction)
app.get("/test/multi", async (req: Request, res: Response) => {
  try {
    const results = await redis
      .multi()
      .set("test:multi1", "value1")
      .set("test:multi2", "value2")
      .get("test:multi1")
      .exec();
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

// Test SET with expiry option
app.post("/test/set-with-expiry", async (req: Request, res: Response) => {
  try {
    const { key, value, seconds } = req.body;
    await redis.set(key, value, { EX: seconds });
    const ttl = await redis.ttl(key);
    res.json({
      success: true,
      data: { ttl },
      operation: "SET_WITH_EXPIRY",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test SET NX (set if not exists)
app.post("/test/set-nx", async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    const result = await redis.set(key, value, { NX: true });
    res.json({
      success: true,
      data: { result },
      operation: "SET_NX",
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
    const newClient = createClient(redisConfig);

    newClient.on("error", (err) => {
      console.error("New client error:", err);
    });

    // node-redis requires explicit connect()
    await newClient.connect();

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

// Test SELECT (database switch)
app.get("/test/select", async (req: Request, res: Response) => {
  try {
    // Create a new client to test SELECT without affecting the main client
    const selectClient = createClient(redisConfig);
    selectClient.on("error", (err) => {
      console.error("Select client error:", err);
    });
    await selectClient.connect();

    // Switch to database 1
    await selectClient.select(1);

    // Do a simple operation in database 1
    await selectClient.set("test:select:key", "select_value");
    const value = await selectClient.get("test:select:key");

    // Switch back to database 0
    await selectClient.select(0);

    await selectClient.quit();

    res.json({
      success: true,
      data: { value },
      operation: "SELECT",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Test disconnect
app.get("/test/disconnect", async (req: Request, res: Response) => {
  try {
    const tempClient = createClient(redisConfig);
    tempClient.on("error", (err) => {
      console.error("Temp client error:", err);
    });
    await tempClient.connect();

    // Perform an operation
    const result = await tempClient.ping();

    // Force disconnect (instead of graceful quit)
    await tempClient.disconnect();

    res.json({
      success: true,
      data: { result },
      operation: "DISCONNECT",
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
