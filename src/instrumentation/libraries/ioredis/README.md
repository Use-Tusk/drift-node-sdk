# IORedis Instrumentation

## Purpose

Records and replays Redis operations using the `ioredis` library to ensure deterministic behavior during replay. Captures Redis commands, arguments, and results during recording, then provides previously recorded results during replay.

## Behavior by Mode

### Record Mode

- Intercepts Redis connection creation and individual commands
- Records all Redis operations (GET, SET, HGETALL, ZSCORE, etc.)
- Records pipeline and multi (transaction) operations
- Captures connection information (host, port)
- Records **final transformed values** that the application code receives

### Replay Mode

- Returns previously recorded command results instead of executing against Redis
- Simulates successful connection for all `connect` operations
- Returns data in the exact format that was recorded (already transformed by ioredis)
- Handles all ioredis data type transformations correctly

## Implementation Details

### Patching Strategy

The `ioredis` library requires multi-level patching:

- **Module-level patching**: The main Redis class export
- **Connection-level patching**: `connect()` method for connection tracking
- **Command-level patching**: `sendCommand()` method for individual operations
- **Pipeline-level patching**: Dynamic instance patching for `pipeline()` and `multi()` methods

### Key Design Decision: Recording Post-Transformation Values

**Critical Insight**: We intercept **AFTER** ioredis's internal transformations by wrapping the Promise returned by `sendCommand`, not the internal `cmd.resolve` callback.

#### Why This Matters

IORedis has multiple transformation layers:
1. `sendCommand` returns a Promise
2. The Promise resolves with raw data (Buffers, arrays)
3. IORedis applies transformations (Buffer→string, array→object for HGETALL, string→number for numeric commands)
4. The **final transformed value** is what application code receives


**Buffer Conversion Logic**:
- **UTF-8 Buffers**: Convert to string for JSON storage
- **Binary Buffers**: Convert to base64 string with metadata
- **Other types**: Store as-is


### Version Support

- **ioredis**: Versions 4.x and 5.x
