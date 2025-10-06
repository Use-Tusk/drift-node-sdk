#!/bin/bash

# Exit on error
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Starting E2E test run..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
rm -rf .tusk/traces/*
rm -rf .tusk/logs/*
echo "Cleanup complete."

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
echo "Step 3: Hitting all endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test-http-get"
docker-compose exec app curl -s http://localhost:3000/test-http-get > /dev/null

echo "  - POST /test-http-request"
docker-compose exec app curl -s -X POST http://localhost:3000/test-http-request > /dev/null

echo "  - GET /test-https-get"
docker-compose exec app curl -s http://localhost:3000/test-https-get > /dev/null

echo "  - GET /test-axios-get"
docker-compose exec app curl -s http://localhost:3000/test-axios-get > /dev/null

echo "  - POST /test-axios-post"
docker-compose exec app curl -s -X POST http://localhost:3000/test-axios-post > /dev/null

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

echo "E2E test run complete."

exit $EXIT_CODE
