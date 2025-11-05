#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="firestore-esm-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting Firestore ESM E2E test run on port ${APP_PORT}..."

# Check for required environment variables
if [ -z "$FIREBASE_PROJECT_ID" ]; then
  echo "Error: FIREBASE_PROJECT_ID environment variable is not set"
  exit 1
fi

if [ -z "$FIREBASE_SERVICE_ACCOUNT" ]; then
  echo "Error: FIREBASE_SERVICE_ACCOUNT environment variable is not set"
  exit 1
fi

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker container (app only)
echo "Step 1: Starting docker container..."
docker compose -p $PROJECT_NAME build --no-cache
docker compose -p $PROJECT_NAME up -d --quiet-pull

# Wait for container to be ready
echo "Waiting for container to be ready..."
sleep 5

# Step 2: Install dependencies (now that /sdk volume is mounted)
echo "Step 2: Installing dependencies..."
docker compose -p $PROJECT_NAME exec -T app npm install

# Step 3: Start server in RECORD mode
echo "Step 3: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 10

echo "Checking server logs..."
docker compose -p $PROJECT_NAME logs app

# Step 4: Hit all endpoints
echo "Step 4: Hitting all Firestore endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /document/get"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/document/get > /dev/null

echo "  - POST /document/create"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Created User","email":"created@example.com"}' http://localhost:3000/document/create > /dev/null

echo "  - POST /document/set"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Set User","email":"set@example.com"}' http://localhost:3000/document/set > /dev/null

echo "  - PUT /document/update"
docker compose -p $PROJECT_NAME exec -T app curl -s -X PUT -H "Content-Type: application/json" -d '{"name":"Updated User"}' http://localhost:3000/document/update > /dev/null

echo "  - DELETE /document/delete"
docker compose -p $PROJECT_NAME exec -T app curl -s -X DELETE http://localhost:3000/document/delete > /dev/null

echo "  - POST /collection/add"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Product A","price":99.99}' http://localhost:3000/collection/add > /dev/null

echo "  - POST /collection/doc-autoid"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Auto Product","price":49.99}' http://localhost:3000/collection/doc-autoid > /dev/null

echo "  - GET /query/get"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/query/get > /dev/null

echo "  - POST /transaction/increment"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/transaction/increment > /dev/null

echo "  - POST /transaction/transfer"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/transaction/transfer > /dev/null

echo "  - POST /batch/write"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/batch/write > /dev/null

echo "All endpoints hit successfully."

# Step 5: Wait before stopping server
echo "Step 5: Waiting 3 seconds before stopping server..."
sleep 3

# Stop the server process
echo "Stopping server..."
docker compose -p $PROJECT_NAME exec -T app pkill -f "node" || true
sleep 2

# Step 6: Run tests using tusk CLI
echo "Step 6: Running tests using tusk CLI..."
TEST_RESULTS=$(docker compose -p $PROJECT_NAME exec -T app tusk run --print --output-format "json" --enable-service-logs)

# Step 7: Log test results
parse_and_display_test_results "$TEST_RESULTS"

# Step 7.5: Check for TCP instrumentation warning in logs
check_tcp_instrumentation_warning "$PROJECT_NAME"

# Step 8: Clean up
echo ""
echo "Step 8: Cleaning up docker containers..."
docker compose -p $PROJECT_NAME down

# Step 9: Clean up traces and logs
echo "Step 9: Cleaning up traces and logs..."
cleanup_tusk_files

echo "Firestore ESM E2E test run complete."

exit $EXIT_CODE
