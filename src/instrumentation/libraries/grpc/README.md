# gRPC (@grpc/grpc-js) Instrumentation

## Purpose

Records and replays gRPC client requests to ensure deterministic behavior during replay. Captures complete gRPC call details (method, service, request/response bodies, metadata, status) during recording, then provides previously recorded responses during replay, eliminating gRPC service dependencies.

NOTE: this only instruments the client side of gRPC calls. Server-side instrumentation is commented out for now. This will require more changes in order to properly replay server-side gRPC calls. Holding off until a customer asks for it.

## Behavior by Mode

### Record Mode

- **Client**: Intercepts `makeUnaryRequest()` calls and creates CLIENT spans
- Records complete request details (service, method, body, metadata)
- Captures response data (body, status, metadata) via callback and event listeners
- Listens to both `status` and `metadata` events to capture full response lifecycle
- Preserves original gRPC call execution while recording outcomes

### Replay Mode

- **Client**: Returns previously recorded responses instead of making real gRPC calls
- Simulates gRPC call behavior using EventEmitter to emit `metadata` and `status` events
- Reconstructs response objects from stored JSON data
- Provides mock implementations for `waitForReady()`, `close()`, and `getChannel()`
- Throws errors if no matching mock data is found

### Disabled Mode

- No patching - uses original `@grpc/grpc-js` library behavior

## Implementation Details

### Patching Strategy

- **Main Module**: Patches `@grpc/grpc-js` to capture and store the `Metadata` constructor
- **Client File**: Patches `@grpc/grpc-js/build/src/client.js` to intercept the internal `Client` class
  - Required because `Client` class is not exported from the main module
  - Ensures patches are applied before any service clients are created
- **Client Methods Patched**:
  - `makeUnaryRequest()` - Main method for unary gRPC calls
  - `waitForReady()` - Skipped in replay mode
  - `close()` - No-op in replay mode
  - `getChannel()` - Returns mock channel in replay mode

### Version Support

- **@grpc/grpc-js**: Version 1.\* (modern gRPC implementation for Node.js)
- Uses version-specific `metadataStore` to handle multiple package versions

### Argument Parsing

Uses argument validation based on the `makeUnaryRequest` signature:

```typescript
makeUnaryRequest(method, serialize, deserialize, argument, metadata, [options], callback);
```

The `options` parameter is optional, so the callback can be at position 5 or 6:

- **Without options**: `(metadata, callback)` - callback at position 5
- **With options**: `(metadata, options, callback)` - callback at position 6

The instrumentation uses `parseUnaryCallArguments()` to:

1. Validate that metadata is an instance of the gRPC `Metadata` class
2. Validate that options (if provided) is an Object
3. Validate that callback is a Function
4. Return normalized parameters with options defaulting to `{}` if not provided

### Response Capture Strategy

gRPC responses are captured using a dual-tracking mechanism:

1. **Callback**: Captures response body or error
2. **Event Listeners**:
   - `metadata` event: Captures initial response metadata
   - `status` event: Captures final status and trailing metadata

Both the callback and `status` event must fire before ending the span, tracked via:

- `isResponseReceived`: Set when callback receives response
- `isStatusEmitted`: Set when `status` event fires

This ensures complete response data is captured before the span is closed.

### Metadata Constructor Storage

Uses a version-keyed `metadataStore` Map to handle edge cases:

- Stores the gRPC `Metadata` constructor for each version
- Allows correct instanceof checks during argument validation
- Supports scenarios where multiple versions of `@grpc/grpc-js` might coexist

### Mock Response Construction (Replay Mode)

Creates a mock EventEmitter that simulates the gRPC call interface:

- Implements `cancel()`, `getPeer()` methods
- Emits `metadata` and `status` events on `process.nextTick()` to simulate async behavior
- Invokes callback with reconstructed response or error
- Maintains compatibility with the native gRPC call interface

### Buffer Handling

gRPC messages often contain binary data (protobuf `bytes` fields) which are represented as Node.js `Buffer` objects. Since Buffers cannot be directly serialized to JSON, the instrumentation uses a **placeholder-based approach** to preserve both the data and the correct object structure.

#### Sentinel Placeholders

The instrumentation uses a two-part storage strategy:

1. **`readableBody`**: JSON-serializable object with `"__tusk_drift_buffer_replaced__"` placeholders marking Buffer locations
2. **`bufferMap`**: Separate map storing the actual binary data as Base64/UTF-8 strings, keyed by field path

### Server-Side Support (Commented Out)

Server-side instrumentation is implemented but commented out:

- Patches `Server.prototype.register` to intercept handler registration
- Creates SERVER spans for inbound gRPC requests
- **Status**: Not fully tested, disabled until customer request
