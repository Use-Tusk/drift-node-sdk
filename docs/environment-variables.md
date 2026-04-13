# Environment Variables

This guide covers the environment variables that can be set when using the Tusk Drift SDK.

## TUSK_DRIFT_MODE

The `TUSK_DRIFT_MODE` environment variable controls how the SDK operates in your application.

### Available Modes

| Mode       | Description                                          | When to Use                                                                                        |
| ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `RECORD`   | Records traces for all instrumented operations       | Set this in environments where you want to capture API traces (e.g., staging, production)          |
| `REPLAY`   | Replays previously recorded traces                   | Automatically set by the Tusk CLI when running `tusk drift run` - you should NOT set this manually |
| `DISABLED` | Disables all instrumentation and recording           | Use when you want to completely disable Tusk with no performance impact                            |
| Unset      | Same as `DISABLED` - no instrumentation or recording | Default state when the variable is not set                                                         |

### Important Notes

**Recording Traces:**

- Set `TUSK_DRIFT_MODE=RECORD` in any environment where you want to record traces
- This is typically staging, production, or local development environments
- Traces will be saved according to your `recording` configuration in `.tusk/config.yaml`

**Replaying Traces:**

- `TUSK_DRIFT_MODE` is automatically set to `REPLAY` by the Tusk CLI when you run `tusk drift run`
- **Do NOT** manually set `TUSK_DRIFT_MODE=REPLAY` in your application startup commands
- The start command specified in your `.tusk/config.yaml` should NOT cause `TUSK_DRIFT_MODE` to be set to anything - the CLI handles this automatically

**Disabling Tusk:**

- If `TUSK_DRIFT_MODE` is unset or set to `DISABLED`, the SDK will not add any instrumentation
- No data will be recorded and there should be **no performance impact**
- This is useful for environments where you don't need Tusk functionality

### Examples

**Recording in development:**

```bash
TUSK_DRIFT_MODE=RECORD npm run dev
```

**Recording in production (via environment variable):**

```bash
# In your .env file or deployment configuration
TUSK_DRIFT_MODE=RECORD
```

**Start command in config.yaml (correct):**

```yaml
# .tusk/config.yaml
start_command: "npm run dev" # Do NOT include TUSK_DRIFT_MODE here
```

**Replaying traces (handled by CLI):**

```bash
# The CLI automatically sets TUSK_DRIFT_MODE=REPLAY
tusk drift run
```

**Disabling Tusk:**

```bash
# Either unset the variable or explicitly disable
TUSK_DRIFT_MODE=DISABLED npm start

# Or simply don't set it at all
npm start
```

## TUSK_API_KEY

Your Tusk Drift API key, required when using Tusk Cloud for storing and managing traces.

- **Required:** Only if using Tusk Cloud (not needed for local-only trace storage)
- **Where to get it:** [Tusk Drift Dashboard](https://usetusk.ai/app/settings/api-keys)

### How to Set

**For Recording:**

- Must be provided in the `TuskDrift.initialize()` call:

  ```typescript
  TuskDrift.initialize({
    apiKey: process.env.TUSK_API_KEY, // or hard-coded for non-production
    // ... other options
  });
  ```

**For Replay:**

- Can be set as an environment variable:

  ```bash
  TUSK_API_KEY=your-api-key-here tusk drift run
  ```

- Or use the Tusk CLI login command (recommended):

  ```bash
  tusk auth login
  ```

  This will securely store your auth key for future replay sessions.

## TUSK_RECORDING_SAMPLING_RATE

Controls what percentage of requests are recorded during trace collection.

- **Type:** Number between 0.0 and 1.0
- **If unset:** Falls back to `.tusk/config.yaml` and then the default base rate of `1.0`
- **Precedence:** This environment variable is overridden by the `samplingRate` parameter in `TuskDrift.initialize()`, but takes precedence over `recording.sampling.base_rate` and the legacy `recording.sampling_rate` setting in `.tusk/config.yaml`
- **Scope:** This only overrides the base rate. It does not change `recording.sampling.mode` or `recording.sampling.min_rate`

**Examples:**

```bash
# Record all requests (100%)
TUSK_RECORDING_SAMPLING_RATE=1.0 npm start

# Record 10% of requests
TUSK_RECORDING_SAMPLING_RATE=0.1 npm start
```

`TUSK_SAMPLING_RATE` is still accepted as a backward-compatible alias, but `TUSK_RECORDING_SAMPLING_RATE` is the canonical variable going forward.

If `recording.sampling.mode: adaptive` is enabled in `.tusk/config.yaml`, this environment variable still only changes the base rate; adaptive load shedding remains active.

For more details on sampling rate configuration methods and precedence, see the [Initialization Guide](./initialization.md#3-configure-sampling-rate).

## TUSK_USE_RUST_CORE

Control optional Rust-accelerated paths in the SDK. Truthy (`1`, `true`, `yes`, `on`) enables, falsy (`0`, `false`, `no`, `off`) disables. Enabled when unset.

**Notes:**

- The SDK is fail-open: if Rust bindings are unavailable or a Rust call fails, it falls back to JavaScript implementations.
- If Rust is enabled but bindings cannot be loaded, the SDK logs startup fallback and continues on JavaScript paths.

**Example usage:**

```bash
# Explicitly enable Rust path (also the default when unset)
TUSK_USE_RUST_CORE=1 npm start

# Explicitly disable Rust path
TUSK_USE_RUST_CORE=0 npm start
```

## Coverage Variables

These are set automatically by the CLI when `tusk drift run --coverage` is used. You should **not** set them manually.

| Variable | Description |
|----------|-------------|
| `NODE_V8_COVERAGE` | Directory for V8 to write coverage JSON files. Enables V8 precise coverage collection. |
| `TUSK_COVERAGE` | Language-agnostic signal that coverage is enabled. Set to `true`. |
| `TS_NODE_EMIT` | Forces ts-node to write compiled JS to disk (needed for coverage processing). Set to `true`. |

See [Coverage Guide](./coverage.md) for details on how coverage collection works.

## Related Documentation

- [Initialization Guide](./initialization.md) - SDK initialization parameters and config file settings
- [Quick Start Guide](./quickstart.md) - Record and replay your first trace
- [Coverage Guide](./coverage.md) - Code coverage during test replay
