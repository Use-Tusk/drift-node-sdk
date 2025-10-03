# PostgreSQL (pg) Instrumentation

## Purpose

Records and replays PostgreSQL database operations to ensure deterministic behavior during replay. Captures SQL queries, parameters, and results during recording, then provides previously recorded results during replay, eliminating database dependencies.

## Behavior by Mode

### Record Mode

- Intercepts `pg.Client.query()` and `pg.Pool.query()` operations
- Records SQL queries, parameters, and complete result sets
- Captures connection operations (`connect()`) for both clients and pools
- Preserves original database execution while recording outcomes
- Supports both callback-based and promise-based query patterns

### Replay Mode

- Returns previously recorded query results instead of executing against database
- Provides mock `TdPgClientMock` instances for pool connections
- Simulate successful connect for all `pg-connect` connect operations
- Reconstructs PostgreSQL data types (timestamps, dates) from stored JSON
- Maintains query interface compatibility (callbacks vs promises)
- Throws errors if no matching mock data is found

### Disabled Mode

- No patching - uses original `pg` library behavior

## Implementation Details

### Patching Strategy

- **pg module**: Patches `Client.prototype.query` and `Client.prototype.connect`
- **pg-pool module**: Patches `Pool.prototype.query` and `Pool.prototype.connect`
- Supports both individual clients and connection pool usage patterns
- Maintains separate patching for different client types

### Version Support

- **pg**: Version 8.x (primary PostgreSQL driver)
- **pg-pool**: Versions 2.x and 3.x (connection pooling)
