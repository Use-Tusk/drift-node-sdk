#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="pg-cjs-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting PostgreSQL E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (postgres + app)
echo "Step 1: Starting docker containers..."
docker compose -p $PROJECT_NAME build --no-cache
docker compose -p $PROJECT_NAME up -d --quiet-pull

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for PostgreSQL to be healthy
echo "Waiting for PostgreSQL to be healthy..."
until docker compose -p $PROJECT_NAME exec -T postgres pg_isready -U testuser -d testdb > /dev/null 2>&1; do
  echo "  PostgreSQL is not ready yet..."
  sleep 2
done
echo "PostgreSQL is ready!"

# Step 2: Install dependencies (now that /sdk volume is mounted)
echo "Step 2: Installing dependencies..."
docker compose -p $PROJECT_NAME exec -T app npm install

# Step 3: Start server in RECORD mode
echo "Step 3: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 8

# Step 4: Hit all endpoints
echo "Step 4: Hitting all PostgreSQL endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/basic-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/basic-query > /dev/null

echo "  - POST /test/parameterized-query"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/parameterized-query > /dev/null

echo "  - GET /test/client-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/client-query > /dev/null

echo "  - GET /test/client-connect"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/client-connect > /dev/null

echo "  - GET /test/client-close"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/client-close > /dev/null

echo "  - GET /test/pool-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/pool-query > /dev/null

echo "  - POST /test/pool-parameterized"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/pool-parameterized > /dev/null

echo "  - GET /test/pool-connect"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/pool-connect > /dev/null

echo "  - GET /test/pool-transaction"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/pool-transaction > /dev/null

echo "  - GET /test/query-rowmode-array"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/query-rowmode-array > /dev/null

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
# cleanup_tusk_files

echo "PostgreSQL E2E test run complete."

exit $EXIT_CODE
