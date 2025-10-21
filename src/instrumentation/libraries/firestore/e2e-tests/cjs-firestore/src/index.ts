import { TuskDrift } from "./tdInit";
import express, { Request, Response } from "express";
import { getDb, closeDb } from "./db/index";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Collection names for testing
const USERS_COLLECTION = "test_users";
const PRODUCTS_COLLECTION = "test_products";

// Initialize database with seed data
async function initializeDatabase() {
  // Current limitation is that TuskDrift needs the first mock requested to be an async mock (calls requestMockAsync)
  // This is so that we can await for the SDK and CLI to connect on the first request
  // Hence why there is a random fetch to google.com here
  try {
    const response = await fetch("https://google.com");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    console.log("Successfully connected to google.com");
  } catch (error) {
    console.error("Error connecting to google.com:", error);
  }

  const db = getDb();

  console.log("Initializing Firestore with seed data...");

  try {
    // Seed users collection
    const usersRef = db.collection(USERS_COLLECTION);

    await usersRef.doc("user1").set({
      name: "Alice Johnson",
      email: "alice@example.com",
      age: 30,
    });

    await usersRef.doc("user2").set({
      name: "Bob Smith",
      email: "bob@example.com",
      age: 25,
    });

    await usersRef.doc("user3").set({
      name: "Charlie Brown",
      email: "charlie@example.com",
      age: 35,
    });

    // Seed products collection
    const productsRef = db.collection(PRODUCTS_COLLECTION);

    await productsRef.doc("product1").set({
      name: "Laptop",
      price: 999.99,
      inStock: true,
    });

    await productsRef.doc("product2").set({
      name: "Mouse",
      price: 29.99,
      inStock: true,
    });

    await productsRef.doc("product3").set({
      name: "Keyboard",
      price: 79.99,
      inStock: false,
    });

    console.log("Database initialization complete");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", ready: true });
});

// ========== Document Operations ==========

// DocumentReference.get() - Get existing document
app.get("/document/get", async (req: Request, res: Response) => {
  try {
    console.log("Testing DocumentReference.get()...");
    const db = getDb();

    const docRef = db.collection(USERS_COLLECTION).doc("user1");
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const data = snapshot.data();

    console.log("Document retrieved:", data);

    res.json({
      message: "Document retrieved successfully",
      id: snapshot.id,
      data: data,
      exists: snapshot.exists,
    });
  } catch (error: any) {
    console.error("Error in document.get:", error);
    res.status(500).json({ error: error.message });
  }
});

// DocumentReference.create() - Create new document
app.post("/document/create", async (req: Request, res: Response) => {
  try {
    console.log("Testing DocumentReference.create()...");
    const db = getDb();

    const { name, email } = req.body;
    const timestamp = Date.now();

    const docRef = db.collection(USERS_COLLECTION).doc(`created_user_${timestamp}`);
    const writeResult = await docRef.create({
      name: name || `Created User ${timestamp}`,
      email: email || `created_${timestamp}@example.com`,
      createdAt: new Date(),
    });

    console.log("Document created:", writeResult);

    res.json({
      message: "Document created successfully",
      id: docRef.id,
      path: docRef.path,
      writeTime: writeResult.writeTime.toDate(),
    });
  } catch (error: any) {
    console.error("Error in document.create:", error);
    res.status(500).json({ error: error.message });
  }
});

// DocumentReference.set() - Set document (create or overwrite)
app.post("/document/set", async (req: Request, res: Response) => {
  try {
    console.log("Testing DocumentReference.set()...");
    const db = getDb();

    const { name, email } = req.body;
    const timestamp = Date.now();

    const docRef = db.collection(USERS_COLLECTION).doc(`set_user_${timestamp}`);
    const writeResult = await docRef.set({
      name: name || `Set User ${timestamp}`,
      email: email || `set_${timestamp}@example.com`,
      updatedAt: new Date(),
    });

    console.log("Document set:", writeResult);

    res.json({
      message: "Document set successfully",
      id: docRef.id,
      path: docRef.path,
      writeTime: writeResult.writeTime.toDate(),
    });
  } catch (error: any) {
    console.error("Error in document.set:", error);
    res.status(500).json({ error: error.message });
  }
});

// DocumentReference.update() - Update existing document
app.put("/document/update", async (req: Request, res: Response) => {
  try {
    console.log("Testing DocumentReference.update()...");
    const db = getDb();

    const { name } = req.body;

    const docRef = db.collection(USERS_COLLECTION).doc("user1");
    const writeResult = await docRef.update({
      name: name || "Updated Alice Johnson",
      updatedAt: new Date(),
    });

    console.log("Document updated:", writeResult);

    res.json({
      message: "Document updated successfully",
      id: docRef.id,
      path: docRef.path,
      writeTime: writeResult.writeTime.toDate(),
    });
  } catch (error: any) {
    console.error("Error in document.update:", error);
    res.status(500).json({ error: error.message });
  }
});

// DocumentReference.delete() - Delete document
app.delete("/document/delete", async (req: Request, res: Response) => {
  try {
    console.log("Testing DocumentReference.delete()...");
    const db = getDb();

    const timestamp = Date.now();
    const docRef = db.collection(USERS_COLLECTION).doc(`temp_user_${timestamp}`);

    // Create a document first so we can delete it
    await docRef.set({
      name: "Temporary User",
      email: "temp@example.com",
    });

    // Now delete it
    const writeResult = await docRef.delete();

    console.log("Document deleted:", writeResult);

    res.json({
      message: "Document deleted successfully",
      id: docRef.id,
      path: docRef.path,
      writeTime: writeResult.writeTime.toDate(),
    });
  } catch (error: any) {
    console.error("Error in document.delete:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== Collection Operations ==========

// CollectionReference.add() - Add document with auto-generated ID
app.post("/collection/add", async (req: Request, res: Response) => {
  try {
    console.log("Testing CollectionReference.add()...");
    const db = getDb();

    const { name, price } = req.body;
    const timestamp = Date.now();

    const collectionRef = db.collection(PRODUCTS_COLLECTION);
    const docRef = await collectionRef.add({
      name: name || `Product ${timestamp}`,
      price: price || 99.99,
      createdAt: new Date(),
    });

    console.log("Document added with ID:", docRef.id);

    res.json({
      message: "Document added successfully",
      id: docRef.id,
      path: docRef.path,
    });
  } catch (error: any) {
    console.error("Error in collection.add:", error);
    res.status(500).json({ error: error.message });
  }
});

// CollectionReference.doc() - Get reference with auto-generated ID
app.post("/collection/doc-autoid", async (req: Request, res: Response) => {
  try {
    console.log("Testing CollectionReference.doc() with auto-generated ID...");
    const db = getDb();

    const { name, price } = req.body;
    const timestamp = Date.now();

    const collectionRef = db.collection(PRODUCTS_COLLECTION);

    // Call doc() without an ID to get auto-generated ID
    const docRef = collectionRef.doc();

    console.log("Auto-generated document ID:", docRef.id);

    // Now set the document
    await docRef.set({
      name: name || `Auto Product ${timestamp}`,
      price: price || 49.99,
      createdAt: new Date(),
    });

    console.log("Document created with auto-generated ID:", docRef.id);

    res.json({
      message: "Document created with auto-generated ID",
      id: docRef.id,
      path: docRef.path,
    });
  } catch (error: any) {
    console.error("Error in collection.doc autoid:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== Query Operations ==========

// Query.get() - Get multiple documents
app.get("/query/get", async (req: Request, res: Response) => {
  try {
    console.log("Testing Query.get()...");
    const db = getDb();

    const collectionRef = db.collection(PRODUCTS_COLLECTION);

    // Query with where clause and limit
    const query = collectionRef.where("inStock", "==", true).limit(2);
    const snapshot = await query.get();

    const docs = snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));

    console.log(`Query returned ${snapshot.size} documents`);

    res.json({
      message: "Query executed successfully",
      size: snapshot.size,
      empty: snapshot.empty,
      docs: docs,
    });
  } catch (error: any) {
    console.error("Error in query.get:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== Transaction Operations ==========

// runTransaction() - Atomic read-modify-write
app.post("/transaction/increment", async (req: Request, res: Response) => {
  try {
    console.log("Testing runTransaction()...");
    const db = getDb();

    // Create a counter document if it doesn't exist
    const counterRef = db.collection(USERS_COLLECTION).doc("counter");

    const result = await db.runTransaction(async (transaction) => {
      // Read the current counter value
      const counterDoc = await transaction.get(counterRef);

      let newCount = 1;
      if (counterDoc.exists) {
        const currentCount = counterDoc.data()?.count || 0;
        newCount = currentCount + 1;
      }

      // Write the new counter value
      transaction.set(counterRef, { count: newCount, updatedAt: new Date() });

      return newCount;
    });

    console.log("Transaction completed, new count:", result);

    res.json({
      message: "Transaction executed successfully",
      newCount: result,
    });
  } catch (error: any) {
    console.error("Error in transaction:", error);
    res.status(500).json({ error: error.message });
  }
});

// runTransaction() - Multiple operations
app.post("/transaction/transfer", async (req: Request, res: Response) => {
  try {
    console.log("Testing runTransaction() with multiple operations...");
    const db = getDb();

    const user1Ref = db.collection(USERS_COLLECTION).doc("user1");
    const user2Ref = db.collection(USERS_COLLECTION).doc("user2");

    await db.runTransaction(async (transaction) => {
      // Read both documents
      const user1Doc = await transaction.get(user1Ref);
      const user2Doc = await transaction.get(user2Ref);

      // Update user1
      transaction.update(user1Ref, {
        name: "Alice Johnson - Updated in Transaction",
        updatedAt: new Date(),
      });

      // Update user2
      transaction.update(user2Ref, {
        name: "Bob Smith - Updated in Transaction",
        updatedAt: new Date(),
      });
    });

    console.log("Multi-operation transaction completed");

    res.json({
      message: "Transaction with multiple operations executed successfully",
    });
  } catch (error: any) {
    console.error("Error in multi-operation transaction:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== WriteBatch Operations ==========

// batch() - Batched writes
app.post("/batch/write", async (req: Request, res: Response) => {
  try {
    console.log("Testing WriteBatch...");
    const db = getDb();

    const batch = db.batch();
    const timestamp = Date.now();

    // Set operation
    const newProductRef = db.collection(PRODUCTS_COLLECTION).doc(`batch_product_${timestamp}`);
    batch.set(newProductRef, {
      name: `Batch Product ${timestamp}`,
      price: 199.99,
      inStock: true,
      createdAt: new Date(),
    });

    // Update operation
    const existingProductRef = db.collection(PRODUCTS_COLLECTION).doc("product1");
    batch.update(existingProductRef, {
      price: 1099.99,
      updatedAt: new Date(),
    });

    // Delete operation (create a temp doc first, then delete it in the batch)
    const tempDocRef = db.collection(PRODUCTS_COLLECTION).doc(`temp_batch_${timestamp}`);
    await tempDocRef.set({ temp: true });
    batch.delete(tempDocRef);

    // Add another set operation for a second new product
    const anotherProductRef = db
      .collection(PRODUCTS_COLLECTION)
      .doc(`batch_product_2_${timestamp}`);
    batch.set(anotherProductRef, {
      name: `Another Batch Product ${timestamp}`,
      price: 299.99,
      inStock: false,
      createdAt: new Date(),
    });

    // Commit the batch
    const writeResults = await batch.commit();

    console.log("Batch committed successfully, write count:", writeResults.length);

    res.json({
      message: "Batch write executed successfully",
      operationCount: writeResults.length,
      writeTime: writeResults[0]?.writeTime.toDate(),
    });
  } catch (error: any) {
    console.error("Error in batch write:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`Server running on port ${PORT}`);
    console.log(`TUSK_DRIFT_MODE: ${process.env.TUSK_DRIFT_MODE || "DISABLED"}`);
    console.log("Available endpoints:");
    console.log("  GET    /health - Health check");
    console.log("  GET    /document/get - Get document");
    console.log("  POST   /document/create - Create document");
    console.log("  POST   /document/set - Set document");
    console.log("  PUT    /document/update - Update document");
    console.log("  DELETE /document/delete - Delete document");
    console.log("  POST   /collection/add - Add document to collection");
    console.log("  POST   /collection/doc-autoid - Create document with auto-generated ID");
    console.log("  GET    /query/get - Query documents");
    console.log("  POST   /transaction/increment - Transaction (increment counter)");
    console.log("  POST   /transaction/transfer - Transaction (multiple operations)");
    console.log("  POST   /batch/write - WriteBatch (batched writes)");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Clean up database entries
async function cleanupDatabase() {
  try {
    console.log("Cleaning up database entries...");
    const db = getDb();

    // Delete all documents from test collections
    const collections = [USERS_COLLECTION, PRODUCTS_COLLECTION];

    for (const collectionName of collections) {
      const collectionRef = db.collection(collectionName);
      const snapshot = await collectionRef.get();

      console.log(`Deleting ${snapshot.size} documents from ${collectionName}...`);

      // Delete in batches
      const batchSize = 100;
      const batches = [];

      for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = db.batch();
        const batchDocs = snapshot.docs.slice(i, i + batchSize);

        batchDocs.forEach((doc) => {
          batch.delete(doc.ref);
        });

        batches.push(batch.commit());
      }

      await Promise.all(batches);
      console.log(`Deleted all documents from ${collectionName}`);
    }

    console.log("Database cleanup complete");
  } catch (error) {
    console.error("Error cleaning up database:", error);
    // Don't throw - we still want to shut down gracefully
  }
}

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  server.close(async () => {
    await cleanupDatabase();
    await closeDb();
    process.exit(0);
  });
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
