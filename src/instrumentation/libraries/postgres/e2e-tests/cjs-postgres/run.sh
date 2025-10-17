#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="postgres-cjs-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting Postgres (Drizzle + postgres) E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (postgres + app)
echo "Step 1: Starting docker containers..."
docker compose -p $PROJECT_NAME up -d --build --quiet-pull

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

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 10

# Step 3: Hit all endpoints
echo "Step 3: Hitting all Postgres + Drizzle endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /cache/all"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/cache/all > /dev/null

echo "  - GET /cache/sample"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/cache/sample > /dev/null

echo "  - GET /cache/raw"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/cache/raw > /dev/null

echo "  - POST /cache/execute-raw"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/cache/execute-raw > /dev/null

echo "  - POST /cache/insert"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"key":"test_insert","value":"test_value"}' http://localhost:3000/cache/insert > /dev/null

echo "  - PUT /cache/update"
docker compose -p $PROJECT_NAME exec -T app curl -s -X PUT -H "Content-Type: application/json" -d '{"key":"test_key_1","value":"updated_value"}' http://localhost:3000/cache/update > /dev/null

echo "  - DELETE /cache/delete"
docker compose -p $PROJECT_NAME exec -T app curl -s -X DELETE -H "Content-Type: application/json" -d '{"key":"test_insert"}' http://localhost:3000/cache/delete > /dev/null

echo "  - GET /users/by-email"
docker compose -p $PROJECT_NAME exec -T app curl -s "http://localhost:3000/users/by-email?email=alice@example.com" > /dev/null

echo "  - POST /users/insert"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Test User","email":"testuser@example.com"}' http://localhost:3000/users/insert > /dev/null

echo "All endpoints hit successfully."

# Step 4: Wait before stopping server
echo "Step 4: Waiting 3 seconds before stopping server..."
sleep 3

# Stop the server process
echo "Stopping server..."
docker compose -p $PROJECT_NAME exec -T app pkill -f "node" || true
sleep 2

# Step 5: Run tests using tusk CLI
echo "Step 5: Running tests using tusk CLI..."
TEST_RESULTS=$(docker compose -p $PROJECT_NAME exec -T app tusk run --print --output-format "json" --enable-service-logs)

# Step 6: Log test results
parse_and_display_test_results "$TEST_RESULTS"

# Step 6.5: Check for TCP instrumentation warning in logs
check_tcp_instrumentation_warning "$PROJECT_NAME"

# Step 7: Clean up
echo ""
echo "Step 7: Cleaning up docker containers..."
docker compose -p $PROJECT_NAME down

# Step 8: Clean up traces and logs
echo "Step 8: Cleaning up traces and logs..."
cleanup_tusk_files

echo "Postgres (Drizzle + postgres) E2E test run complete."

exit $EXIT_CODE
