# Firestore (@google-cloud/firestore) Instrumentation

## Purpose

Records and replays Google Cloud Firestore database operations to ensure deterministic behavior during replay. Captures Firestore operations (document reads/writes, queries, collection operations), their parameters, and results during recording, then provides previously recorded results during replay, eliminating Firestore database dependencies.

## Implementation Details

### Key Design Decision: Synchronous Mock Resolution

**The Challenge**: Unlike most database operations, Firestore's `CollectionReference.doc()` is a **synchronous** method that returns a `DocumentReference` immediately without awaiting a Promise. This creates a unique instrumentation challenge.

#### Why This Matters

Most database operations are asynchronous:

```javascript
// Async operations can use findMockResponseAsync
const snapshot = await docRef.get(); // Returns Promise
const writeResult = await docRef.set(data); // Returns Promise
```

However, `doc()` is synchronous:

```javascript
// doc() must return synchronously - no await possible
const docRef = collection.doc(); // Returns DocumentReference immediately
console.log(docRef.id); // ID must be available now
```

#### The Solution

We use `findMockResponseSync()` instead of `findMockResponseAsync()`:

```typescript
// In _getCollectionDocPatchFn()
const mockData = findMockResponseSync({
  mockRequestData: {
    /* ... */
  },
  tuskDrift: this.tuskDrift,
});

// Use recorded ID for deterministic replay
const recordedId = mockData.result.id;
return originalDoc.call(this, recordedId);
```

#### Known Limitation

**Important**: This synchronous approach has one edge case:

> If `collection.doc()` is the **first** mock requested in replay mode, `findMockResponseSync()` may throw an error because the SDK/CLI connection hasn't been established yet (the connection is established asynchronously on first use).

**Workaround**: In e2e tests and applications, ensure the first operation in replay mode is an asynchronous operation. For example:

```javascript
// In e2e tests - see e2e-tests/cjs-firestore/src/index.ts:19-27
async function initializeDatabase() {
  // Make an async call first to establish CLI/SDK connection
  const response = await fetch("https://google.com");

  // Now synchronous operations like doc() will work
  const db = getDb();
  const docRef = db.collection("users").doc("user1"); // Safe now
}
```

This limitation is only relevant in replay mode and is mitigated by the pattern of having at least one async operation before using `doc()`.
