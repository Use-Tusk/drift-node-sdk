# MySQL2 Instrumentation

## Purpose

Records and replays MySQL database operations using the `mysql2` library to ensure deterministic behavior during replay. Captures SQL queries, parameters, and results during recording, then provides previously recorded results during replay, eliminating database dependencies.

## Behavior by Mode

### Record Mode

- Intercepts connection creation (`mysql2.createConnection()`, `mysql2.createPool()`)
- Records query operations (`query()`, `execute()`) for connections, pools, and pool connections
- Records connection lifecycle operations (`connect()`, `ping()`, `end()`)
- Captures pool connection acquisition (`pool.getConnection()`)
- Supports callback-based, promise-based, and streaming query patterns
- Preserves original database execution while recording outcomes

### Replay Mode

- Returns previously recorded query results instead of executing against database
- Provides mock `TdMysql2ConnectionMock` instances for pool connections
- Simulates successful connection lifecycle operations (connect, ping, end)
- Reconstructs MySQL2 data types from stored JSON
- Maintains query interface compatibility (callbacks, promises, streams)
- Supports both regular queries and prepared statements (execute)
- Throws errors if no matching mock data is found

### Disabled Mode

- No patching - uses original `mysql2` library behavior

## Implementation Details

### File-Level Patching
Patches internal library files to intercept operations:

- **`mysql2/lib/connection.js`**: Patches `Connection` class prototype
  - `query()` - Regular SQL queries
  - `execute()` - Prepared statements
  - `connect()` - Connection establishment
  - `ping()` - Connection health checks
  - `end()` - Connection termination

- **`mysql2/lib/pool.js`**: Patches `Pool` class prototype
  - `query()` - Pool-level queries
  - `execute()` - Pool-level prepared statements
  - `getConnection()` - Connection acquisition from pool

- **`mysql2/lib/pool_connection.js`**: Patches `PoolConnection` class prototype
  - `query()` - Pool connection queries
  - `execute()` - Pool connection prepared statements

- **`mysql2/lib/create_connection.js`**: Patches the factory function directly
  - Required for ESM compatibility where the main module assigns `require('./lib/create_connection.js')` to `exports.createConnection`
  - Also handles CJS compatibility

- **`mysql2/lib/create_pool.js`**: Patches the factory function directly
  - Required for ESM compatibility where the main module assigns `require('./lib/create_pool.js')` to `exports.createPool`
  - Also handles CJS compatibility

### Version Support

- **mysql2**: Version 3.x (fast MySQL driver for Node.js)

## Architecture

### Separation of Concerns

The instrumentation follows a clean architecture:

1. **`Instrumentation.ts`** (~1178 lines)
   - Handles patching strategy and shimmer wrapping
   - Manages record mode span creation and data capture
   - Delegates replay logic to mock classes

2. **`mocks/TdMysql2QueryMock.ts`** (~197 lines)
   - Handles all query replay logic
   - Manages EventEmitter creation for streaming queries
   - Converts stored data back to MySQL2 format

3. **`mocks/TdMysql2ConnectionMock.ts`**
   - Provides mock connection instances
   - Delegates to query mock for actual query execution

This separation keeps the instrumentation maintainable and testable.
