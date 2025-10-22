# Initialization

## Prerequisites

Before setting up the SDK, ensure you have:

- Completed the [CLI wizard](https://github.com/Use-Tusk/tusk-drift-cli?tab=readme-ov-file#quick-start)
- Obtained an API key from the [Tusk Drift dashboard](https://usetusk.ai/app/settings/api-keys) (only required if using Tusk Cloud)

> **📦 Using Next.js?** Next.js applications require a different initialization process.
> **[Go to the Next.js Initialization Guide →](./nextjs-initialization.md)**

For **standard Node.js applications** (Express, Fastify, plain Node.js, etc.), follow these steps in order to properly initialize the Tusk Drift SDK:

## 1. Create SDK Initialization File

Create a separate file (e.g. `tuskDriftInit.ts`) to initialize the Tusk Drift SDK. This ensures the SDK is initialized as early as possible before any other modules are loaded.

**IMPORTANT**: Ensure that `TuskDrift` is initialized before any other telemetry providers (e.g. OpenTelemetry, Sentry, etc.). If not, your existing telemetry may not work properly.

### For CommonJS Applications

```typescript
// tuskDriftInit.ts
import { TuskDrift } from "@use-tusk/drift-node-sdk";

// Initialize SDK immediately
TuskDrift.initialize({
  apiKey: process.env.TUSK_DRIFT_API_KEY,
  env: process.env.NODE_ENV,
});

export { TuskDrift };
```

### For ESM Applications

ESM applications require additional setup to properly intercept module imports:

```typescript
// tuskDriftInit.ts
import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Register the ESM loader
// This enables interception of ESM module imports
register("@use-tusk/drift-node-sdk/hook.mjs", pathToFileURL("./"));

import { TuskDrift } from "@use-tusk/drift-node-sdk";

// Initialize SDK immediately
TuskDrift.initialize({
  apiKey: process.env.TUSK_DRIFT_API_KEY,
  env: process.env.NODE_ENV,
});

export { TuskDrift };
```

**Why the ESM loader is needed**: ESM imports are statically analyzed and hoisted, meaning all imports are resolved before any code runs. The `register()` call sets up Node.js loader hooks that intercept module imports, allowing the SDK to instrument packages like `postgres`, `http`, etc. Without this, the SDK cannot patch ESM modules.

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
  </tbody>
</table>

## 2. Import SDK at Application Entry Point

### For CommonJS Applications

In your main server file (e.g., `server.ts`, `index.ts`, `app.ts`), require the initialized SDK **at the very top**, before any other requires:

```typescript
// server.ts
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

**Why `--import` is required for ESM**: In ESM, all `import` statements are hoisted and evaluated before any code runs, making it impossible to control import order within a file. The `--import` flag ensures the SDK initialization (including loader registration) happens in a separate phase before your application code loads, guaranteeing proper module interception.

### 3. Update Configuration File

Update the configuration file `.tusk/config.yaml` to include a `recording` section. Example `recording` configuration:

```yaml
# ... existing configuration ...

recording:
  sampling_rate: 0.1
  export_spans: true
  enable_env_var_recording: true
```

#### Configuration Options

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
      <td>The sampling rate (0.0 - 1.0). 1.0 means 100% of requests are recorded, 0.0 means 0% of requests are recorded.</td>
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
// server.ts
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
