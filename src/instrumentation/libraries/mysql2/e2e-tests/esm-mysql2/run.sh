#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="mysql2-esm-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting MySQL2 ESM E2E test run on port ${APP_PORT}..."

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
sleep 8

# Step 4: Hit all endpoints
echo "Step 4: Hitting all MySQL2 endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/connection-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/connection-query > /dev/null

echo "  - POST /test/connection-parameterized"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/connection-parameterized > /dev/null

echo "  - GET /test/connection-execute"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/connection-execute > /dev/null

echo "  - POST /test/connection-execute-params"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/connection-execute-params > /dev/null

echo "  - GET /test/pool-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/pool-query > /dev/null

echo "  - POST /test/pool-parameterized"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/pool-parameterized > /dev/null

echo "  - GET /test/pool-execute"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/pool-execute > /dev/null

echo "  - POST /test/pool-execute-params"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/pool-execute-params > /dev/null

echo "  - GET /test/pool-getConnection"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/pool-getConnection > /dev/null

echo "  - GET /test/connection-connect"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/connection-connect > /dev/null

echo "  - GET /test/connection-ping"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/connection-ping > /dev/null

echo "  - GET /test/stream-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/stream-query > /dev/null

echo "  - GET /test/sequelize-authenticate"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/sequelize-authenticate > /dev/null

echo "  - GET /test/sequelize-findall"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/sequelize-findall > /dev/null

echo "  - POST /test/sequelize-findone"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/sequelize-findone > /dev/null

echo "  - GET /test/sequelize-complex"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/sequelize-complex > /dev/null

echo "  - GET /test/sequelize-raw"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/sequelize-raw > /dev/null

echo "  - POST /test/sequelize-transaction"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/sequelize-transaction > /dev/null

echo "  - GET /test/promise-connection-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/promise-connection-query > /dev/null

echo "  - GET /test/promise-pool-query"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/promise-pool-query > /dev/null

echo "  - GET /test/promise-pool-getconnection"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/promise-pool-getconnection > /dev/null

echo "  - GET /test/transaction-methods"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/transaction-methods > /dev/null

echo "  - GET /test/prepare-statement"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/prepare-statement > /dev/null

echo "  - GET /test/change-user"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/change-user > /dev/null

echo "  - GET /test/nested-null-values"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/nested-null-values > /dev/null

echo "  - GET /test/binary-data"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/binary-data > /dev/null

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
TEST_RESULTS=$(docker compose -p $PROJECT_NAME exec -T -e TUSK_ANALYTICS_DISABLED=1 app tusk run --print --output-format "json" --enable-service-logs)

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

echo "MySQL2 ESM E2E test run complete."

exit $EXIT_CODE
