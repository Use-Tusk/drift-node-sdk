# Tusk Drift SDK Integration Tests

## Overview

**NOTE:** Currently, only the HTTP and fetch instrumentation integration tests are working. The PG, MongoDB, GraphQL, and JWT integration tests exist but are not passing. This is because we've made updates to the mock matcher in the CLI, and rather than keeping the SDK mock matcher and CLI mock matcher in sync, we're waiting for the CLI to be published so we can use the CLI directly in the integration tests instead.

One of the bigger bets we are making with Tusk Drift is that AI will be able to help build/maintain these instrumentations. In order to do this, we must give AI tools an organized structure for writing + running integration tests for these instrumentations.

This document outlines the integration test system for the Tusk Drift SDK. This validates our SDK's instrumentation across different modules + versions by running isolated tests in Docker containers with testcontainers for external dependencies.

Key features:

- **Co-located tests**: Integration tests live inside each instrumentation folder (`src/instrumentation/libraries/{module}/integration-tests/`) so they're not forgotten when adding new instrumentations
- **Testcontainers**: Uses [node.testcontainers.org](https://node.testcontainers.org/) for external services (PostgreSQL, MongoDB, etc.) instead of docker-compose
- **Record/Replay**: Tests run in both record mode (capturing traces) and replay mode (verifying consistent behavior)
- **Isolated environments**: Each test runs in its own Docker container with proper cleanup
- **Health checks**: All servers must implement `/health` endpoint that returns success when `tuskDrift.isAppReady()` is true

## Architecture Overview

```
src/instrumentation/libraries/
├── pg/
│   ├── Instrumentation.ts           # The actual instrumentation
│   └── integration-tests/           # Integration tests for pg
│       ├── Dockerfile
│       ├── package.json
│       ├── server.js               # Test server with endpoints
│       └── test-config.json        # Endpoints to test
├── mongodb/
│   ├── Instrumentation.ts
│   └── integration-tests/
│       ├── Dockerfile
│       ├── package.json
│       ├── server.js
│       └── test-config.json
├── fetch/                          # No external services needed
│   ├── Instrumentation.ts
│   └── integration-tests/
│       ├── Dockerfile
│       ├── package.json
│       ├── server.js
│       └── test-config.json
└── ...

integration-test-runner/             # Shared test infrastructure
├── test-runner.ts                  # Core test runner logic
├── run-instrumentation-tests.sh   # Run specific module tests
└── run-all-instrumentation-tests.sh # Run all tests
```

## Test Structure

### Test Configuration (`test-config.json`)

Each integration test defines its endpoints and metadata:

```json
{
  "module": "pg",
  "version": "8.11.5",
  "endpoints": [
    {
      "path": "/test/basic-query",
      "method": "GET"
    },
    {
      "path": "/test/parameterized-query",
      "method": "POST",
      "body": {
        "userId": 1
      }
    }
  ]
}
```

### Server Implementation (`server.js`)

Test servers follow this pattern:

```javascript
const { TuskDrift } = require("tusk-drift-sdk");
const tuskDrift = TuskDrift.getInstance();

tuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

const express = require("express");
const app = express();

// For modules requiring external services
const { PostgreSqlContainer } = require("@testcontainers/postgresql");

async function initializeDatabase() {
  // Start PostgreSQL container using testcontainers
  container = await new PostgreSqlContainer("postgres:13")
    .withDatabase("testdb")
    .withUsername("testuser")
    .withPassword("testpass")
    .withExposedPorts(5432)
    .start();

  // Set up client with container connection details
  const dbConfig = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
  };

  // Initialize your database client...
}

// Health check endpoint (REQUIRED)
app.get("/health", (req, res) => {
  if (tuskDrift.isAppReady()) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "App not ready" });
  }
});

// Test endpoints
app.get("/test/basic-query", async (req, res) => {
  // Your test logic here
});

app.listen(3000, async () => {
  await initializeDatabase();
  tuskDrift.markAppAsReady(); // IMPORTANT: Mark ready after initialization
});
```

### Package Dependencies (`package.json`)

For modules with external dependencies:

```json
{
  "name": "tusk-drift-pg-integration-test",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^11.5.1"
  }
}
```

For self-contained modules:

```json
{
  "name": "tusk-drift-fetch-integration-test",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

### Dockerfile

All integration tests use the same Dockerfile pattern:

```dockerfile
FROM node:20-alpine
WORKDIR /app

# Install Docker CLI for testcontainers
RUN apk add --no-cache docker-cli

# Copy package.json first for better caching
COPY package.json .
RUN npm install

# Copy the test server
COPY server.js .

EXPOSE 3000

# Create tmp directory for traces
RUN mkdir -p /app/tmp

CMD ["node", "server.js"]
```

## Test Runner

The test runner (`test-runner.ts`) handles:

1. **Building Docker containers** for each test
2. **Volume mounting** the SDK code and trace directory
3. **Running in record mode** - hitting all endpoints and storing traces
4. **Running in replay mode** - hitting endpoints again and comparing results
5. **Cleanup** - stopping containers and cleaning up resources

### Key Features

- **Automatic trace comparison**: Compares recorded traces with replay traces
- **Health check polling**: Waits for `/health` to return 200 before running tests
- **Parallel execution**: Can run multiple tests simultaneously
- **Detailed reporting**: Shows pass/fail status for each endpoint

## Running Tests

### Single Module

```bash
# Run tests for a specific module
./integration-test-runner/run-instrumentation-tests.sh src/instrumentation/libraries/pg/integration-tests
```

### All Modules

```bash
# Run all integration tests
./integration-test-runner/run-all-instrumentation-tests.sh

# Run tests for specific library only
./integration-test-runner/run-all-instrumentation-tests.sh pg
```

### Test Flow

1. **Record Mode**:
   - Builds Docker container
   - Starts server with `TUSK_DRIFT_MODE=RECORD`
   - Waits for health check
   - Hits all endpoints defined in `test-config.json`
   - Stores traces in `tmp/traces/`
   - Waits for 4 seconds for spans to be exported
   - Stops container

2. **Replay Mode**:
   - Starts server with `TUSK_DRIFT_MODE=REPLAY`
   - Reads recorded traces
   - Hits same endpoints with trace IDs
   - Compares responses with recorded data
   - Reports differences as test failures

## Adding New Integration Tests

### For Modules with External Dependencies

1. **Create integration test directory**:

   ```
   src/instrumentation/libraries/{module}/integration-tests/
   ```

2. **Add required files**:
   - `package.json` - with module and testcontainer dependencies
   - `server.js` - Express server with endpoints and testcontainer setup
   - `test-config.json` - endpoints to test
   - `Dockerfile` - standard container setup

3. **Implement server with**:
   - Testcontainer initialization in startup
   - Health check endpoint
   - Test endpoints that exercise the instrumented module
   - Proper cleanup on shutdown

4. **Test the implementation**:
   ```bash
   ./integration-test-runner/run-instrumentation-tests.sh src/instrumentation/libraries/{module}/integration-tests
   ```

### For Self-Contained Modules

Same as above, but skip testcontainer dependencies and setup.

## Example Implementations

### PostgreSQL (with testcontainers)

See: `src/instrumentation/libraries/pg/integration-tests/`

- Uses `@testcontainers/postgresql`
- Tests client/pool operations, transactions, cursors
- Proper database setup and cleanup

### MongoDB (with testcontainers)

See: `src/instrumentation/libraries/mongodb/integration-tests/`

- Uses `@testcontainers/mongodb`
- Tests CRUD operations, aggregation, indexing
- Complex test scenarios with multiple collections

### Fetch (self-contained)

See: `src/instrumentation/libraries/fetch/integration-tests/`

- No external dependencies
- Tests HTTP requests to external APIs
- Various request types and configurations

## What happens when we encounter an issue in prod?

We should do the following using AI tools at each step:

1. **Create the test that validates the issue**
2. **Create/fix the instrumentation**
3. **Iterate until the test passes**

## Current Modules with Integration Tests

- pg
- mongodb
- graphql
- fetch
- http
- jsonwebtoken
