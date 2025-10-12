# Contributing to Tusk Drift SDK

Thank you for your interest in contributing to the Tusk Drift SDK! This guide will help you set up your development environment and understand our development workflow.

For general information about using the SDK in your projects, please see the [README](./README.md).

## Setting Up the Development Environment

### Prerequisites

- Node.js (use the version specified in `.nvmrc`)

### Setup Steps

1. **Use the correct Node version**:

   ```bash
   nvm use
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Build the project**:

   ```bash
   npm run build
   ```

   For development with automatic rebuilds:

   ```bash
   npm run build:watch
   ```

## Using Your Local SDK in Services

To test your local changes in a service, import the SDK by pointing to the local directory:

```typescript
import { TuskDrift } from "../../../tusk-drift-container/tusk-drift-sdk";
```

Adjust the path based on your directory structure relative to the service you're working on.

## Adding or Updating Instrumentations

### Instrumentation Structure

All instrumentations follow a consistent structure and extend base classes:

- **Base Classes**: Extend `TdInstrumentationBase` and use `TdInstrumentationNodeModule` for module patching
- **Utilities**: Use shared utilities like:
  - `SpanUtils`: For OpenTelemetry span creation and management
  - `modeUtils`: For handling record/replay mode logic (`handleRecordMode`, `handleReplayMode`)
  - `mockResponseUtils`: For generating mock responses during replay
  - Additional utilities in `src/instrumentation/core/utils/` and `src/core/utils/`

### Module Interception: CommonJS vs ESM

The SDK supports both CommonJS and ESM module systems, using different interception mechanisms for each:

#### CommonJS Module Interception

- **Package**: `require-in-the-middle`
- **How it works**: Hooks into `Module.prototype.require` globally
- **When it activates**: When `require()` is called
- **Setup**: Automatic - no special flags needed
- **Use case**: Works for all CommonJS modules

#### ESM Module Interception

- **Package**: `import-in-the-middle`, created by [Datadog](https://opensource.datadoghq.com/projects/node/#the-import-in-the-middle-library)
- **How it works**: Uses Node.js loader hooks to intercept imports before they're cached
- **When it activates**: During module resolution/loading phase
- **Setup**: Requires `--import` flag or `module.register()` call
- **Use case**: Required for ESM modules
- **Loader file**: `hook.mjs` - re-exports loader hooks from `import-in-the-middle`

**Key difference**: CommonJS's `require()` is synchronous and sequential, so you can control order. ESM's `import` is hoisted and parallel, requiring loader hooks to intercept before evaluation.

### When Does an Instrumentation Need Special ESM Handling?

Most instrumentations work the same for both CommonJS and ESM, but some need special handling:

#### ✅ Needs Special ESM Handling

An instrumentation needs custom ESM support if it:

1. **Wraps a default function export** (e.g., `postgres` package)
2. **Wraps the module itself as a function** (not a method on an object)

**Why**: In ESM, default exports are in the `.default` property of the namespace object, not directly accessible.

**Example** (postgres):
- **CommonJS**: `const postgres = require('postgres')` → `postgres` IS the function
- **ESM**: `import postgres from 'postgres'` → `postgres.default` IS the function

**Detection**:
```typescript
const isESM = (moduleExports as any)[Symbol.toStringTag] === 'Module';
```

**Solution**:
```typescript
if (isESM) {
  // Wrap the .default property
  this._wrap(moduleExports, 'default', wrapper);
} else {
  // Create wrapped function and return it
  const wrappedFn = function(...args) { /* ... */ };
  // Copy all properties...
  return wrappedFn;
}
```

### Implementation Pattern

Each instrumentation typically:

1. Extends `TdInstrumentationBase`
2. Uses `TdInstrumentationNodeModule` to patch target modules
3. Implements record mode to capture input/output values
4. Implements replay mode to return mocked responses
5. Uses `SpanUtils.createAndExecuteSpan()` to create proper tracing spans
6. Handles both client and server operations where applicable

### Best Practices

#### Documentation

- **Include READMEs**: Every new instrumentation must have a README explaining:
  - What the instrumentation does
  - Any unique implementation details
  - Configuration options
  - Known limitations or edge cases

- **Update existing READMEs**: When updating an instrumentation, ensure the README reflects all changes

#### Testing

We have unit tests and integration tests with [ava](https://github.com/avajs/ava).
Some integration tests (pg, mongo, etc.) require external dependencies.
A docker compose is provided for you to get these dependencies up easily:
```
docker compose -f docker-compose.test.yml up -d --wait
```

After it's done setting up you can run `npm test` as usual.
You can leave it up, and tests should clean up after themselves so that we can
leave these services up during development without restarting all the time.
To bring them down, run
```
docker compose -f docker-compose.test.yml down
```

Some important notes during testing, especially integration tests:
- The tusk sdk needs to be initialized before importing anything that is going
  to be patched.
- Since the TuskDrift object is a singleton, each integration test (or at least
  those that have different TuskDrift configs) needs to be in its own file.
- Since we use `require-in-the-middle` for patching, not all advanced test
  framework features are available. Notably, anything replacing `require` will
  certainly not work.
- Know the diff between `devDependency` and `dependency` -- most libraries that
  you need for testing (axios, express) should go in `devDependency`.

#### E2E Testing

The SDK includes comprehensive end-to-end (E2E) tests that verify instrumentations work correctly in real Docker environments. These tests record actual network traffic and replay it to ensure consistent behavior.

**Quick Overview:**
- E2E tests are located in `src/instrumentation/libraries/{library}/e2e-tests/`
- Each test runs in a Docker container with the full SDK
- Tests record network interactions, then replay them to verify correctness
- Use these tests when debugging instrumentation issues or adding new features

**For detailed instructions on running and debugging E2E tests, see the [E2E Testing Guide](./E2E_TESTING_GUIDE.md).**


#### Code Quality

- Follow existing code patterns and conventions
- Use TypeScript types whenever possible
- Wrap all record mode TuskDrift specific logic in a try/catch block

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes following the patterns above
3. Add/update tests as needed
4. Add/update documentation
5. Test your changes locally
6. Submit a pull request

## SDK Architecture: Socket Communication

The SDK communicates with the Tusk CLI using socket connections, supporting both Unix sockets and TCP sockets depending on the environment.

### Connection Types

#### Unix Socket (Default)
- **Use case**: Local development and non-containerized environments
- **How it works**: SDK connects to the CLI via a Unix domain socket file
- **Environment variable**: `TUSK_MOCK_SOCKET` (optional, defaults to `/tmp/tusk-connect.sock`)
- **Benefits**: Lower overhead, faster communication for same-machine connections

#### TCP Socket (Docker/Remote)
- **Use case**: Dockerized applications where Unix sockets can't be shared
- **How it works**: SDK connects to the CLI via TCP (host:port)
- **Environment variables**:
  - `TUSK_MOCK_HOST` - CLI host address (e.g., `host.docker.internal`)
  - `TUSK_MOCK_PORT` - CLI port number (e.g., `9001`)
- **Benefits**: Works across container boundaries and remote connections

## Getting Help

If you need help with development:

- Check existing instrumentations for patterns
- Ask questions in pull requests or issues

Thank you for contributing to Tusk Drift SDK!
