import { TuskDrift } from "./tdInit.js";
import http from "http";
import { MongoClient, Db, Collection } from "mongodb";

const PORT = process.env.PORT || 3000;

// MongoDB configuration
const mongoHost = process.env.MONGO_HOST || "mongo";
const mongoPort = process.env.MONGO_PORT || "27017";
const mongoDb = process.env.MONGO_DB || "testdb";
const mongoUrl = `mongodb://${mongoHost}:${mongoPort}`;

let client: MongoClient;
let db: Db;
let testUsers: Collection;
let largeData: Collection;

async function initializeDatabase() {
  console.log(`Connecting to MongoDB: ${mongoUrl}`);

  client = new MongoClient(mongoUrl);
  await client.connect();
  db = client.db(mongoDb);

  // Create test_users collection with seed data
  testUsers = db.collection("test_users");
  await testUsers.deleteMany({});
  await testUsers.insertMany([
    { name: "John Doe", email: "john@example.com", age: 30, tags: ["admin", "user"] },
    { name: "Jane Smith", email: "jane@example.com", age: 25, tags: ["user"] },
    { name: "Bob Johnson", email: "bob@example.com", age: 35, tags: ["user", "moderator"] },
  ]);

  // Create large_data collection for cursor testing
  largeData = db.collection("large_data");
  await largeData.deleteMany({});
  const largeDataDocs = [];
  for (let i = 1; i <= 10; i++) {
    largeDataDocs.push({ value: `test_data_${i}`, index: i, category: i % 2 === 0 ? "even" : "odd" });
  }
  await largeData.insertMany(largeDataDocs);

  console.log("Database initialized successfully");
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}

// Create HTTP server with test endpoints
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  try {
    // Health check
    if (url === "/health" && method === "GET") {
      sendJson(res, 200, { success: true });
      return;
    }

    // --- insertOne ---
    if (url === "/test/insert-one" && method === "GET") {
      const tempCol = db.collection("temp_insert_one");
      await tempCol.deleteMany({});
      const result = await tempCol.insertOne({ name: "Test User", email: "test@example.com", age: 28 });
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        insertedId: result.insertedId,
      });
      return;
    }

    // --- insertMany ---
    if (url === "/test/insert-many" && method === "GET") {
      const tempCol = db.collection("temp_insert_many");
      await tempCol.deleteMany({});
      const result = await tempCol.insertMany([
        { name: "User A", email: "a@example.com" },
        { name: "User B", email: "b@example.com" },
        { name: "User C", email: "c@example.com" },
      ]);
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        insertedCount: result.insertedCount,
        insertedIds: result.insertedIds,
      });
      return;
    }

    // --- findOne ---
    if (url === "/test/find-one" && method === "GET") {
      const result = await testUsers.findOne({ name: "John Doe" });
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- find (toArray) ---
    if (url === "/test/find" && method === "GET") {
      const result = await testUsers.find({}).toArray();
      sendJson(res, 200, { success: true, data: result, count: result.length });
      return;
    }

    // --- find with sort, limit, skip, project ---
    if (url === "/test/find-with-options" && method === "GET") {
      const result = await testUsers
        .find({})
        .sort({ age: -1 })
        .limit(2)
        .skip(0)
        .project({ name: 1, age: 1, _id: 0 })
        .toArray();
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- find cursor with next/hasNext ---
    if (url === "/test/find-cursor-next" && method === "GET") {
      const cursor = largeData.find({}).sort({ index: 1 }).limit(3);
      const documents: any[] = [];
      while (await cursor.hasNext()) {
        const doc = await cursor.next();
        if (doc) documents.push(doc);
      }
      await cursor.close();
      sendJson(res, 200, { success: true, data: documents, count: documents.length });
      return;
    }

    // --- updateOne ---
    if (url === "/test/update-one" && method === "GET") {
      const tempCol = db.collection("temp_update_one");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "Update Target", status: "pending" });
      const result = await tempCol.updateOne({ name: "Update Target" }, { $set: { status: "completed" } });
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });
      return;
    }

    // --- updateMany ---
    if (url === "/test/update-many" && method === "GET") {
      const tempCol = db.collection("temp_update_many");
      await tempCol.deleteMany({});
      await tempCol.insertMany([
        { group: "A", status: "pending" },
        { group: "A", status: "pending" },
        { group: "B", status: "pending" },
      ]);
      const result = await tempCol.updateMany({ group: "A" }, { $set: { status: "done" } });
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });
      return;
    }

    // --- deleteOne ---
    if (url === "/test/delete-one" && method === "GET") {
      const tempCol = db.collection("temp_delete_one");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "Delete Me" });
      const result = await tempCol.deleteOne({ name: "Delete Me" });
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        deletedCount: result.deletedCount,
      });
      return;
    }

    // --- deleteMany ---
    if (url === "/test/delete-many" && method === "GET") {
      const tempCol = db.collection("temp_delete_many");
      await tempCol.deleteMany({});
      await tempCol.insertMany([
        { group: "delete", value: 1 },
        { group: "delete", value: 2 },
        { group: "keep", value: 3 },
      ]);
      const result = await tempCol.deleteMany({ group: "delete" });
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        deletedCount: result.deletedCount,
      });
      return;
    }

    // --- replaceOne ---
    if (url === "/test/replace-one" && method === "GET") {
      const tempCol = db.collection("temp_replace_one");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "Original", version: 1 });
      const result = await tempCol.replaceOne(
        { name: "Original" },
        { name: "Replaced", version: 2, replaced: true },
      );
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        acknowledged: result.acknowledged,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });
      return;
    }

    // --- findOneAndUpdate ---
    if (url === "/test/find-one-and-update" && method === "GET") {
      const tempCol = db.collection("temp_find_update");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "FindAndUpdate", counter: 0 });
      const result = await tempCol.findOneAndUpdate(
        { name: "FindAndUpdate" },
        { $inc: { counter: 1 } },
        { returnDocument: "after" },
      );
      await tempCol.drop();
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- findOneAndDelete ---
    if (url === "/test/find-one-and-delete" && method === "GET") {
      const tempCol = db.collection("temp_find_delete");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "FindAndDelete", value: 42 });
      const result = await tempCol.findOneAndDelete({ name: "FindAndDelete" });
      await tempCol.drop();
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- findOneAndReplace ---
    if (url === "/test/find-one-and-replace" && method === "GET") {
      const tempCol = db.collection("temp_find_replace");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "FindAndReplace", version: 1 });
      const result = await tempCol.findOneAndReplace(
        { name: "FindAndReplace" },
        { name: "Replaced", version: 2 },
        { returnDocument: "after" },
      );
      await tempCol.drop();
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- countDocuments ---
    if (url === "/test/count-documents" && method === "GET") {
      const count = await testUsers.countDocuments({ age: { $gte: 25 } });
      sendJson(res, 200, { success: true, count });
      return;
    }

    // --- estimatedDocumentCount ---
    if (url === "/test/estimated-count" && method === "GET") {
      const count = await testUsers.estimatedDocumentCount();
      sendJson(res, 200, { success: true, count });
      return;
    }

    // --- distinct ---
    if (url === "/test/distinct" && method === "GET") {
      const values = await testUsers.distinct("tags");
      sendJson(res, 200, { success: true, data: values });
      return;
    }

    // --- aggregate ---
    if (url === "/test/aggregate" && method === "GET") {
      const result = await largeData
        .aggregate([
          { $match: { index: { $lte: 6 } } },
          { $group: { _id: "$category", total: { $sum: 1 }, avgIndex: { $avg: "$index" } } },
          { $sort: { _id: 1 } },
        ])
        .toArray();
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- bulkWrite ---
    if (url === "/test/bulk-write" && method === "GET") {
      const tempCol = db.collection("temp_bulk_write");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ name: "Existing", value: 1 });
      const result = await tempCol.bulkWrite([
        { insertOne: { document: { name: "BulkInsert1", value: 10 } } },
        { insertOne: { document: { name: "BulkInsert2", value: 20 } } },
        { updateOne: { filter: { name: "Existing" }, update: { $set: { value: 100 } } } },
        { deleteOne: { filter: { name: "BulkInsert1" } } },
      ]);
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        ok: result.ok,
        insertedCount: result.insertedCount,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
        upsertedCount: result.upsertedCount,
      });
      return;
    }

    // --- createIndex / createIndexes ---
    if (url === "/test/create-index" && method === "GET") {
      const tempCol = db.collection("temp_create_index");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ field1: "a", field2: "b" });
      const indexName = await tempCol.createIndex({ field1: 1 });
      const indexNames = await tempCol.createIndexes([
        { key: { field2: 1 }, name: "field2_idx" },
      ]);
      await tempCol.drop();
      sendJson(res, 200, { success: true, indexName, indexNames });
      return;
    }

    // --- dropIndex ---
    if (url === "/test/drop-index" && method === "GET") {
      const tempCol = db.collection("temp_drop_index");
      await tempCol.deleteMany({});
      await tempCol.insertOne({ field1: "a" });
      await tempCol.createIndex({ field1: 1 }, { name: "field1_drop_idx" });
      await tempCol.dropIndex("field1_drop_idx");
      sendJson(res, 200, { success: true });
      return;
    }

    // --- listIndexes ---
    if (url === "/test/list-indexes" && method === "GET") {
      const indexes = await testUsers.listIndexes().toArray();
      sendJson(res, 200, { success: true, data: indexes });
      return;
    }

    // --- db.command ---
    if (url === "/test/db-command" && method === "GET") {
      const result = await db.command({ ping: 1 });
      sendJson(res, 200, { success: true, data: result });
      return;
    }

    // --- listCollections ---
    if (url === "/test/list-collections" && method === "GET") {
      const collections = await db.listCollections().toArray();
      sendJson(res, 200, { success: true, data: collections });
      return;
    }

    // --- transaction (session) ---
    if (url === "/test/transaction" && method === "GET") {
      const session = client.startSession();
      try {
        session.startTransaction();
        const txnCol = db.collection("temp_transaction");
        await txnCol.deleteMany({}, { session });
        await txnCol.insertOne({ name: "TxnUser", value: 1 }, { session });
        const found = await txnCol.findOne({ name: "TxnUser" }, { session });
        await txnCol.updateOne({ name: "TxnUser" }, { $set: { value: 2 } }, { session });
        await session.commitTransaction();
        await txnCol.drop();
        sendJson(res, 200, { success: true, data: found });
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        await session.endSession();
      }
      return;
    }

    // --- ordered bulk operation ---
    if (url === "/test/ordered-bulk" && method === "GET") {
      const tempCol = db.collection("temp_ordered_bulk");
      await tempCol.deleteMany({});
      const bulk = tempCol.initializeOrderedBulkOp();
      bulk.insert({ name: "OrderedBulk1", value: 1 });
      bulk.insert({ name: "OrderedBulk2", value: 2 });
      bulk.insert({ name: "OrderedBulk3", value: 3 });
      bulk.find({ name: "OrderedBulk1" }).updateOne({ $set: { value: 10 } });
      bulk.find({ name: "OrderedBulk3" }).deleteOne();
      const result = await bulk.execute();
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        ok: result.ok,
        insertedCount: result.insertedCount,
        modifiedCount: result.modifiedCount,
        deletedCount: result.deletedCount,
      });
      return;
    }

    // --- unordered bulk operation ---
    if (url === "/test/unordered-bulk" && method === "GET") {
      const tempCol = db.collection("temp_unordered_bulk");
      await tempCol.deleteMany({});
      const bulk = tempCol.initializeUnorderedBulkOp();
      bulk.insert({ name: "UnorderedBulk1", value: 1 });
      bulk.insert({ name: "UnorderedBulk2", value: 2 });
      bulk.insert({ name: "UnorderedBulk3", value: 3 });
      const result = await bulk.execute();
      await tempCol.drop();
      sendJson(res, 200, {
        success: true,
        ok: result.ok,
        insertedCount: result.insertedCount,
      });
      return;
    }

    // 404 for unknown routes
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("Error handling request:", error);
    sendJson(res, 500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Initialize database first, then start server
async function main() {
  await initializeDatabase();
  server.listen(PORT, () => {
    TuskDrift.markAppAsReady();
    console.log(`MongoDB integration test server running on port ${PORT}`);
    console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE}`);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  try {
    await client.close();
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
