# Environment Variables

This guide covers the environment variables that can be set when using the Tusk Drift SDK.

## TUSK_DRIFT_MODE

The `TUSK_DRIFT_MODE` environment variable controls how the SDK operates in your application.

### Available Modes

| Mode       | Description                                          | When to Use                                                                                  |
| ---------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `RECORD`   | Records traces for all instrumented operations       | Set this in environments where you want to capture API traces (e.g., staging, production)    |
| `REPLAY`   | Replays previously recorded traces                   | Automatically set by the Tusk CLI when running `tusk run` - you should NOT set this manually |
| `DISABLED` | Disables all instrumentation and recording           | Use when you want to completely disable Tusk with no performance impact                      |
| Unset      | Same as `DISABLED` - no instrumentation or recording | Default state when the variable is not set                                                   |

### Important Notes

**Recording Traces:**

- Set `TUSK_DRIFT_MODE=RECORD` in any environment where you want to record traces
- This is typically staging, production, or local development environments
- Traces will be saved according to your `recording` configuration in `.tusk/config.yaml`

**Replaying Traces:**

- `TUSK_DRIFT_MODE` is automatically set to `REPLAY` by the Tusk CLI when you run `tusk run`
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
tusk run
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
  TUSK_API_KEY=your-api-key-here tusk run
  ```

- Or use the Tusk CLI login command (recommended):

  ```bash
  tusk auth login
  ```

  This will securely store your auth key for future replay sessions.

## TUSK_SAMPLING_RATE

Controls what percentage of requests are recorded during trace collection.

- **Type:** Number between 0.0 and 1.0
- **Default:** 1.0 (100% of requests)
- **Precedence:** This environment variable is overridden by the `samplingRate` parameter in `TuskDrift.initialize()`, but takes precedence over the `sampling_rate` setting in `.tusk/config.yaml`

**Examples:**

```bash
# Record all requests (100%)
TUSK_SAMPLING_RATE=1.0 npm start

# Record 10% of requests
TUSK_SAMPLING_RATE=0.1 npm start
```

For more details on sampling rate configuration methods and precedence, see the [Initialization Guide](./initialization.md#3-configure-sampling-rate).

---

## Related Documentation

- [Initialization Guide](./initialization.md) - SDK initialization parameters and config file settings
- [Quick Start Guide](./quickstart.md) - Record and replay your first trace
