# Environment Variable Instrumentation

## Purpose

Records and replays environment variable access (`process.env`) to ensure deterministic behavior across record and replay modes. Captures environment variable values during recording and returns the same values during replay, eliminating environment-dependent behavior.

## Configuration

Environment variable instrumentation can be enabled/disabled via the `enable_env_var_recording` flag in the recording configuration:

```yaml
recording:
  enable_env_var_recording: true # Enable environment variable recording and replaying
```

When disabled (default), no patching occurs and `process.env` behaves normally.

**Note**: Unlike other instrumentations that patch modules lazily when they're required, environment variable instrumentation patches the global `process.env` object immediately during initialization. This is why the `enable_env_var_recording` config check is needed to prevent unwanted patching of the global environment.

## Behavior by Mode

### Record Mode

- Intercepts all `process.env` property access
- If app has started + currently in a span, stores accessed environment variable key-value pairs in `EnvVarTracker`. Stored as a mapping between trace id and env var key-value pairs (`Map<string, Record<string, string | undefined>>`)
- Associates environment variables with the current trace ID
- Returns actual environment variable values

### Replay Mode

- Returns previously recorded environment variable values for the current trace using `EnvVarTracker.getEnvVar()`
- Falls back to actual environment values if no recorded value exists

### Disabled Mode

- No patching - uses original `process.env` behavior

## Implementation Details

### Patching Strategy

- Replaces `process.env` with a Proxy object
- Intercepts property access via `get` trap
- Preserves all other `process.env` operations (set, delete, enumeration)
- Uses proxy to maintain transparent behavior

### HTTP Instrumentation Integration

- EnvVars accumulated during server span will be added to the span's metadata as `ENV_VARS`
- In replay mode, env vars are extracted from the incoming request headers and added to `EnvVarTracker`
