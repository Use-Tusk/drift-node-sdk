# Next.js Initialization (Beta)

This guide explains how to set up Tusk Drift in your Next.js application.

## Step 1: Configure Next.js with `withTuskDrift`

Wrap your Next.js configuration with the `withTuskDrift` function in your `next.config.js` or `next.config.ts` file:

### Basic Configuration

#### CommonJS (next.config.js)

```javascript
// next.config.js
const { withTuskDrift } = require("@use-tusk/drift-node-sdk/next");

module.exports = withTuskDrift({
  // Your Next.js config
});
```

#### ESM (next.config.mjs)

```javascript
// next.config.mjs
import { withTuskDrift } from "@use-tusk/drift-node-sdk/next";

export default withTuskDrift({
  // Your Next.js config
});
```

### With Debug Logging for Next.js Integration

#### CommonJS (next.config.js)

```javascript
// next.config.js
const { withTuskDrift } = require("@use-tusk/drift-node-sdk/next");

module.exports = withTuskDrift(
  {
    // Your Next.js config
  },
  {
    // Tusk Drift options
    debug: true, // Enable debug logging
  },
);
```

#### ESM (next.config.mjs)

```javascript
// next.config.mjs
import { withTuskDrift } from "@use-tusk/drift-node-sdk/next";

export default withTuskDrift(
  {
    // Your Next.js config
  },
  {
    // Tusk Drift options
    debug: true, // Enable debug logging
  },
);
```

### What `withTuskDrift` Does

The `withTuskDrift` wrapper automatically:

- ✅ Enables the Next.js instrumentation hook (for Next.js < 15.0.0-rc.1)
- ✅ Configures webpack externals for proper module interception
- ✅ Detects your Next.js version and adjusts configuration accordingly
- ✅ Preserves your existing Next.js configuration

### Configuration Options

<table>
  <thead>
    <tr>
      <th>Option</th>
      <th>Type</th>
      <th>Default</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>debug</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Enable debug logging to see what Tusk Drift is configuring during build.</td>
    </tr>
    <tr>
      <td><code>disableInstrumentationHook</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Disable automatic setting of <code>experimental.instrumentationHook</code>. Not recommended, will break Tusk Drift's Next.js integration.</td>
    </tr>
    <tr>
      <td><code>suppressWarnings</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Suppress all warnings from Tusk Drift's Next.js integration.</td>
    </tr>
  </tbody>
</table>

## Step 2: Create Instrumentation File

Create an `instrumentation.ts` (or `.js`) file at the **root of your Next.js project** (or inside the `src` folder if using one):

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { TuskDrift } = await import("@use-tusk/drift-node-sdk");

    TuskDrift.initialize({
      apiKey: process.env.TUSK_API_KEY,
      env: process.env.NODE_ENV,
      logLevel: "debug",
    });

    // Mark app as ready immediately
    TuskDrift.markAppAsReady();
  }
}
```

More context on setting up instrumentations for Next.js apps can be found [here](https://nextjs.org/docs/app/guides/instrumentation).

### Initialization Parameters

<table>
  <thead>
    <tr>
      <th>Option</th>
      <th>Type</th>
      <th>Default</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>apiKey</code></td>
      <td><code>string</code></td>
      <td><b>Required if using Tusk Cloud</b></td>
      <td>Your Tusk Drift API key from the <a href="https://usetusk.ai/app/settings/api-keys">dashboard</a>.</td>
    </tr>
    <tr>
      <td><code>env</code></td>
      <td><code>string</code></td>
      <td><code>process.env.NODE_ENV</code></td>
      <td>The environment name (e.g., 'dev', 'staging', 'production').</td>
    </tr>
    <tr>
      <td><code>logLevel</code></td>
      <td><code>'silent' | 'error' | 'warn' | 'info' | 'debug'</code></td>
      <td><code>'info'</code></td>
      <td>The logging level for the Tusk Drift SDK.</td>
    </tr>
    <tr>
      <td><code>samplingRate</code></td>
      <td><code>number</code></td>
      <td><code>1.0</code></td>
      <td>Override the base sampling rate (0.0 - 1.0) for recording. Takes precedence over <code>TUSK_RECORDING_SAMPLING_RATE</code> and config file base-rate settings. Does not change <code>recording.sampling.mode</code>.</td>
    </tr>
  </tbody>
</table>

**Update your package.json scripts**:

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:record": "TUSK_DRIFT_MODE=RECORD next dev"
  }
}
```

## Step 3: Configure Sampling Rate

Sampling controls what percentage of inbound requests are recorded in `RECORD` mode.

Tusk Drift supports two sampling modes in `.tusk/config.yaml`:

- `fixed`: record requests at a constant base rate.
- `adaptive`: start from a base rate and automatically shed load when queue pressure, export failures, export timeouts, event loop lag, or memory pressure indicate the SDK should back off. In severe conditions the SDK can temporarily pause recording entirely.

Sampling configuration is resolved in two layers:

1. **Base rate precedence** (highest to lowest):
   - `TuskDrift.initialize({ samplingRate: ... })`
   - `TUSK_RECORDING_SAMPLING_RATE`
   - legacy alias `TUSK_SAMPLING_RATE`
   - `.tusk/config.yaml` `recording.sampling.base_rate`
   - `.tusk/config.yaml` legacy `recording.sampling_rate`
   - default base rate `1.0`
2. **Mode and minimum rate**:
   - `recording.sampling.mode` comes from `.tusk/config.yaml` and defaults to `fixed`
   - `recording.sampling.min_rate` is only used in `adaptive` mode and defaults to `0.001` when omitted

> **Note:** Requests before `TuskDrift.markAppAsReady()` are always recorded. Sampling applies to normal inbound traffic after startup.

### Method 1: Init Parameter

Set the base sampling rate directly in your initialization code:

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { TuskDrift } = await import("@use-tusk/drift-node-sdk");

    TuskDrift.initialize({
      apiKey: process.env.TUSK_API_KEY,
      env: process.env.NODE_ENV,
      samplingRate: 0.1, // 10% of requests
    });

    TuskDrift.markAppAsReady();
  }
}
```

### Method 2: Environment Variable

Set the `TUSK_RECORDING_SAMPLING_RATE` environment variable to override the base sampling rate:

```bash
# Development - record everything
TUSK_RECORDING_SAMPLING_RATE=1.0 npm run dev

# Production - sample 10% of requests
TUSK_RECORDING_SAMPLING_RATE=0.1 npm start
```

`TUSK_SAMPLING_RATE` is still supported as a backward-compatible alias, but new setups should prefer `TUSK_RECORDING_SAMPLING_RATE`.

### Method 3: Configuration File

Use the nested `recording.sampling` config to choose `fixed` vs `adaptive` mode and set the base/minimum rates.

```yaml
# ... existing configuration ...

recording:
  sampling:
    mode: fixed
    base_rate: 0.1
  export_spans: true
  enable_env_var_recording: true
```

**Adaptive sampling example:**

```yaml
# ... existing configuration ...

recording:
  sampling:
    mode: adaptive
    base_rate: 0.25
    min_rate: 0.01
  export_spans: true
```

**Legacy config still supported:**

```yaml
recording:
  sampling_rate: 0.1
```

### Additional Recording Configuration Options

<table>
  <thead>
    <tr>
      <th>Option</th>
      <th>Type</th>
      <th>Default</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>sampling.mode</code></td>
      <td><code>"fixed" | "adaptive"</code></td>
      <td><code>"fixed"</code></td>
      <td>Selects constant sampling or adaptive load shedding.</td>
    </tr>
    <tr>
      <td><code>sampling.base_rate</code></td>
      <td><code>number</code></td>
      <td><code>1.0</code></td>
      <td>The base sampling rate (0.0 - 1.0). This is the preferred config key and can be overridden by <code>TUSK_RECORDING_SAMPLING_RATE</code> or the <code>samplingRate</code> init parameter.</td>
    </tr>
    <tr>
      <td><code>sampling.min_rate</code></td>
      <td><code>number</code></td>
      <td><code>0.001</code> in <code>adaptive</code> mode</td>
      <td>The minimum steady-state sampling rate for adaptive mode. In critical conditions the SDK can still temporarily pause recording.</td>
    </tr>
    <tr>
      <td><code>sampling.log_transitions</code></td>
      <td><code>boolean</code></td>
      <td><code>true</code></td>
      <td>Controls whether adaptive sampling emits <code>Adaptive sampling updated (...)</code> transition logs. Can be overridden by <code>TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS</code>.</td>
    </tr>
    <tr>
      <td><code>sampling_rate</code></td>
      <td><code>number</code></td>
      <td><code>None</code></td>
      <td>Legacy fallback for the base sampling rate. Still supported for backward compatibility, but <code>recording.sampling.base_rate</code> is preferred.</td>
    </tr>
    <tr>
      <td><code>export_spans</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Whether to export spans to the Tusk backend. If false, spans are only saved locally in <code>.tusk/traces</code>.</td>
    </tr>
    <tr>
      <td><code>enable_env_var_recording</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Whether to record and replay environment variables. Recommended for accurate replay behavior if your app's logic depends on environment variables.</td>
    </tr>
  </tbody>
</table>

## Troubleshooting

### Instrumentation not working

If your packages aren't being instrumented:

1. **Check file location**: Ensure `instrumentation.ts` is at the project root (same level as `next.config.js`), not in the `app` or `pages` directory.

2. **Check runtime guard**: Make sure you have the `NEXT_RUNTIME === 'nodejs'` check in your `register()` function.

3. **Enable debug logging**: Set `debug: true` in your `withTuskDrift` options to see what's being configured.
