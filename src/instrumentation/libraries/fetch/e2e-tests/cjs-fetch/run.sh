#!/bin/bash

# Exit on error
set -e

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting Fetch E2E test run..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker container
echo "Step 1: Starting docker container..."
docker-compose up -d --build

# Wait for container to be ready
echo "Waiting for container to be ready..."
sleep 3

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker-compose exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 5

# Step 3: Hit all endpoints
echo "Step 3: Hitting all Fetch endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/fetch-get"
docker-compose exec app curl -s http://localhost:3000/test/fetch-get > /dev/null

echo "  - POST /test/fetch-post"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"title":"test","body":"test body"}' http://localhost:3000/test/fetch-post > /dev/null

echo "  - GET /test/fetch-headers"
docker-compose exec app curl -s http://localhost:3000/test/fetch-headers > /dev/null

echo "  - GET /test/fetch-json"
docker-compose exec app curl -s http://localhost:3000/test/fetch-json > /dev/null

echo "  - GET /test/fetch-url-object"
docker-compose exec app curl -s http://localhost:3000/test/fetch-url-object > /dev/null

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

echo "Fetch E2E test run complete."

exit $EXIT_CODE
