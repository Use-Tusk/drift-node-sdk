const { TuskDrift } = require("tusk-drift-sdk");

TuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { MongoDBContainer } = require("@testcontainers/mongodb");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let client;
let db;
let container;
let mongoUrl;

// Collections for testing
const TEST_COLLECTIONS = {
  users: "test_users",
  products: "test_products",
  orders: "test_orders",
};

async function initializeDatabase() {
  container = await new MongoDBContainer("mongo:6.0").start();

  console.log(
    `MongoDB container started on port ${container.getHost()}:${container.getMappedPort(27017)}`,
  );

  // Create database configuration from container - use direct connection without replica set
  const host = container.getHost();
  const port = container.getMappedPort(27017);
  mongoUrl = `mongodb://${host}:${port}/testdb?directConnection=true`;

  console.log(`Connecting to MongoDB: ${mongoUrl}`);

  // Initialize client with additional options to avoid replica set issues
  client = new MongoClient(mongoUrl, {
    serverSelectionTimeoutMS: 30000,
    connectTimeoutMS: 30000,
    directConnection: true, // Force direct connection, not replica set
  });

  await client.connect();
  console.log("Connected to MongoDB");

  // Get database instance
  db = client.db("testdb");
  console.log("Database instance obtained");

  // Create test data
  await setupTestData();
  console.log("MongoDB database initialized successfully");
}

async function setupTestData() {
  console.log("Setting up test data");

  // Setup users collection
  const users = db.collection(TEST_COLLECTIONS.users);
  await users.deleteMany({}); // Clean slate
  await users.insertMany([
    {
      _id: new ObjectId("507f1f77bcf86cd799439011"),
      name: "John Doe",
      email: "john@example.com",
      age: 30,
      status: "active",
      createdAt: new Date("2024-01-01"),
    },
    {
      _id: new ObjectId("507f1f77bcf86cd799439012"),
      name: "Jane Smith",
      email: "jane@example.com",
      age: 25,
      status: "active",
      createdAt: new Date("2024-01-02"),
    },
    {
      _id: new ObjectId("507f1f77bcf86cd799439013"),
      name: "Bob Johnson",
      email: "bob@example.com",
      age: 35,
      status: "inactive",
      createdAt: new Date("2024-01-03"),
    },
  ]);

  // Setup products collection
  const products = db.collection(TEST_COLLECTIONS.products);
  await products.deleteMany({});
  await products.insertMany([
    {
      _id: new ObjectId("507f1f77bcf86cd799439021"),
      name: "Laptop",
      price: 999.99,
      category: "electronics",
      inStock: 50,
    },
    {
      _id: new ObjectId("507f1f77bcf86cd799439022"),
      name: "Phone",
      price: 599.99,
      category: "electronics",
      inStock: 25,
    },
    {
      _id: new ObjectId("507f1f77bcf86cd799439023"),
      name: "Book",
      price: 29.99,
      category: "books",
      inStock: 100,
    },
  ]);

  // Create indexes for testing
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ status: 1, createdAt: -1 });
  await products.createIndex({ category: 1, price: 1 });
}

// Health check endpoint
app.get("/health", (req, res) => {
  if (TuskDrift.isAppReady()) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "App not ready" });
  }
});

// Connection tests
app.get("/test/client-connect", async (req, res) => {
  try {
    // Test new client connection
    const newClient = new MongoClient(mongoUrl);
    await newClient.connect();
    await newClient.close();

    res.json({
      success: true,
      message: "MongoDB client connection test successful",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Database operations
app.get("/test/database-stats", async (req, res) => {
  try {
    const stats = await db.stats();
    res.json({
      success: true,
      data: {
        db: stats.db,
        collections: stats.collections,
        objects: stats.objects,
        dataSize: stats.dataSize,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/list-collections", async (req, res) => {
  try {
    const collections = await db.listCollections().toArray();
    const sortedCollections = collections.sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      success: true,
      data: sortedCollections.map((col) => col.name),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Collection CRUD operations
app.get("/test/find-all-users", async (req, res) => {
  try {
    const users = await db.collection(TEST_COLLECTIONS.users).find({}).toArray();
    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/find-user-by-id/:id", async (req, res) => {
  try {
    const userId = new ObjectId(req.params.id);
    const user = await db.collection(TEST_COLLECTIONS.users).findOne({ _id: userId });
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/find-users-by-status/:status", async (req, res) => {
  try {
    const users = await db
      .collection(TEST_COLLECTIONS.users)
      .find({ status: req.params.status })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/test/insert-user", async (req, res) => {
  try {
    const { name, email, age } = req.body;
    const newUser = {
      name,
      email,
      age,
      status: "active",
      createdAt: new Date(),
    };

    const result = await db.collection(TEST_COLLECTIONS.users).insertOne(newUser);
    res.json({
      success: true,
      data: {
        acknowledged: result.acknowledged,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/test/insert-many-users", async (req, res) => {
  try {
    const { users } = req.body;
    const usersWithDefaults = users.map((user) => ({
      ...user,
      status: user.status || "active",
      createdAt: new Date(),
    }));

    const result = await db.collection(TEST_COLLECTIONS.users).insertMany(usersWithDefaults);
    res.json({
      success: true,
      data: {
        insertedCount: result.insertedCount,
        acknowledged: result.acknowledged,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.put("/test/update-user/:id", async (req, res) => {
  try {
    const userId = new ObjectId(req.params.id);
    const updates = req.body;

    const result = await db
      .collection(TEST_COLLECTIONS.users)
      .updateOne({ _id: userId }, { $set: { ...updates, updatedAt: new Date() } });

    res.json({
      success: true,
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        acknowledged: result.acknowledged,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.put("/test/update-many-users", async (req, res) => {
  try {
    const { filter, updates } = req.body;

    const result = await db
      .collection(TEST_COLLECTIONS.users)
      .updateMany(filter, { $set: { ...updates, updatedAt: new Date() } });

    res.json({
      success: true,
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        acknowledged: result.acknowledged,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.delete("/test/delete-user/:id", async (req, res) => {
  try {
    const userId = new ObjectId(req.params.id);
    const result = await db.collection(TEST_COLLECTIONS.users).deleteOne({ _id: userId });

    res.json({
      success: true,
      data: {
        deletedCount: result.deletedCount,
        acknowledged: result.acknowledged,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/test/delete-many-users", async (req, res) => {
  try {
    const { filter } = req.body;
    const result = await db.collection(TEST_COLLECTIONS.users).deleteMany(filter);

    res.json({
      success: true,
      data: {
        deletedCount: result.deletedCount,
        acknowledged: result.acknowledged,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Advanced operations
app.get("/test/count-users", async (req, res) => {
  try {
    const count = await db.collection(TEST_COLLECTIONS.users).countDocuments();
    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/count-users-by-status/:status", async (req, res) => {
  try {
    const count = await db.collection(TEST_COLLECTIONS.users).countDocuments({
      status: req.params.status,
    });
    res.json({
      success: true,
      data: { count, status: req.params.status },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/distinct-user-statuses", async (req, res) => {
  try {
    const statuses = await db.collection(TEST_COLLECTIONS.users).distinct("status");
    res.json({
      success: true,
      data: statuses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Aggregation operations
app.get("/test/aggregate-users-by-status", async (req, res) => {
  try {
    const pipeline = [
      { $group: { _id: "$status", count: { $sum: 1 }, avgAge: { $avg: "$age" } } },
      { $sort: { count: -1 } },
    ];

    const results = await db.collection(TEST_COLLECTIONS.users).aggregate(pipeline).toArray();
    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/aggregate-products-by-category", async (req, res) => {
  try {
    const pipeline = [
      {
        $group: {
          _id: "$category",
          totalProducts: { $sum: 1 },
          totalStock: { $sum: "$inStock" },
          avgPrice: { $avg: "$price" },
          maxPrice: { $max: "$price" },
          minPrice: { $min: "$price" },
        },
      },
      { $sort: { totalProducts: -1 } },
    ];

    const results = await db.collection(TEST_COLLECTIONS.products).aggregate(pipeline).toArray();
    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Index operations
app.get("/test/list-user-indexes", async (req, res) => {
  try {
    const indexes = await db.collection(TEST_COLLECTIONS.users).indexes();
    res.json({
      success: true,
      data: indexes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/test/create-index", async (req, res) => {
  try {
    const { collection, indexSpec, options = {} } = req.body;
    const result = await db.collection(collection).createIndex(indexSpec, options);
    res.json({
      success: true,
      data: { indexName: result },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Bulk operations
app.post("/test/bulk-write", async (req, res) => {
  try {
    const { operations } = req.body;
    const result = await db.collection(TEST_COLLECTIONS.users).bulkWrite(operations);

    res.json({
      success: true,
      data: {
        insertedCount: result.insertedCount,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        upsertedCount: result.upsertedCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Transaction operations (requires replica set, but we'll test the session creation)
app.post("/test/start-session", async (req, res) => {
  try {
    const session = client.startSession();
    // Just test that we can start a session, then end it immediately
    // since our test container is standalone (not a replica set)
    await session.endSession();

    res.json({
      success: true,
      message: "Session started and ended successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Collection operations
app.post("/test/create-collection", async (req, res) => {
  try {
    const { collectionName, options = {} } = req.body;
    const collection = await db.createCollection(collectionName, options);

    res.json({
      success: true,
      data: {
        collectionName: collection.collectionName,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.delete("/test/drop-collection/:collectionName", async (req, res) => {
  try {
    const { collectionName } = req.params;
    const result = await db.dropCollection(collectionName);

    res.json({
      success: true,
      data: { dropped: result },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Find operations with cursors
app.get("/test/find-users-cursor", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 2;
    const skip = parseInt(req.query.skip) || 0;

    const cursor = db
      .collection(TEST_COLLECTIONS.users)
      .find({})
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit);

    const users = await cursor.toArray();

    res.json({
      success: true,
      data: users.map((user) => ({
        name: user.name,
        email: user.email,
        age: user.age,
        status: user.status,
      })),
      pagination: { skip, limit, count: users.length },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Find and modify operations
app.post("/test/find-and-modify-user", async (req, res) => {
  try {
    const { filter, update, options = {} } = req.body;

    const result = await db
      .collection(TEST_COLLECTIONS.users)
      .findOneAndUpdate(
        filter,
        { $set: { ...update, updatedAt: new Date() } },
        { returnDocument: "after", ...options },
      );

    res.json({
      success: true,
      data: {
        name: result.name,
        email: result.email,
        age: result.age,
        status: result.status,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Start server and initialize database
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE}`);

  try {
    console.log("Starting database initialization...");
    await initializeDatabase();
    console.log("Database initialization completed successfully");

    TuskDrift.markAppAsReady();
    console.log("TuskDrift marked as ready");

    console.log(`MongoDB integration test server running on port ${PORT}`);
    console.log(`MongoDB URL: ${mongoUrl}`);
  } catch (error) {
    console.error("Failed to initialize database:", error);
    console.error("Stack trace:", error.stack);
    // Don't exit - let the server stay up so we can see the health check failures
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  try {
    if (client) {
      await client.close();
    }
    if (container) {
      await container.stop();
    }
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
