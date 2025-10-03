# PostgreSQL (postgres) Instrumentation

## Purpose

Records and replays PostgreSQL database operations using the `postgres` (postgres.js) library to ensure deterministic behavior during replay. Captures SQL queries, parameters, and results during recording, then provides previously recorded results during replay.

NOTE: this is different from the pg instrumentation because postgres.js is a different library. PG is for node-postgres.

## Behavior by Mode

### Record Mode

- Intercepts connection creation (`postgres()` constructor)
- Records SQL template string queries (`sql SELECT * FROM users WHERE id = ${id}`)
- Records unsafe queries (`sql.unsafe()` method)
- Sanitizes sensitive connection information (passwords, SSL keys)

### Replay Mode

- Returns previously recorded query results instead of executing against database
- Simulates successful connection for all `postgres.connect` operations
- Reconstructs PostgreSQL data types (timestamps, dates) from stored JSON
- Maintains query interface compatibility (template strings, unsafe queries)
  - Provides postgres.js-compatible `PendingQuery` wrapper for unsafe queries

## Implementation Details

### Patching Strategy

The `postgres` library uses a unique API that requires specialized patching:

- **Module-level patching**: The main export is a function that creates SQL instances
- **Connection-level patching**: Each SQL instance returned by `postgres()` is individually wrapped
- **Global sql patching**: If `postgres.sql` exists as a named export, it's also patched

### What Gets Instrumented

#### 1. Connection (`postgres.connect`)

Instrumented at the module level when the postgres constructor is called:

```javascript
const sql = postgres("postgres://user:pass@localhost/db");
// ^ This creates a span and wraps the returned sql instance
```

**Instrumentation location**: Module-level wrapper in `_handlePostgresConnection()`

**Details**:

- Sanitizes connection strings and options (removes passwords, SSL keys)
- Creates span for connection operation
- Wraps the returned SQL instance with query instrumentation

#### 2. SQL Template String Queries (`postgres.query`)

Instrumented on each SQL instance returned from the connection:

```javascript
const users = await sql`SELECT * FROM users WHERE id = ${userId}`;
// ^ This query is intercepted and instrumented
```

**Instrumentation location**: Per-instance wrapper in `_wrapSqlInstance()`

**Details**:

- Intercepts template string syntax
- Reconstructs parameterized query with `$1`, `$2` placeholders
- Captures query text and parameter values
- Returns array with metadata properties (`command`, `count`)

#### 3. Unsafe Queries (`postgres.unsafe`)

Instrumented as a method on each SQL instance:

```javascript
const result = await sql.unsafe("SELECT * FROM users WHERE id = $1", [userId]);
// ^ The unsafe method is wrapped per instance
```

**Instrumentation location**: Method wrapper in `_wrapUnsafeMethod()`

**Details**:

- Handles raw SQL strings with optional parameter arrays
- Supports query options (`prepare` flag)
- Returns full result object with `{ command, count, rows }` structure
- Creates `PendingQuery` wrapper with `.values()` method

### Special Handling: Unsafe Query Promise Chain Preservation

The `unsafe()` method requires special handling due to postgres.js's sophisticated internal session and connection management:

**The Problem**:

- postgres.js maintains internal state using promise identity and async context tracking
- Calling `.then()` or `.catch()` creates new promise objects, breaking postgres.js's internal tracking
- This can cause connection leaks, transaction issues, or query failures

**The Solution** (see `_executeThenAddOutputAttributes()`):

```javascript
// Execute the query and get the original promise
const promise = executeUnsafe();

// Use finally() to track completion without breaking the promise chain
promise.finally(() => {
  // Add span attributes AFTER the original promise completes
  promise
    .then((result) => {
      /* record success */
    })
    .catch((error) => {
      /* record error */
    });
});

// Return the ORIGINAL promise unchanged
return promise;
```

**Why this matters**:

- The original promise object is returned unchanged to preserve postgres.js's internal state
- This approach maintains postgres.js's session management
- Template string queries don't have this issue since they use `await` internally

### Mock Response Construction

#### Template String Queries (Replay Mode)

Returns arrays with metadata properties:

```javascript
const rows = [{ id: 1, name: "Alice" }];
return Object.assign(rows, {
  command: "SELECT",
  count: 1,
});
```

#### Unsafe Queries (Replay Mode)

Returns `PendingQuery` wrapper with additional methods:

```javascript
{
  command: 'SELECT',
  count: 1,
  rows: [{ id: 1, name: 'Alice' }],
  values: () => Promise<any[][]>
}
```

### Version Support

- **postgres**: Version 3.x (postgres.js driver)
