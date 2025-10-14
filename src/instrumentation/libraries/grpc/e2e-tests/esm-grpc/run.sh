#!/bin/bash

# Exit on error
set -e

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting gRPC ESM E2E test run..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker container
echo "Step 1: Starting docker container..."
docker-compose up -d --build

# Wait for container to be ready
echo "Waiting for container to be ready..."
sleep 5

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker-compose exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start (gRPC server needs a bit more time)
echo "Waiting for server to start..."
sleep 10

# Step 3: Hit all endpoints
echo "Step 3: Hitting all gRPC endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

# Greeter service endpoints
echo "  - GET /greet/hello"
docker-compose exec app curl -s http://localhost:3000/greet/hello > /dev/null

echo "  - GET /greet/hello-with-metadata"
docker-compose exec app curl -s http://localhost:3000/greet/hello-with-metadata > /dev/null

echo "  - POST /greet/custom"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"CustomUser","greeting_type":"casual"}' http://localhost:3000/greet/custom > /dev/null

echo "  - GET /greet/hello-again"
docker-compose exec app curl -s http://localhost:3000/greet/hello-again > /dev/null

echo "  - GET /greet/many-times"
docker-compose exec app curl -s http://localhost:3000/greet/many-times > /dev/null

# Calculator service endpoints
echo "  - GET /calc/add"
docker-compose exec app curl -s http://localhost:3000/calc/add > /dev/null

echo "  - GET /calc/subtract"
docker-compose exec app curl -s http://localhost:3000/calc/subtract > /dev/null

echo "  - GET /calc/multiply"
docker-compose exec app curl -s http://localhost:3000/calc/multiply > /dev/null

echo "  - POST /calc/divide"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"num1":20,"num2":4}' http://localhost:3000/calc/divide > /dev/null

echo "  - GET /calc/divide-by-zero (expected error)"
docker-compose exec app curl -s http://localhost:3000/calc/divide-by-zero > /dev/null

# User service endpoints
echo "  - GET /users/1"
docker-compose exec app curl -s http://localhost:3000/users/1 > /dev/null

echo "  - POST /users"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"name":"Test User","email":"testuser@example.com","age":28,"roles":["user","tester"]}' http://localhost:3000/users > /dev/null

echo "  - PUT /users/1"
docker-compose exec app curl -s -X PUT -H "Content-Type: application/json" -d '{"name":"Alice Updated","email":"alice.updated@example.com","age":31}' http://localhost:3000/users/1 > /dev/null

echo "  - GET /users (list with pagination)"
docker-compose exec app curl -s "http://localhost:3000/users?limit=5&offset=0" > /dev/null

echo "  - DELETE /users/2"
docker-compose exec app curl -s -X DELETE http://localhost:3000/users/2 > /dev/null

# Test endpoints
echo "  - GET /test/user-not-found (expected error)"
docker-compose exec app curl -s http://localhost:3000/test/user-not-found > /dev/null

echo "  - GET /test/sequential-calls"
docker-compose exec app curl -s http://localhost:3000/test/sequential-calls > /dev/null

echo "  - POST /test/complex-data"
docker-compose exec app curl -s -X POST http://localhost:3000/test/complex-data > /dev/null

# File service endpoints (testing binary data handling)
echo "  - POST /files/upload (testing binary data)"
docker-compose exec app curl -s -X POST http://localhost:3000/files/upload > /dev/null

echo "  - GET /files/download/file_1 (testing binary data)"
docker-compose exec app curl -s http://localhost:3000/files/download/file_1 > /dev/null

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

echo "gRPC ESM E2E test run complete."

exit $EXIT_CODE
