# HTTP E2E Test (CommonJS)

End-to-end tests for HTTP instrumentation using CommonJS module format.

## Structure

```
cjs-http/
  src/
    index.ts          # Test server with HTTP/HTTPS/Axios endpoints
    tdInit.ts         # Drift SDK initialization
  .tusk/
    config.yaml       # Drift CLI configuration
  docker-compose.yml  # Docker setup
  Dockerfile
  package.json
  tsconfig.json
```

## Running the E2E Test

### 1. Start the Docker container

```bash
cd src/instrumentation/libraries/http/e2e-tests/cjs-http
docker-compose up -d --build
```

This will:
- Build the Docker image with the Tusk Drift CLI installed
- Mount the SDK source at `/sdk` (for hot reload)
- Mount the `.tusk/` folder to persist traces
- Keep the container running (app not started yet)

### 2. Start the server in RECORD mode

```bash
docker-compose exec -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"
```

The CLI will start the server in RECORD mode. Server will be available at `http://localhost:3000`

### 3. Hit the test endpoints

From your host machine (or another terminal):

```bash
# Health check
curl http://localhost:3000/health

# Test raw http.get (outbound HTTP call)
curl http://localhost:3000/test-http-get

# Test raw http.request POST (outbound HTTP call)
curl -X POST http://localhost:3000/test-http-request

# Test https.get (outbound HTTPS call)
curl http://localhost:3000/test-https-get

# Test axios GET (outbound HTTP call via axios)
curl http://localhost:3000/test-axios-get

# Test axios POST (outbound HTTP call via axios)
curl -X POST http://localhost:3000/test-axios-post
```

Each endpoint makes an outbound HTTP/HTTPS request to test the instrumentation.

### 4. Stop the server

Press `Ctrl+C` in the terminal where the server is running, then wait a few seconds for spans to flush.

### 5. Run REPLAY mode with the CLI

```bash
docker-compose exec app tusk run
```

### 6. Clean up

```bash
docker-compose down
```

To remove traces and start fresh:
```bash
rm -rf .tusk/traces
```
