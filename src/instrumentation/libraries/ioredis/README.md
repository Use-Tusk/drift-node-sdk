# IORedis Instrumentation

## Purpose

Records and replays Redis operations using the `ioredis` library to ensure deterministic behavior during replay. Captures Redis commands, arguments, and results during recording, then provides previously recorded results during replay.

## Behavior by Mode

### Record Mode

- Intercepts Redis connection creation and individual commands
- Records all Redis operations (GET, SET, HGETALL, etc.)
- Records pipeline and multi (transaction) operations
- Captures connection information (host, port)

### Replay Mode

- Returns previously recorded command results instead of executing against Redis
- Simulates successful connection for all `connect` operations
- Reconstructs Redis data types from stored JSON
- Handles Buffer-to-string conversions automatically
- Supports hash command array-to-object transformations

## Implementation Details

### Patching Strategy

The `ioredis` library requires multi-level patching:

- **Module-level patching**: The main Redis class export
- **Connection-level patching**: `connect()` method for connection tracking
- **Command-level patching**: `sendCommand()` method for individual operations
- **Pipeline-level patching**: Dynamic instance patching for `pipeline()` and `multi()` methods

### Special Handling: Data Type Conversions

#### Buffer-to-String Conversion

IORedis internally uses Buffers at the `sendCommand` level but converts them to strings before returning to users. Our instrumentation matches this behavior:

**The Problem**:
- Redis protocol works with raw bytes (Buffers)
- Users expect string responses for text data
- Recording raw Buffers would serialize incorrectly

**The Solution**:
```javascript
if (Buffer.isBuffer(value)) {
  return {
    value: value.toString("utf8"),
  };
}
```

This ensures recorded data matches what users see in their application code.

#### Hash Command Array-to-Object Conversion

Redis HGETALL returns a flat array `[key1, value1, key2, value2, ...]` but IORedis converts it to an object for user convenience:

**The Problem**:
- Redis wire protocol returns flat array
- IORedis transforms to object: `{key1: value1, key2: value2, ...}`
- Recording the raw array would not match user expectations

**The Solution**:
```javascript
if (this._isHashCommand(commandName) && convertedArray.length > 0) {
  const obj: Record<string, any> = {};
  for (let i = 0; i < convertedArray.length; i += 2) {
    obj[convertedArray[i]] = convertedArray[i + 1];
  }
  return { value: obj };
}
```

This ensures hash commands return objects during replay, matching IORedis behavior.

### Version Support

- **ioredis**: Versions 4.x and 5.x
