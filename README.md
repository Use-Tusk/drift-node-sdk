<p align="center">
  <img src="images/tusk-banner.png" alt="Tusk Drift Banner">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@use-tusk/drift-node-sdk"><img src="https://img.shields.io/npm/v/@use-tusk/drift-node-sdk" alt="npm version"></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache 2.0"></a>
  <a href="https://github.com/Use-Tusk/drift-node-sdk/commits/main/"><img src="https://img.shields.io/github/last-commit/Use-Tusk/drift-node-sdk" alt="GitHub last commit"></a>
</p>

The Node.js Tusk Drift SDK enables fast and deterministic API testing by capturing and replaying API calls made to/from your service. Automatically record real-world API calls, then replay them as tests using the [Tusk CLI](https://github.com/Use-Tusk/tusk-drift-cli) to find regressions. During replay, all outbound requests are intercepted with recorded data to ensure consistent behavior without side-effects.

## Documentation

For comprehensive guides and API reference, visit our [full documentation](https://docs.usetusk.ai/automated-tests/installation#setup).

## Requirements

Tusk Drift currently supports the following packages and versions:

- **HTTP/HTTPS**: All versions (Node.js built-in)
- **PG**: `pg@8.x`, `pg-pool@2.x-3.x`
- **Postgres**: `postgres@3.x`
- **MySQL**: `mysql2@3.x`
- **JSON Web Tokens**: `jsonwebtoken@5.x-9.x`
- **JWKS RSA**: `jwks-rsa@1.x-3.x`
- **GraphQL**: `graphql@15.x-16.x`

If you're using packages or versions not listed above, please create an issue with the package + version you'd like an instrumentation for.

## Installation

### Step 1: CLI Setup

First, install and configure the Tusk Drift CLI by following our [CLI installation guide](https://github.com/Use-Tusk/tusk-drift-cli?tab=readme-ov-file#install).

The wizard will eventually direct you back here when it's time to set up the SDK.

### Step 2: SDK Installation

After completing the CLI wizard, install the SDK:

```bash
npm install @use-tusk/drift-node-sdk
```

## Initialization

### Prerequisites

Before setting up the SDK, ensure you have:

- Completed the [CLI wizard](https://github.com/Use-Tusk/tusk-drift-cli?tab=readme-ov-file#quick-start)
- Obtained an API key from the [Tusk Drift dashboard](https://usetusk.ai/app/settings/api-keys) (only required if using Tusk Cloud)

Follow these steps in order to properly initialize the Tusk Drift SDK:

### 1. Create SDK Initialization File

Create a separate file (e.g. `tuskDriftInit.ts`) to initialize the Tusk Drift SDK. This ensures the SDK is initialized as early as possible before any other modules are loaded.

**IMPORTANT**: Ensure that `TuskDrift` is initialized before any other telemetry providers (e.g. OpenTelemetry, Sentry, etc.). If not, your existing telemetry may not work properly.

#### For CommonJS Applications

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

#### For ESM Applications

ESM applications require additional setup to properly intercept module imports:

```typescript
// tuskDriftInit.ts
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the ESM loader
// This enables interception of ESM module imports
register('@use-tusk/drift-node-sdk/hook.mjs', pathToFileURL('./'));

import { TuskDrift } from "@use-tusk/drift-node-sdk";

// Initialize SDK immediately
TuskDrift.initialize({
  apiKey: process.env.TUSK_DRIFT_API_KEY,
  env: process.env.NODE_ENV,
});

export { TuskDrift };
```

**Why the ESM loader is needed**: ESM imports are statically analyzed and hoisted, meaning all imports are resolved before any code runs. The `register()` call sets up Node.js loader hooks that intercept module imports, allowing the SDK to instrument packages like `postgres`, `http`, etc. Without this, the SDK cannot patch ESM modules.

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

### 2. Import SDK at Application Entry Point

#### For CommonJS Applications

In your main server file (e.g., `server.ts`, `index.ts`, `app.ts`), require the initialized SDK **at the very top**, before any other requires:

```typescript
// server.ts
import { TuskDrift } from "./tuskDriftInit"; // MUST be the first import

// ... other imports ...

// Your application setup...
```

> **IMPORTANT**: Ensure NO require calls are made before requiring the SDK initialization file. This guarantees proper instrumentation of all dependencies.

#### For ESM Applications

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

### 4. Mark App as Ready

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

## Run Your First Test

Let's walk through recording and replaying your first trace:

### Step 1: Set sampling rate to 1.0

Set the `sampling_rate` in `.tusk/config.yaml` to 1.0 to ensure that all requests are recorded.

### Step 2: Start server in record mode

Run your server in record mode using the `TUSK_DRIFT_MODE` environment variable:

```bash
TUSK_DRIFT_MODE=RECORD node server.js
```

You should see logs indicating Tusk Drift is active:

```
[TuskDrift] SDK initialized in RECORD mode
[TuskDrift] App marked as ready
```

### Step 3: Generate Traffic

Make a request to a simple endpoint that includes some database and/or network calls:

```bash
curl http://localhost:8000/api/test/weather
```

### Step 4: Stop Recording

Wait for a few seconds and then stop your server with `Ctrl+C`. This will give time for traces to be exported.

### Step 5: List Recorded Traces

In your project directory, list the recorded traces:

```bash
tusk list
```

You should see output similar to:

<img src="images/tusk-list-output.png">

Press `ESC` to exit the list view.

Need to install the Tusk CLI? See [CLI installation guide](https://github.com/Use-Tusk/tusk-drift-cli?tab=readme-ov-file#install).

### Step 6: Replay the Trace

Replay the recorded test:

```bash
tusk run
```

You should see output similar to:

<img src="images/tusk-run-output.png">

**Success!** You've recorded and replayed your first trace.

## Troubleshooting

### Common Issues

#### No traces being recorded

1. **Check sampling rate**: Ensure `sampling_rate` in `.tusk/config.yaml` is 1.0
2. **Verify app readiness**: Make sure you're calling `TuskDrift.markAppAsReady()`
3. **Use debug mode in SDK**: Add `logLevel: 'debug'` to the initialization parameters

#### Existing telemetry not working

Ensure that `TuskDrift.initialize()` is called before any other telemetry providers (e.g. OpenTelemetry, Sentry, etc.).

#### Replay failures

1. **Enable service and CLI logs**:

   ```bash
   tusk run --debug
   ```

   Logs will be written to `.tusk/logs/`

2. **Test with simple endpoint**: Start with endpoints that only return static data

3. **Check dependencies**: Verify you're using supported package versions

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
