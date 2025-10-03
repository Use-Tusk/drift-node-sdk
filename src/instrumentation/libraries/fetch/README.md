# Fetch API Instrumentation

## Purpose

Instruments the global `fetch()` API to record and replay HTTP requests. Required because Node.js v18+ uses Undici for fetch implementation, which bypasses the HTTP module instrumentation.

## Behavior by Mode

### Record Mode

- Intercepts all `fetch()` calls and creates CLIENT spans
- Records request details (URL, method, headers, body)
- Captures response data (status, headers, body) by cloning responses

### Replay Mode

- Intercepts `fetch()` calls and looks up matching mock responses
- Returns previously recorded responses as native `Response` objects
- Throws errors if no matching mock data is found
- Creates spans for tracing but doesn't make actual network requests

### Disabled Mode

- No patching - uses original `fetch()` implementation

## Implementation Details

### Patching Strategy

- Replaces `globalThis.fetch` with instrumented wrapper function
- Patches are applied globally since `fetch` isn't a module export
- Preserves original function for fallback and actual request execution

### Body Processing

- Uses `httpBodyEncoder` for consistent body encoding/decoding
- Handles various body types (string, FormData, Blob, ArrayBuffer)
- Base64 encodes binary data for storage and transport
- Adds schema merges for body and headers
  - Body
    - encoding: BASE64
    - decodedType: `getDecodedType(headers["content-type"] || "")`
  - Headers
    - matchImportance: 0

### Global API Patching

- Patches `globalThis.fetch` rather than module exports
- Must handle the fact that fetch doesn't require imports
- Available in most modern JavaScript environments

### Response Cloning

- Clones responses to read body without consuming original
- Ensures application code can still read response normally
- Handles streams and prevents double-consumption issues

### Mock Response Construction

- Creates proper `Response` objects with correct headers and status
- Reconstructs binary bodies from Base64 encoded storage
- Maintains response interface compatibility

### SDK Traffic Filtering

- Checks for `TUSK_SKIP_HEADER` to avoid instrumenting SDK requests
- Uses `isTuskDriftIngestionUrl()` to identify drift export endpoints
- Prevents infinite loops and span pollution
