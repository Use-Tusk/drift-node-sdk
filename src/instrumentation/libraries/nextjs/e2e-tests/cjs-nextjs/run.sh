#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="nextjs-cjs-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting Next.js (CJS) E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker container
echo "Step 1: Starting docker container..."
docker compose -p $PROJECT_NAME build --no-cache
docker compose -p $PROJECT_NAME up -d --quiet-pull

# Wait for container to be ready
echo "Waiting for container to be ready..."
sleep 3

# Step 2: Install dependencies (now that /sdk volume is mounted)
echo "Step 2: Installing dependencies..."
docker compose -p $PROJECT_NAME exec -T app npm install

# Step 3: Build the Next.js app
echo "Step 3: Building Next.js app..."
docker compose -p $PROJECT_NAME exec -T app npm run build

# Step 4: Start server in RECORD mode
echo "Step 4: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 5

# Step 5: Hit all endpoints
echo "Step 5: Hitting all endpoints..."

echo "  - GET /api/health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/api/health > /dev/null

echo "  - GET /api/weather (default location)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/api/weather > /dev/null

echo "  - GET /api/weather?location=London"
docker compose -p $PROJECT_NAME exec -T app curl -s "http://localhost:3000/api/weather?location=London" > /dev/null

echo "  - POST /api/weather"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"location":"Tokyo"}' http://localhost:3000/api/weather > /dev/null

echo "All endpoints hit successfully."

# Step 6: Wait before stopping server
echo "Step 6: Waiting 3 seconds before stopping server..."
sleep 3

# Stop the server process
echo "Stopping server..."
docker compose -p $PROJECT_NAME exec -T app pkill -f "node" || true
sleep 2

# Step 7: Run tests using tusk CLI
echo "Step 7: Running tests using tusk CLI..."
TEST_RESULTS=$(docker compose -p $PROJECT_NAME exec -T -e TUSK_ANALYTICS_DISABLED=1 app tusk run --print --output-format "json" --enable-service-logs)

# Step 8: Log test results
parse_and_display_test_results "$TEST_RESULTS"

# Step 8.5: Check for TCP instrumentation warning in logs
check_tcp_instrumentation_warning "$PROJECT_NAME"

# Step 9: Clean up
echo ""
echo "Step 9: Cleaning up docker containers..."
docker compose -p $PROJECT_NAME down

# Step 10: Clean up traces and logs
echo "Step 10: Cleaning up traces and logs..."
cleanup_tusk_files

echo "Next.js (CJS) E2E test run complete."

exit $EXIT_CODE
