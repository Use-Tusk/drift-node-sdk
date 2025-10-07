#!/bin/bash

# Exit on error
set -e

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting MySQL2 ESM E2E test run..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (mysql + app)
echo "Step 1: Starting docker containers..."
docker-compose up -d --build

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for MySQL to be healthy
echo "Waiting for MySQL to be healthy..."
until docker-compose exec -T mysql mysqladmin ping -h localhost -u testuser -ptestpass > /dev/null 2>&1; do
  echo "  MySQL is not ready yet..."
  sleep 2
done
echo "MySQL is ready!"

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker-compose exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 8

# Step 3: Hit all endpoints
echo "Step 3: Hitting all MySQL2 endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/connection-query"
docker-compose exec app curl -s http://localhost:3000/test/connection-query > /dev/null

echo "  - POST /test/connection-parameterized"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/connection-parameterized > /dev/null

echo "  - GET /test/connection-execute"
docker-compose exec app curl -s http://localhost:3000/test/connection-execute > /dev/null

echo "  - POST /test/connection-execute-params"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/connection-execute-params > /dev/null

echo "  - GET /test/pool-query"
docker-compose exec app curl -s http://localhost:3000/test/pool-query > /dev/null

echo "  - POST /test/pool-parameterized"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/pool-parameterized > /dev/null

echo "  - GET /test/pool-execute"
docker-compose exec app curl -s http://localhost:3000/test/pool-execute > /dev/null

echo "  - POST /test/pool-execute-params"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/pool-execute-params > /dev/null

echo "  - GET /test/pool-getConnection"
docker-compose exec app curl -s http://localhost:3000/test/pool-getConnection > /dev/null

echo "  - GET /test/connection-connect"
docker-compose exec app curl -s http://localhost:3000/test/connection-connect > /dev/null

echo "  - GET /test/connection-ping"
docker-compose exec app curl -s http://localhost:3000/test/connection-ping > /dev/null

echo "  - GET /test/stream-query"
docker-compose exec app curl -s http://localhost:3000/test/stream-query > /dev/null

echo "All endpoints hit successfully."

# Step 4: Wait before stopping server
echo "Step 4: Waiting 3 seconds before stopping server..."
sleep 3

# Stop the server process
echo "Stopping server..."
docker-compose exec app pkill -f "node" || true
sleep 2

# Step 5: Run tests using tusk CLI
echo "Step 5: Running tests using tusk CLI..."
TEST_RESULTS=$(docker-compose exec -T app tusk run --print --output-format "json" --enable-service-logs)

# Step 6: Log test results
parse_and_display_test_results "$TEST_RESULTS"

# Step 6.5: Check for TCP instrumentation warning in logs
check_tcp_instrumentation_warning

# Step 7: Clean up
echo ""
echo "Step 7: Cleaning up docker containers..."
docker-compose down

# Step 8: Clean up traces and logs
echo "Step 8: Cleaning up traces and logs..."
cleanup_tusk_files

echo "MySQL2 ESM E2E test run complete."

exit $EXIT_CODE
