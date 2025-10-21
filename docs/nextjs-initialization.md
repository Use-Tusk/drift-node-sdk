# Next.js Initialization (Beta)

This guide explains how to set up Tusk Drift in your Next.js application.

## Step 1: Configure Next.js with `withTuskDrift`

Wrap your Next.js configuration with the `withTuskDrift` function in your `next.config.js` or `next.config.ts` file:

### Basic Configuration

```javascript
// next.config.js
const { withTuskDrift } = require("@use-tusk/drift-node-sdk");

module.exports = withTuskDrift({
  // Your Next.js config
});
```

### With Debug Logging for Next.js Integration

```javascript
// next.config.js
const { withTuskDrift } = require("@use-tusk/drift-node-sdk");

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

Create an `instrumentation.ts` (or `.js`) file at the **root of your Next.js project**, at the same level as `next.config.js`:

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { TuskDrift } = await import("@use-tusk/drift-node-sdk");

    TuskDrift.initialize({
      apiKey: process.env.TUSK_DRIFT_API_KEY,
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

## Step 3: Update Configuration File

Update the `.tusk/config.yaml` file in your project root to include recording configuration:

```yaml
# ... existing configuration ...

recording:
  sampling_rate: 0.1
  export_spans: true
  enable_env_var_recording: true
```

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
      <td><code>sampling_rate</code></td>
      <td><code>number</code></td>
      <td><code>1.0</code></td>
      <td>The sampling rate (0.0 - 1.0). 1.0 means 100% of requests are recorded, 0.0 means no requests are recorded.</td>
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
