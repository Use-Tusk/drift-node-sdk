# JSON Web Token (JWT) Instrumentation

## Purpose

Records and replays JWT operations (`sign` and `verify`) to ensure deterministic behavior in applications that use JWTs for authentication or data exchange.

## Behavior by Mode

### Record Mode

- Intercepts `jwt.sign()` and `jwt.verify()` calls
- Records input parameters and execution results
- Captures both successful results and JWT-specific errors
- Preserves original JWT behavior while recording outcomes

### Replay Mode

- Returns previously recorded JWT results instead of performing actual operations
- Reconstructs specific JWT error types (`TokenExpiredError`, `JsonWebTokenError`, etc.)
- Maintains callback vs. synchronous operation patterns
- Throws errors if no matching mock data is found

### Disabled Mode

- No patching - uses original `jsonwebtoken` library behavior

## Implementation Details

### Patching Strategy

- Patches `jwt.sign` and `jwt.verify` functions on the jsonwebtoken module
- Supports both callback-based and synchronous operation patterns
- Preserves all JWT library functionality and error handling

### Supported Operations

#### JWT Verify

```typescript
jwt.verify(token, secret, options?, callback?)
```

- Captures token validation results
- Records decoded payload or specific error types
- Handles both sync and async patterns

#### JWT Sign

```typescript
jwt.sign(payload, secret, options?, callback?)
```

- Records token generation results
- Captures generated JWT strings
- Handles signing errors appropriately
