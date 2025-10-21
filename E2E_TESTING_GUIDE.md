# E2E Testing Guide for Tusk Drift Node SDK

## Overview

The Tusk Drift Node SDK is a Node.js library that enables recording and replaying of both outbound and inbound network calls. This allows you to capture real API interactions during development and replay them during testing, ensuring consistent and reliable test execution without external dependencies.

The SDK instruments various Node.js libraries (http, https, fetch, pg, postgres, etc.) to intercept and record network traffic. During replay mode, the SDK matches incoming requests against recorded traces and returns the previously captured responses.

## Purpose of This Guide

This guide provides step-by-step instructions for iterating on SDK instrumentations when debugging E2E tests. Use this when:

- An E2E test endpoint is failing
- You need to debug or fix instrumentation code
- You want to verify that SDK changes work correctly

## E2E Test Structure

E2E tests are located in `src/instrumentation/libraries/{library}/e2e-tests/{module-type}-{library}/`:

Each test directory contains:

- `src/` - Test application source code
- `Dockerfile` - Container configuration
- `docker-compose.yml` - Container orchestration
- `.tusk/` - Traces and logs directory
- `run.sh` - Automated test runner

## Quick Iteration Workflow

### Step 1: Navigate to the E2E Test Directory

```bash
cd src/instrumentation/libraries/{library}/e2e-tests/{test-name}
```

Example:

```bash
cd src/instrumentation/libraries/http/e2e-tests/cjs-http
```

### Step 2: Clean Up Previous Test Data

Before running a new test iteration, delete existing traces and logs to ensure only current test data is present:

```bash
rm -rf .tusk/traces/*
rm -rf .tusk/logs/*
```

This prevents confusion from old test runs and makes it easier to identify current issues.

### Step 3: Start Docker Container

Build and start the Docker container in detached mode:

```bash
docker compose up -d --build --wait
```

### Step 4: Install Dependencies

Install dependencies (now that /sdk volume is mounted):

```bash
docker compose exec -T app npm install
```

### Step 5: Start Server in RECORD Mode

Start the application server in RECORD mode to capture network traffic:

```bash
docker compose exec -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"
```

Wait a few seconds for the server to fully start (5-10 seconds recommended):

```bash
sleep 5
```

### Step 6: Hit the Endpoint(s) You Want to Record

Use `curl` to make requests to the endpoints you want to test. You can hit one or multiple endpoints:

```bash
# Example: GET request
docker compose exec app curl -s http://localhost:3000/test/fetch-get

# Example: POST request with JSON body
docker compose exec app curl -s -X POST -H "Content-Type: application/json" \
  -d '{"title":"test","body":"test body"}' \
  http://localhost:3000/test/fetch-post
```

**Tip:** Check the test's `src/index.ts` file to see all available endpoints.

### Step 7: Wait Before Stopping the Server

Wait a few seconds to ensure all traces are written to local storage:

```bash
sleep 3
```

### Step 8: Stop the Server Process

Stop the Node.js server process:

```bash
docker compose exec app pkill -f "node" || true
sleep 2
```

### Step 9: Run the Tusk CLI to Execute Tests

Run the Tusk CLI to replay the recorded traces:

```bash
docker compose exec -T app tusk run --print --output-format "json" --enable-service-logs
```

**Flags explained:**

- `--print` - Print test results to stdout
- `--output-format "json"` - Output results in JSON format
- `--enable-service-logs` - Write detailed service logs to `.tusk/logs/` for debugging

To see all available flags, run:

```bash
tusk run --help
```

**Interpreting Results:**

The output will be JSON with test results:

```json
[
  {
    "test_id": "test-1",
    "passed": true,
    "duration": 150
  },
  {
    "test_id": "test-2",
    "passed": false,
    "duration": 200
  }
]
```

- `"passed": true` - Test passed successfully
- `"passed": false` - Test failed (mismatch between recording and replay)
- Check `.tusk/logs/` for detailed error messages and debugging information

### Step 10: Review Logs for Issues

If tests fail, check the service logs for detailed error information:

If you deleted the logs before running the test, there should be only 1 log file in the `.tusk/logs/` directory.

You can also view the traces recorded in the `.tusk/traces/` directory.

### Step 11: Iterate on SDK Code

When you need to fix instrumentation code:

1. **Make changes to the SDK source code**
2. **Rebuild the SDK** from the repository root:

   ```bash
   npm run build
   ```

3. **NO need to rebuild Docker containers** - the SDK is mounted as a volume, so changes propagate automatically
4. **Clean up traces and logs** (Step 2)
5. **Restart the server in RECORD mode** (Step 4)
6. **Hit the endpoints again** (Step 5)
7. **Run the CLI tests** (Step 8)
8. **Repeat until tests pass**

### Step 12: Clean Up Docker Containers

When you're done testing, clean up the Docker containers:

```bash
docker compose down
```

## Important Notes

### SDK Volume Mounting

The Docker Compose configuration mounts the SDK source code as a read-only volume:

```yaml
volumes:
  - ../../../../../..:/sdk:ro # SDK source mounted at /sdk
```

This means:

- ✅ **SDK changes propagate automatically** - no need to rebuild containers
- ✅ **Fast iteration** - just run `npm run build` in the SDK root
- ❌ **Must rebuild SDK** - changes won't take effect until you run `npm run build`

### Traces and Logs

- **Traces** (`.tusk/traces/`) - Recorded network interactions
- **Logs** (`.tusk/logs/`) - Detailed service logs when `--enable-service-logs` is used
- **Always clean these before re-running tests** to avoid confusion

### Debugging Tips

1. **Check service logs first** - Most issues are explained in `.tusk/logs/`
2. **Verify traces were created** - Check `.tusk/traces/` has files after recording
3. **Test one endpoint at a time** - Easier to isolate issues
4. **Check for TCP warnings** - Indicates missing instrumentation

## Automated Testing

Each E2E test directory has a `run.sh` script that automates the entire workflow:

```bash
./run.sh
```

This script:

1. Cleans traces and logs
2. Starts containers
3. Starts server in RECORD mode
4. Hits all endpoints
5. Runs CLI tests
6. Displays results with colored output
7. Checks for TCP instrumentation warnings
8. Cleans up containers, traces, and logs
9. Exits with code 0 (success) or 1 (failure)

Use `run.sh` for full test runs, and use the manual steps above for iterative debugging.

## Quick Reference Commands

```bash
# Clean traces and logs
rm -rf .tusk/traces/* .tusk/logs/*

# Start containers
docker compose up -d --build

# Install dependencies
docker compose exec -T app npm install

# Start server in RECORD mode
docker compose exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Stop server
docker compose exec app pkill -f "node" || true

# Run tests
docker compose exec -T app tusk run --print --output-format "json" --enable-service-logs

# View logs
docker compose exec app ls .tusk/logs
docker compose exec app cat .tusk/logs/<log-file>

# Rebuild SDK (from repo root)
npm run build

# Clean up containers
docker compose down

# Run full automated test
./run.sh
```
