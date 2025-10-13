# Next.js Instrumentation

This instrumentation intercepts Next.js server requests to enable recording and replaying of API interactions.

## Purpose

While the HTTP instrumentation captures traffic at the Node.js `http.Server` level, Next.js applications require framework-level instrumentation because:

1. **Framework abstraction**: Next.js wraps the native Node.js HTTP server with its own `BaseServer` class, which handles routing, middleware, and request processing before reaching the raw HTTP layer.

2. **Request/Response wrapping**: Next.js wraps the native `IncomingMessage` and `ServerResponse` objects with its own abstractions, making it difficult to capture request/response data at the HTTP layer.

3. **Interception timing**: By the time requests reach the HTTP instrumentation layer, Next.js has already processed much of the request lifecycle. Intercepting at `BaseServer.handleRequest` ensures we capture the complete Next.js request flow.

This approach is similar to how the HTTP server instrumentation works - both patch the primary request handling method of their respective servers. The key difference is the interception point: `BaseServer.handleRequest` for Next.js vs `Server.prototype.emit('request')` for raw HTTP servers.

## Behavior by Mode

### RECORD Mode

- Intercepts `BaseServer.prototype.handleRequest` to capture incoming requests
- Records request details:
  - HTTP method, URL, headers
  - Request body (for POST/PUT/PATCH requests)
  - Query parameters
- Records response details:
  - Status code, headers
  - Response body
- Creates spans with:
  - Span kind: `SERVER`
  - Request/response data stored as span attributes
  - Trace context propagation
- Filters out SDK traffic to prevent recursive recording
- Handles sampling

### REPLAY Mode

- Extracts replay trace context from headers, env vars, and creates spans with mock responses

### DISABLED Mode

- Next.js operates normally without any instrumentation overhead

## Implementation Details

### Patching Strategy

The instrumentation patches `BaseServer.prototype.handleRequest`, which is the main entry point for all Next.js requests. This method is called for every incoming HTTP request after Next.js has set up its internal request/response wrappers.

### Patching Loaded Modules

A critical aspect of this instrumentation is `_patchLoadedModules()`, which searches `require.cache` for already-loaded Next.js modules. This is necessary because:

1. **Early loading**: Next.js often loads the `next/dist/server/base-server` module during framework initialization, before the instrumentation system has a chance to intercept it.

2. **Module caching**: Node.js caches modules in `require.cache`, so subsequent `require()` calls return the cached module without triggering interception hooks.

The solution is to search `require.cache` for modules matching the Next.js base-server path and manually patch their exports.

### Request/Response Capture

The instrumentation uses a similar approach to the HTTP server instrumentation:

1. **Request body capture**:
   - Buffers incoming request data by listening to the `data` event
   - Handles different content types (JSON, form data, text)
   - Stores the body as a span attribute

2. **Response body capture**:
   - Patches `res.write()` and `res.end()` to capture response data
   - Buffers response chunks to reconstruct the full response body
   - Handles streaming responses and chunked encoding

3. **Stream handling**:
   - Resumes request streams that are paused to ensure data flows correctly
   - Preserves original stream behavior to prevent breaking application logic
