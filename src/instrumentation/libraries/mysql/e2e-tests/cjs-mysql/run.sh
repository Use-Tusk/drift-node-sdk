#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="mysql-cjs-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting MySQL E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (mysql + app)
echo "Step 1: Starting docker containers..."
docker compose -p $PROJECT_NAME build --no-cache
docker compose -p $PROJECT_NAME up -d --quiet-pull

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for MySQL to be healthy
echo "Waiting for MySQL to be healthy..."
until docker compose -p $PROJECT_NAME exec -T mysql mysqladmin ping -h localhost -u testuser -ptestpass > /dev/null 2>&1; do
  echo "  MySQL is not ready yet..."
  sleep 2
done
echo "MySQL is ready!"

# Step 2: Install dependencies (now that /sdk volume is mounted)
echo "Step 2: Installing dependencies..."
docker compose -p $PROJECT_NAME exec -T app npm install

# Step 3: Start server in RECORD mode
echo "Step 3: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 10

# Step 4: Hit all endpoints
echo "Step 4: Hitting all MySQL endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

echo "  Connection Tests:"
echo "    - GET /connection/query-callback"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/connection/query-callback > /dev/null

echo "    - GET /connection/query-params"
docker compose -p $PROJECT_NAME exec -T app curl -s "http://localhost:3000/connection/query-params?key=test_key_1" > /dev/null

echo "    - GET /connection/query-options"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/connection/query-options > /dev/null

echo "    - GET /connection/query-stream"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/connection/query-stream > /dev/null

echo "    - GET /connection/multi-statement"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/connection/multi-statement > /dev/null

echo "  Pool Tests:"
echo "    - GET /pool/query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/pool/query > /dev/null

echo "    - GET /pool/get-connection"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/pool/get-connection > /dev/null

echo "  Transaction Tests:"
echo "    - POST /transaction/commit"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/transaction/commit > /dev/null

echo "    - POST /transaction/rollback"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/transaction/rollback > /dev/null

echo "  CRUD Tests:"
echo "    - POST /crud/insert"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"key":"crud_test_insert","value":"test_value"}' http://localhost:3000/crud/insert > /dev/null

echo "    - PUT /crud/update"
docker compose -p $PROJECT_NAME exec -T app curl -s -X PUT -H "Content-Type: application/json" -d '{"key":"test_key_1","value":"updated_value"}' http://localhost:3000/crud/update > /dev/null

echo "    - DELETE /crud/delete"
docker compose -p $PROJECT_NAME exec -T app curl -s -X DELETE -H "Content-Type: application/json" -d '{"key":"crud_test_insert"}' http://localhost:3000/crud/delete > /dev/null

echo "  Advanced Tests:"
echo "    - GET /advanced/join"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/advanced/join > /dev/null

echo "    - GET /advanced/aggregate"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/advanced/aggregate > /dev/null

echo "    - GET /advanced/subquery"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/advanced/subquery > /dev/null

echo "    - GET /advanced/prepared"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/advanced/prepared > /dev/null

echo "  Lifecycle Tests:"
echo "    - GET /lifecycle/ping"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/lifecycle/ping > /dev/null

echo "    - GET /lifecycle/end-and-reconnect"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/lifecycle/end-and-reconnect > /dev/null

echo "    - POST /lifecycle/change-user"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/lifecycle/change-user > /dev/null

echo "    - GET /lifecycle/pause-resume"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/lifecycle/pause-resume > /dev/null

echo "  Pool Lifecycle Tests:"
echo "    - GET /pool/end-and-recreate"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/pool/end-and-recreate > /dev/null

echo "  Event Tests:"
echo "    - GET /events/connect"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/events/connect > /dev/null

echo "  Stream Tests:"
echo "    - GET /stream/query-stream-method"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/stream/query-stream-method > /dev/null

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

echo "MySQL E2E test run complete."

exit $EXIT_CODE
