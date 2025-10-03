# JWKS-RSA Instrumentation

## Purpose

**Rate limiting bypass only** - This instrumentation does not record or replay JWKS-RSA operations. Its sole purpose is to disable client-side rate limiting enforced by the `jwks-rsa` library during replay mode, preventing replay failures due to rate limit violations.

Because this rate limiting is on the client side, we must instrument this library to disable it in replay mode.

## Behavior by Mode

### Record Mode

- No instrumentation or patching
- Uses original `jwks-rsa` library behavior
- Rate limiting remains active and enforced

### Replay Mode

- Patches `jwks-rsa` configuration to disable rate limiting
- Removes `jwksRequestsPerMinute` limitations
- Sets `rateLimit: false` on JWKS client options
- Allows unlimited key fetching during replay

### Disabled Mode

- No patching - uses original `jwks-rsa` library behavior

## Implementation Details

### Patching Strategy

- Patches `jwks-rsa.expressJwtSecret()` function only
- Modifies configuration options passed to JWKS client
- Does not patch core JWKS operations or key resolution

### Configuration Modification

```typescript
// Original options
const options = {
  jwksUri: "https://example.com/.well-known/jwks.json",
  rateLimit: true,
  jwksRequestsPerMinute: 5,
};

// Modified in replay mode
const modifiedOptions = {
  jwksUri: "https://example.com/.well-known/jwks.json",
  rateLimit: false,
  // jwksRequestsPerMinute property removed
};
```

### Supported Functions

- **expressJwtSecret**: Primary patching target for Express.js JWT integration
- Other JWKS-RSA functions remain unmodified
