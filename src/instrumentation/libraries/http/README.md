# HTTP Instrumentation

## Purpose

HTTP request and response instrumentation for both client (outbound requests) and server (inbound requests) operations. Records complete HTTP traffic (headers, bodies, status codes) during record mode and provides mocked responses during replay mode.

## Behavior by Mode

### Record Mode

- **Server**: Creates SERVER spans for inbound HTTP requests, captures full request/response data
- **Client**: Creates CLIENT spans for outbound HTTP requests, records request/response details
- Applies sampling rate to control span creation
- Skips CORS preflight requests and SDK's own export traffic
- Captures request/response bodies asynchronously without blocking request flow

### Replay Mode

- **Server**: Extracts replay trace context from headers, creates spans with mock responses
- **Client**: Looks up matching mock responses instead of making real HTTP requests
- Handles environment variable injection for deterministic replay

### Disabled Mode

- No patching - uses original HTTP module behavior

## Implementation Details

### Patching Strategy

- Patches both `http` and `https` modules
- **Client-side**: Patches `request()` and `get()` methods
- **Server-side**: Patches `Server.prototype.emit` to intercept 'request' events

### Request Body Capture

- Patches `req.write()` and `req.end()` to capture request body
- Handles various body formats (string, Buffer, streams)
- Processes body asynchronously to avoid blocking request
- Base64 encodes binary data for storage and transport
- Adds schema merges for body and headers
  - Body
    - encoding: BASE64
    - decodedType: `getDecodedType(headers["content-type"] || "")`
  - Headers
    - matchImportance: 0

### Inbound Request Replay Logic

- **Trace Context Extraction**: Reads replay trace ID from custom headers
  - Reads replay trace id from `x-td-trace-id`
  - Sets replay trace id in context using `SpanUtils.setCurrentReplayTraceId()`
- **Environment Variable Injection**: Sets trace-specific environment variables
  - Reads environment variables from `x-td-env-vars`
  - Sets environment variables in context using `EnvVarTracker.setEnvVars()`
- **Span Data Export**: Sends inbound replay span back to CLI to be classified as deviation or not

### SDK Traffic Filtering

- Uses `TUSK_SKIP_HEADER` to identify and bypass SDK requests
- Checks `isTuskDriftIngestionUrl()` to avoid instrumenting drift exports
- Prevents infinite loops and span pollution
