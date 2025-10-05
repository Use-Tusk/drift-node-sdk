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

- **Unit Tests**: Add comprehensive unit tests for new instrumentations
  - _TODO: Expand unit testing guidelines once we establish better practices_

- **Integration Tests**: Add integration tests for new instrumentations
  - _TODO: Expand integration testing guidelines once we establish better practices_

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

## Getting Help

If you need help with development:

- Check existing instrumentations for patterns
- Ask questions in pull requests or issues

Thank you for contributing to Tusk Drift SDK!
