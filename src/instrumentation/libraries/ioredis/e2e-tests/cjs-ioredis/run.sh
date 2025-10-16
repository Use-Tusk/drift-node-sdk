#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="ioredis-cjs-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting ioredis E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (redis + app)
echo "Step 1: Starting docker containers..."
docker compose -p $PROJECT_NAME up -d --build

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for Redis to be healthy
echo "Waiting for Redis to be healthy..."
until docker compose -p $PROJECT_NAME exec -T redis redis-cli ping > /dev/null 2>&1; do
  echo "  Redis is not ready yet..."
  sleep 2
done
echo "Redis is ready!"

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 8

# Step 3: Hit all endpoints
echo "Step 3: Hitting all ioredis endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/get"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/get > /dev/null

echo "  - POST /test/set"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:newkey", "value": "newvalue"}' http://localhost:3000/test/set > /dev/null

echo "  - POST /test/del"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:newkey"}' http://localhost:3000/test/del > /dev/null

echo "  - POST /test/exists"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:key1"}' http://localhost:3000/test/exists > /dev/null

echo "  - POST /test/expire"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:key1", "seconds": 100}' http://localhost:3000/test/expire > /dev/null

echo "  - POST /test/ttl"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:key1"}' http://localhost:3000/test/ttl > /dev/null

echo "  - GET /test/incr"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/incr > /dev/null

echo "  - GET /test/decr"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/decr > /dev/null

echo "  - GET /test/mget"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/mget > /dev/null

echo "  - POST /test/mset"
docker compose -p $PROJECT_NAME exec app curl -s -X POST http://localhost:3000/test/mset > /dev/null

echo "  - GET /test/hget"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/hget > /dev/null

echo "  - POST /test/hset"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:user:2", "field": "name", "value": "Jane Doe"}' http://localhost:3000/test/hset > /dev/null

echo "  - GET /test/hgetall"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/hgetall > /dev/null

echo "  - POST /test/hdel"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:user:1", "field": "age"}' http://localhost:3000/test/hdel > /dev/null

echo "  - POST /test/lpush"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list", "value": "item0"}' http://localhost:3000/test/lpush > /dev/null

echo "  - POST /test/rpush"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list", "value": "item4"}' http://localhost:3000/test/rpush > /dev/null

echo "  - POST /test/lpop"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/lpop > /dev/null

echo "  - POST /test/rpop"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/rpop > /dev/null

echo "  - GET /test/lrange"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/lrange > /dev/null

echo "  - POST /test/llen"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/llen > /dev/null

echo "  - POST /test/sadd"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member4"}' http://localhost:3000/test/sadd > /dev/null

echo "  - POST /test/srem"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member4"}' http://localhost:3000/test/srem > /dev/null

echo "  - GET /test/smembers"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/smembers > /dev/null

echo "  - POST /test/sismember"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member1"}' http://localhost:3000/test/sismember > /dev/null

echo "  - POST /test/zadd"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "score": 4, "member": "score4"}' http://localhost:3000/test/zadd > /dev/null

echo "  - GET /test/zrange"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/zrange > /dev/null

echo "  - POST /test/zrem"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "member": "score4"}' http://localhost:3000/test/zrem > /dev/null

echo "  - POST /test/zscore"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "member": "score1"}' http://localhost:3000/test/zscore > /dev/null

echo "  - POST /test/keys"
docker compose -p $PROJECT_NAME exec app curl -s -X POST -H "Content-Type: application/json" -d '{"pattern": "test:*"}' http://localhost:3000/test/keys > /dev/null

echo "  - POST /test/flushdb"
docker compose -p $PROJECT_NAME exec app curl -s -X POST http://localhost:3000/test/flushdb > /dev/null

echo "  - GET /test/ping"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/ping > /dev/null

echo "  - GET /test/pipeline"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/pipeline > /dev/null

echo "  - GET /test/multi"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/multi > /dev/null

echo "  - GET /test/new-client"
docker compose -p $PROJECT_NAME exec app curl -s http://localhost:3000/test/new-client > /dev/null

echo "All endpoints hit successfully."

# Step 4: Wait before stopping server
echo "Step 4: Waiting 3 seconds before stopping server..."
sleep 3

# Stop the server process
echo "Stopping server..."
docker compose -p $PROJECT_NAME exec app pkill -f "node" || true
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

echo "ioredis E2E test run complete."

exit $EXIT_CODE
