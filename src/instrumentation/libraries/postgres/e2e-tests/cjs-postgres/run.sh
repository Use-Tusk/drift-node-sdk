#!/bin/bash

# Exit on error
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Starting Postgres (Drizzle + postgres) E2E test run..."

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
sleep 10

# Step 3: Hit all endpoints
echo "Step 3: Hitting all Postgres + Drizzle endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /cache/all"
docker-compose exec app curl -s http://localhost:3000/cache/all > /dev/null

echo "  - GET /cache/sample"
docker-compose exec app curl -s http://localhost:3000/cache/sample > /dev/null

echo "  - GET /cache/raw"
docker-compose exec app curl -s http://localhost:3000/cache/raw > /dev/null

echo "  - POST /cache/execute-raw"
docker-compose exec app curl -s -X POST http://localhost:3000/cache/execute-raw > /dev/null

echo "  - POST /cache/insert"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key":"test_insert","value":"test_value"}' http://localhost:3000/cache/insert > /dev/null

echo "  - PUT /cache/update"
docker-compose exec app curl -s -X PUT -H "Content-Type: application/json" -d '{"key":"test_key_1","value":"updated_value"}' http://localhost:3000/cache/update > /dev/null

echo "  - DELETE /cache/delete"
docker-compose exec app curl -s -X DELETE -H "Content-Type: application/json" -d '{"key":"test_insert"}' http://localhost:3000/cache/delete > /dev/null

echo "  - GET /users/by-email"
docker-compose exec app curl -s "http://localhost:3000/users/by-email?email=alice@example.com" > /dev/null

echo "  - POST /users/insert"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Test User","email":"testuser@example.com"}' http://localhost:3000/users/insert > /dev/null

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

# Step 6.5: Check for TCP instrumentation warning in logs
echo ""
echo "Checking for TCP instrumentation warnings..."
FIRST_LOG_FILE=$(docker-compose exec -T app ls -1 .tusk/logs 2>/dev/null | head -n 1)
if [ -n "$FIRST_LOG_FILE" ]; then
  if docker-compose exec -T app grep -q "\[TcpInstrumentation\] TCP called from inbound request context, likely unpatched dependency" .tusk/logs/"$FIRST_LOG_FILE" 2>/dev/null; then
    echo -e "${RED}✗ WARNING: Found TCP instrumentation warning in logs!${NC}"
    echo -e "${RED}  This indicates an unpatched dependency is making TCP calls.${NC}"
    EXIT_CODE=1
  else
    echo -e "${GREEN}✓ No TCP instrumentation warnings found.${NC}"
  fi
else
  echo -e "${YELLOW}⚠ No log files found, skipping TCP warning check.${NC}"
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

echo "Postgres (Drizzle + postgres) E2E test run complete."

exit $EXIT_CODE
