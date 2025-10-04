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
