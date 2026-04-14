# Initialization

## Prerequisites

Before setting up the SDK, ensure you have:

- Completed the [CLI wizard](https://github.com/Use-Tusk/tusk-cli/blob/main/docs/drift/README.md#quick-start)
- Obtained an API key from the [Tusk Drift dashboard](https://usetusk.ai/app/settings/api-keys) (only required if using Tusk Cloud)

> **📦 Using Next.js?** Next.js applications require a different initialization process.
> **[Go to the Next.js Initialization Guide →](./nextjs-initialization.md)**

For **standard Node.js applications** (Express, Fastify, plain Node.js, etc.), follow these steps in order to properly initialize the Tusk Drift SDK:

## 1. Create SDK Initialization File

Create a separate file (e.g. `tuskDriftInit.ts` or `tuskDriftInit.js`) to initialize the Tusk Drift SDK. This ensures the SDK is initialized as early as possible before any other modules are loaded.

**Note:** The code examples in this guide use ES module `import`/`export` syntax. If your JavaScript project uses CommonJS, adapt the examples to use `require()`/`module.exports` instead.

**IMPORTANT**: Ensure that `TuskDrift` is initialized before any other telemetry providers (e.g. OpenTelemetry, Sentry, etc.). If not, your existing telemetry may not work properly.

The initialization file is the same for both CommonJS and ESM applications. The SDK automatically registers ESM loader hooks when running in an ESM environment (Node.js >= 18.19.0 or >= 20.6.0).

```typescript
// tuskDriftInit.ts or tuskDriftInit.js
import { TuskDrift } from "@use-tusk/drift-node-sdk";

// Initialize SDK immediately
TuskDrift.initialize({
  apiKey: process.env.TUSK_API_KEY,
  env: process.env.NODE_ENV,
});

export { TuskDrift };
```

> **Note:** ESM applications still require the `--import` flag when starting Node.js. See [Step 2](#2-import-sdk-at-application-entry-point) for details.

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
      <td>Your Tusk Drift API key.</td>
    </tr>
    <tr>
      <td><code>env</code></td>
      <td><code>string</code></td>
      <td><code>process.env.NODE_ENV</code></td>
      <td>The environment name.</td>
    </tr>
    <tr>
      <td><code>logLevel</code></td>
      <td><code>'silent' | 'error' | 'warn' | 'info' | 'debug'</code></td>
      <td><code>'info'</code></td>
      <td>The logging level.</td>
    </tr>
    <tr>
      <td><code>samplingRate</code></td>
      <td><code>number</code></td>
      <td><code>1.0</code></td>
      <td>Override the base sampling rate (0.0 - 1.0) for recording. Takes precedence over <code>TUSK_RECORDING_SAMPLING_RATE</code> and config file base-rate settings. Does not change <code>recording.sampling.mode</code>.</td>
    </tr>
    <tr>
      <td><code>registerEsmLoaderHooks</code></td>
      <td><code>boolean</code></td>
      <td><code>true</code></td>
      <td>Automatically register ESM loader hooks for module interception. Set to <code>false</code> to disable if <code>import-in-the-middle</code> causes issues with certain packages. See <a href="#troubleshooting-esm">Troubleshooting ESM</a>.</td>
    </tr>
  </tbody>
</table>

> **See also:** [Environment Variables guide](./environment-variables.md) for detailed information about environment variables.

## 2. Import SDK at Application Entry Point

### Determining Your Module System

You need to know whether your application uses **CommonJS** or **ESM** (ECMAScript Modules) because the entry point setup differs.

**If your application uses `require()`:**

- Your application is CommonJS

**If your application uses `import` statements:**

- This could be either CommonJS or ESM, depending on your build configuration
- Check your compiled output (if you compile to a directory like `dist/`):
  - If the compiled code contains `require()` statements → CommonJS application
  - If the compiled code contains `import` statements → ESM application
- If you don't compile your code (running source files directly):
  - It is an ESM application

### For CommonJS Applications

In your main server file (e.g., `server.ts`, `index.ts`, `app.ts`), require the initialized SDK **at the very top**, before any other requires:

```typescript
// e.g. server.ts
import { TuskDrift } from "./tuskDriftInit"; // MUST be the first import

// ... other imports ...

// Your application setup...
```

> **IMPORTANT**: Ensure NO require calls are made before requiring the SDK initialization file. This guarantees proper instrumentation of all dependencies.

### For ESM Applications

For ESM applications, you **cannot** control import order within your application code because all imports are hoisted. Instead, use the `--import` flag:

**Update your package.json scripts**:

```json
{
  "scripts": {
    "dev": "node --import ./dist/tuskDriftInit.js dist/server.js",
    "dev:record": "TUSK_DRIFT_MODE=RECORD node --import ./dist/tuskDriftInit.js dist/server.js"
  }
}
```

**Why `--import` is required for ESM**: In ESM, all `import` statements are hoisted and evaluated before any code runs, making it impossible to control import order within a file. The `--import` flag ensures the SDK initialization happens in a separate phase before your application code loads, guaranteeing proper module interception.

### 3. Configure Sampling Rate

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

#### Method 1: Init Parameter (Programmatic Base-Rate Override)

Set the base sampling rate directly in your initialization code:

```typescript
TuskDrift.initialize({
  apiKey: process.env.TUSK_API_KEY,
  env: process.env.NODE_ENV,
  samplingRate: 0.1, // 10% of requests
});
```

#### Method 2: Environment Variable

Set the `TUSK_RECORDING_SAMPLING_RATE` environment variable to override the base sampling rate:

```bash
# Development - record everything
TUSK_RECORDING_SAMPLING_RATE=1.0 npm run dev

# Production - sample 10% of requests
TUSK_RECORDING_SAMPLING_RATE=0.1 npm start
```

`TUSK_SAMPLING_RATE` is still supported as a backward-compatible alias, but new setups should prefer `TUSK_RECORDING_SAMPLING_RATE`.

#### Method 3: Configuration File

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

#### Adaptive Sampling Logs

When adaptive mode changes state or multiplier, the SDK logs an `Adaptive sampling updated (...)` line at `info` level.

- `state`: controller state such as `healthy`, `warm`, `hot`, or `critical_pause`
- `multiplier`: factor applied to `base_rate`
- `effectiveRate`: current root-request recording rate after shedding
- `pressure`: highest normalized pressure signal (`0..1`) driving the update
- `queueFill`: smoothed export-queue usage ratio; values near `1.0` mean the exporter is falling behind
- `eventLoopLagP95Ms`: Node-only p95 event loop lag signal
- `memoryPressureRatio`: current memory usage relative to its detected limit, when available

Set `recording.sampling.log_transitions: false` in `.tusk/config.yaml`, or set `TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS=false`, if you want to suppress these transition logs without changing the overall SDK log level. Raising `logLevel` to `warn` or higher will also hide them.

#### Additional Recording Configuration Options

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
      <td>Whether to export spans to Tusk backend or local files (<code>.tusk/traces</code>). If false, spans are only exported to local files.</td>
    </tr>
    <tr>
      <td><code>enable_env_var_recording</code></td>
      <td><code>boolean</code></td>
      <td><code>false</code></td>
      <td>Whether to enable environment variable recording and replaying. Recommended if your application's business logic depends on environment variables, as this ensures the most accurate replay behavior.</td>
    </tr>
  </tbody>
</table>

## 4. Mark App as Ready

Once your application has completed initialization (database connections, middleware setup, etc.), mark it as ready:

```typescript
// e.g. server.ts
import { TuskDrift } from "./tuskDriftInit";

// ... other imports ...

const app = express();

// Your application setup...

app.listen(8000, () => {
  // Mark app as ready for recording/replay
  TuskDrift.markAppAsReady();
  console.log("Server started and ready for Tusk Drift");
});
```

## Troubleshooting ESM

The SDK automatically registers ESM loader hooks via [`import-in-the-middle`](https://www.npmjs.com/package/import-in-the-middle) to intercept ES module imports. Only modules that the SDK instruments have their exports wrapped with getter/setter proxies -- unrelated modules are left untouched.

In rare cases, the wrapping can cause issues with instrumented packages:

- **Non-standard export patterns**: Some packages use dynamic `export *` re-exports or conditional exports that the wrapper's static analysis cannot parse, resulting in runtime syntax errors.
- **Native or WASM bindings**: Packages with native addons loaded via ESM can conflict with the proxy wrapping mechanism.
- **Bundler-generated ESM**: Code that was bundled (e.g., by esbuild or webpack) into ESM sometimes produces patterns the wrapper does not handle correctly.
- **Circular ESM imports**: The proxy layer can interact badly with circular ESM import graphs in some edge cases.

If you encounter errors like:

```text
SyntaxError: The requested module '...' does not provide an export named '...'
(node:1234) Error: 'import-in-the-middle' failed to wrap 'file://../../path/to/file.js'
```

You can disable the automatic ESM hook registration:

```typescript
TuskDrift.initialize({
  apiKey: process.env.TUSK_API_KEY,
  env: process.env.NODE_ENV,
  registerEsmLoaderHooks: false,
});
```

> **Note:** Disabling ESM loader hooks means the SDK will only be able to instrument packages loaded via CommonJS (`require()`). Packages loaded purely through ESM `import` statements will not be intercepted. Node.js built-in modules (like `http`, `https`, `net`) are always loaded through the CJS path internally, so they will continue to be instrumented regardless of this setting.
