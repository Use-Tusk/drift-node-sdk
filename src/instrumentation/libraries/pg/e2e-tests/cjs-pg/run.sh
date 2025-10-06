#!/bin/bash

# Exit on error
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Starting PostgreSQL E2E test run..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
rm -rf .tusk/traces/*
rm -rf .tusk/logs/*
echo "Cleanup complete."

# Step 1: Start docker containers (postgres + app)
echo "Step 1: Starting docker containers..."
docker-compose up -d --build

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for PostgreSQL to be healthy
echo "Waiting for PostgreSQL to be healthy..."
until docker-compose exec -T postgres pg_isready -U testuser -d testdb > /dev/null 2>&1; do
  echo "  PostgreSQL is not ready yet..."
  sleep 2
done
echo "PostgreSQL is ready!"

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker-compose exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 8

# Step 3: Hit all endpoints
echo "Step 3: Hitting all PostgreSQL endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/basic-query"
docker-compose exec app curl -s http://localhost:3000/test/basic-query > /dev/null

echo "  - POST /test/parameterized-query"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/parameterized-query > /dev/null

echo "  - GET /test/client-query"
docker-compose exec app curl -s http://localhost:3000/test/client-query > /dev/null

echo "  - GET /test/client-connect"
docker-compose exec app curl -s http://localhost:3000/test/client-connect > /dev/null

echo "  - GET /test/client-close"
docker-compose exec app curl -s http://localhost:3000/test/client-close > /dev/null

echo "  - GET /test/pool-query"
docker-compose exec app curl -s http://localhost:3000/test/pool-query > /dev/null

echo "  - POST /test/pool-parameterized"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/pool-parameterized > /dev/null

echo "  - GET /test/pool-connect"
docker-compose exec app curl -s http://localhost:3000/test/pool-connect > /dev/null

echo "  - GET /test/pool-transaction"
docker-compose exec app curl -s http://localhost:3000/test/pool-transaction > /dev/null

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
TEST_RESULTS=$(docker-compose exec -T app tusk run --print --output-format "json")

# Step 6: Log test results
echo ""
echo "======================================"
echo "Test Results:"
echo "======================================"

# Parse JSON results and display with colored check marks
echo "$TEST_RESULTS" | jq -r '.[] | "\(.test_id) \(.passed) \(.duration)"' | while read -r test_id passed duration; do
  if [ "$passed" = "true" ]; then
    echo -e "${GREEN}✓${NC} Test ID: $test_id (Duration: ${duration}ms)"
  else
    echo -e "${RED}✗${NC} Test ID: $test_id (Duration: ${duration}ms)"
  fi
done

echo "======================================"

# Check if all tests passed
ALL_PASSED=$(echo "$TEST_RESULTS" | jq -r 'all(.passed)')
if [ "$ALL_PASSED" = "true" ]; then
  echo -e "${GREEN}All tests passed!${NC}"
  EXIT_CODE=0
else
  echo -e "${RED}Some tests failed!${NC}"
  EXIT_CODE=1
fi

# Step 7: Clean up
echo ""
echo "Step 7: Cleaning up docker containers..."
docker-compose down

# Step 8: Clean up traces and logs
echo "Step 8: Cleaning up traces and logs..."
rm -rf .tusk/traces/*
rm -rf .tusk/logs/*
echo "Cleanup complete."

echo "PostgreSQL E2E test run complete."

exit $EXIT_CODE
