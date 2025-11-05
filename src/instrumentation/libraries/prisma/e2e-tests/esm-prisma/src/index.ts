// Import TuskDrift first!
import { TuskDrift } from "./tdInit.js";

import express from "express";
import { getPrisma, closePrisma } from "./db/index.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Get Prisma client instance
const prisma = getPrisma();

// Initialize database with seed data
async function initializeDatabase() {
  try {
    console.log("Initializing database with seed data...");

    // Clean up existing data (in reverse order of dependencies)
    await prisma.order.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.category.deleteMany();
    await prisma.post.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.user.deleteMany();

    // Seed Users
    await prisma.user.createMany({
      data: [
        { email: "alice@example.com", name: "Alice", age: 30, isActive: true },
        { email: "bob@example.com", name: "Bob", age: 25, isActive: true },
        { email: "charlie@example.com", name: "Charlie", age: 35, isActive: false },
      ],
    });

    // Get user IDs for relations
    const alice = await prisma.user.findUnique({ where: { email: "alice@example.com" } });
    const bob = await prisma.user.findUnique({ where: { email: "bob@example.com" } });
    const charlie = await prisma.user.findUnique({ where: { email: "charlie@example.com" } });

    if (!alice || !bob || !charlie) {
      throw new Error("Failed to create seed users");
    }

    // Seed Posts
    await prisma.post.createMany({
      data: [
        {
          title: "First Post",
          content: "Hello World",
          published: true,
          viewCount: 100,
          authorId: alice.id,
        },
        {
          title: "Second Post",
          content: "Testing Prisma",
          published: true,
          viewCount: 50,
          authorId: bob.id,
        },
        {
          title: "Draft Post",
          content: "Not published yet",
          published: false,
          viewCount: 0,
          authorId: alice.id,
        },
      ],
    });

    // Seed Profiles
    await prisma.profile.createMany({
      data: [
        { bio: "Software Engineer", avatarUrl: "https://example.com/alice.jpg", userId: alice.id },
        { bio: "Product Manager", avatarUrl: "https://example.com/bob.jpg", userId: bob.id },
      ],
    });

    // Seed Categories
    await prisma.category.createMany({
      data: [{ name: "Technology" }, { name: "Lifestyle" }, { name: "Business" }],
    });

    // Seed Tags
    await prisma.tag.createMany({
      data: [{ name: "javascript" }, { name: "typescript" }, { name: "nodejs" }],
    });

    // Seed Orders for aggregation testing
    await prisma.order.createMany({
      data: [
        { orderNumber: "ORD-001", total: 100.5, status: "completed", customerId: alice.id },
        { orderNumber: "ORD-002", total: 250.75, status: "completed", customerId: bob.id },
        { orderNumber: "ORD-003", total: 75.25, status: "pending", customerId: alice.id },
        { orderNumber: "ORD-004", total: 500.0, status: "cancelled", customerId: charlie.id },
      ],
    });

    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

// =============================================================================
// ENDPOINTS - Testing all Prisma operations
// =============================================================================

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", ready: true });
});

// -----------------------------------------------------------------------------
// findMany - Test basic query
// -----------------------------------------------------------------------------
app.get("/users/all", async (req, res) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    console.error("Error in /users/all:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// findMany with where clause - Test filtering
// -----------------------------------------------------------------------------
app.get("/users/active", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(users);
  } catch (error) {
    console.error("Error in /users/active:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// findFirst - Test first matching record
// NOTE: This route must come BEFORE /users/:id to avoid path collision
// -----------------------------------------------------------------------------
app.get("/users/first-active", async (req, res) => {
  try {
    const user = await prisma.user.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/first-active:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// findUniqueOrThrow - Test with existing and non-existing record
// NOTE: This route must come BEFORE /users/:id to avoid path collision
// -----------------------------------------------------------------------------
app.get("/users/by-email/:email", async (req, res) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: req.params.email },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/by-email:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// count - Test counting records
// NOTE: This route must come BEFORE /users/:id to avoid path collision
// -----------------------------------------------------------------------------
app.get("/users/count", async (req, res) => {
  try {
    const total = await prisma.user.count();
    const active = await prisma.user.count({ where: { isActive: true } });
    res.json({ total, active });
  } catch (error) {
    console.error("Error in /users/count:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// Relations - Test include (one-to-many)
// NOTE: This route must come BEFORE /users/:id to avoid path collision
// -----------------------------------------------------------------------------
app.get("/users/:id/with-posts", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { posts: true, profile: true },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/:id/with-posts:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// findUnique - Test single record lookup
// NOTE: This route uses :id param, so it must come AFTER all specific routes
// -----------------------------------------------------------------------------
app.get("/users/:id", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/:id:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// create - Test single record creation
// -----------------------------------------------------------------------------
app.post("/users/create", async (req, res) => {
  try {
    const { email, name, age } = req.body;
    const user = await prisma.user.create({
      data: {
        email: email || `user_${Date.now()}@example.com`,
        name: name || "Test User",
        age: age || 25,
      },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/create:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// createMany - Test bulk creation
// -----------------------------------------------------------------------------
app.post("/users/create-many", async (req, res) => {
  try {
    const result = await prisma.user.createMany({
      data: [
        { email: `bulk1_${Date.now()}@example.com`, name: "Bulk User 1", age: 20 },
        { email: `bulk2_${Date.now()}@example.com`, name: "Bulk User 2", age: 22 },
        { email: `bulk3_${Date.now()}@example.com`, name: "Bulk User 3", age: 24 },
      ],
    });
    res.json(result);
  } catch (error) {
    console.error("Error in /users/create-many:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// updateMany - Test bulk update
// NOTE: This route must come BEFORE /users/:id to avoid path collision
// -----------------------------------------------------------------------------
app.put("/users/bulk-deactivate", async (req, res) => {
  try {
    const result = await prisma.user.updateMany({
      where: { age: { lt: 30 } },
      data: { isActive: false },
    });
    res.json(result);
  } catch (error) {
    console.error("Error in /users/bulk-deactivate:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// update - Test single record update
// NOTE: This route uses :id param, so it must come AFTER specific routes
// -----------------------------------------------------------------------------
app.put("/users/:id", async (req, res) => {
  try {
    const { name, age, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { name, age, isActive },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/:id (PUT):", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// upsert - Test create or update
// -----------------------------------------------------------------------------
app.post("/users/upsert", async (req, res) => {
  try {
    const { email, name, age } = req.body;
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, age },
      create: { email, name, age },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/upsert:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// deleteMany - Test bulk deletion
// NOTE: This route must come BEFORE /users/:id to avoid path collision
// -----------------------------------------------------------------------------
app.delete("/users/inactive", async (req, res) => {
  try {
    const result = await prisma.user.deleteMany({
      where: { isActive: false },
    });
    res.json(result);
  } catch (error) {
    console.error("Error in /users/inactive (DELETE):", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// delete - Test single record deletion
// NOTE: This route uses :id param, so it must come AFTER specific routes
// -----------------------------------------------------------------------------
app.delete("/users/:id", async (req, res) => {
  try {
    const user = await prisma.user.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json(user);
  } catch (error) {
    console.error("Error in /users/:id (DELETE):", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// aggregate - Test aggregation operations
// -----------------------------------------------------------------------------
app.get("/orders/aggregate", async (req, res) => {
  try {
    const result = await prisma.order.aggregate({
      _sum: { total: true },
      _avg: { total: true },
      _min: { total: true },
      _max: { total: true },
      _count: true,
    });
    res.json(result);
  } catch (error) {
    console.error("Error in /orders/aggregate:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// Relations - Test deep includes
// -----------------------------------------------------------------------------
app.get("/posts/published", async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: { published: true },
      include: {
        author: {
          include: { profile: true },
        },
        categories: true,
        tags: true,
      },
    });
    res.json(posts);
  } catch (error) {
    console.error("Error in /posts/published:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// Nested writes - Test creating with relations
// -----------------------------------------------------------------------------
app.post("/posts/create-with-author", async (req, res) => {
  try {
    const { title, content, authorEmail } = req.body;
    const post = await prisma.post.create({
      data: {
        title: title || "Test Post",
        content: content || "Test content",
        published: true,
        author: {
          connectOrCreate: {
            where: { email: authorEmail || "new_author@example.com" },
            create: {
              email: authorEmail || `author_${Date.now()}@example.com`,
              name: "New Author",
              age: 30,
            },
          },
        },
      },
      include: { author: true },
    });
    res.json(post);
  } catch (error) {
    console.error("Error in /posts/create-with-author:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// $transaction (array) - Test sequential operations in transaction
// -----------------------------------------------------------------------------
app.post("/transactions/sequential", async (req, res) => {
  try {
    const result = await prisma.$transaction([
      prisma.user.create({
        data: {
          email: `txn_user1_${Date.now()}@example.com`,
          name: "Transaction User 1",
          age: 28,
        },
      }),
      prisma.user.create({
        data: {
          email: `txn_user2_${Date.now()}@example.com`,
          name: "Transaction User 2",
          age: 32,
        },
      }),
      prisma.user.count(),
    ]);
    res.json(result);
  } catch (error) {
    console.error("Error in /transactions/sequential:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// $transaction (interactive) - Test interactive transaction
// -----------------------------------------------------------------------------
app.post("/transactions/interactive", async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Create a user
      const user = await tx.user.create({
        data: {
          email: `interactive_${Date.now()}@example.com`,
          name: "Interactive User",
          age: 27,
        },
      });

      // Create a post for that user
      const post = await tx.post.create({
        data: {
          title: "Post from transaction",
          content: "Created in interactive transaction",
          authorId: user.id,
          published: true,
        },
      });

      // Create a profile for that user
      const profile = await tx.profile.create({
        data: {
          bio: "Created in transaction",
          userId: user.id,
        },
      });

      return { user, post, profile };
    });

    res.json(result);
  } catch (error) {
    console.error("Error in /transactions/interactive:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// $queryRaw - Test raw query SELECT
// -----------------------------------------------------------------------------
app.post("/raw/query", async (req, res) => {
  try {
    const users = await prisma.$queryRaw`
      SELECT * FROM "User" WHERE "isActive" = true ORDER BY "name" LIMIT 5
    `;
    res.json(users);
  } catch (error) {
    console.error("Error in /raw/query:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// $executeRaw - Test raw query DML
// -----------------------------------------------------------------------------
app.post("/raw/execute", async (req, res) => {
  try {
    const result = await prisma.$executeRaw`
      UPDATE "User" SET "updatedAt" = NOW() WHERE "age" > 30
    `;
    res.json({ rowsAffected: result });
  } catch (error) {
    console.error("Error in /raw/execute:", error);
    res.status(500).json({ error: String(error) });
  }
});

// -----------------------------------------------------------------------------
// Error testing - Unique constraint violation
// -----------------------------------------------------------------------------
app.post("/errors/unique-violation", async (req, res) => {
  try {
    // Try to create user with duplicate email
    await prisma.user.create({
      data: {
        email: "alice@example.com", // This already exists from seed data
        name: "Duplicate Alice",
        age: 30,
      },
    });
    res.json({ error: "Should have thrown error" });
  } catch (error: any) {
    // Expected to catch PrismaClientKnownRequestError
    // Note: We omit the full message because it contains line numbers that can change
    res.status(400).json({
      errorType: error.name || error.constructor.name,
      code: error.code,
    });
  }
});

// -----------------------------------------------------------------------------
// Error testing - Not found error
// -----------------------------------------------------------------------------
app.get("/errors/not-found", async (req, res) => {
  try {
    // Try to find non-existent user with findUniqueOrThrow
    await prisma.user.findUniqueOrThrow({
      where: { email: "nonexistent@example.com" },
    });
    res.json({ error: "Should have thrown error" });
  } catch (error: any) {
    // Expected to catch NotFoundError
    // Note: We omit the full message because it contains line numbers that can change
    // Use error.name instead of error.constructor.name for replay compatibility
    res.status(404).json({
      errorType: error.name || error.constructor.name,
    });
  }
});

// -----------------------------------------------------------------------------
// Error testing - Validation error
// -----------------------------------------------------------------------------
app.post("/errors/validation", async (req, res) => {
  try {
    // Try to create user with invalid data (missing required field)
    await prisma.user.create({
      data: {
        email: "test@example.com",
        // Intentionally missing 'name' field for testing validation error
        age: 30,
      } as any,
    });
    res.json({ error: "Should have thrown error" });
  } catch (error: any) {
    // Expected to catch PrismaClientValidationError
    // Note: We omit the full message because it contains line numbers that can change
    // Use error.name instead of error.constructor.name for replay compatibility
    res.status(400).json({
      errorType: error.name || error.constructor.name,
    });
  }
});

// =============================================================================
// Server Initialization
// =============================================================================

async function startServer() {
  try {
    // Initialize database with seed data
    await initializeDatabase();

    // Mark app as ready for TuskDrift
    TuskDrift.markAppAsReady();
    console.log("App marked as ready");

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing Prisma connection...");
  await closePrisma();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing Prisma connection...");
  await closePrisma();
  process.exit(0);
});

// Start the server
startServer();
