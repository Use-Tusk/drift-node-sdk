#!/bin/bash

# Exit on error
set -e

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting ioredis E2E test run..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (redis + app)
echo "Step 1: Starting docker containers..."
docker-compose up -d --build

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for Redis to be healthy
echo "Waiting for Redis to be healthy..."
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
  echo "  Redis is not ready yet..."
  sleep 2
done
echo "Redis is ready!"

# Step 2: Start server in RECORD mode
echo "Step 2: Starting server in RECORD mode..."
docker-compose exec -d -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 8

# Step 3: Hit all endpoints
echo "Step 3: Hitting all ioredis endpoints..."

echo "  - GET /health"
docker-compose exec app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /test/get"
docker-compose exec app curl -s http://localhost:3000/test/get > /dev/null

echo "  - POST /test/set"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:newkey", "value": "newvalue"}' http://localhost:3000/test/set > /dev/null

echo "  - POST /test/del"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:newkey"}' http://localhost:3000/test/del > /dev/null

echo "  - POST /test/exists"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:key1"}' http://localhost:3000/test/exists > /dev/null

echo "  - POST /test/expire"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:key1", "seconds": 100}' http://localhost:3000/test/expire > /dev/null

echo "  - POST /test/ttl"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:key1"}' http://localhost:3000/test/ttl > /dev/null

echo "  - GET /test/incr"
docker-compose exec app curl -s http://localhost:3000/test/incr > /dev/null

echo "  - GET /test/decr"
docker-compose exec app curl -s http://localhost:3000/test/decr > /dev/null

echo "  - GET /test/mget"
docker-compose exec app curl -s http://localhost:3000/test/mget > /dev/null

echo "  - POST /test/mset"
docker-compose exec app curl -s -X POST http://localhost:3000/test/mset > /dev/null

echo "  - GET /test/hget"
docker-compose exec app curl -s http://localhost:3000/test/hget > /dev/null

echo "  - POST /test/hset"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:user:2", "field": "name", "value": "Jane Doe"}' http://localhost:3000/test/hset > /dev/null

echo "  - GET /test/hgetall"
docker-compose exec app curl -s http://localhost:3000/test/hgetall > /dev/null

echo "  - POST /test/hdel"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:user:1", "field": "age"}' http://localhost:3000/test/hdel > /dev/null

echo "  - POST /test/lpush"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list", "value": "item0"}' http://localhost:3000/test/lpush > /dev/null

echo "  - POST /test/rpush"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list", "value": "item4"}' http://localhost:3000/test/rpush > /dev/null

echo "  - POST /test/lpop"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/lpop > /dev/null

echo "  - POST /test/rpop"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/rpop > /dev/null

echo "  - GET /test/lrange"
docker-compose exec app curl -s http://localhost:3000/test/lrange > /dev/null

echo "  - POST /test/llen"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/llen > /dev/null

echo "  - POST /test/sadd"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member4"}' http://localhost:3000/test/sadd > /dev/null

echo "  - POST /test/srem"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member4"}' http://localhost:3000/test/srem > /dev/null

echo "  - GET /test/smembers"
docker-compose exec app curl -s http://localhost:3000/test/smembers > /dev/null

echo "  - POST /test/sismember"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member1"}' http://localhost:3000/test/sismember > /dev/null

echo "  - POST /test/zadd"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "score": 4, "member": "score4"}' http://localhost:3000/test/zadd > /dev/null

echo "  - GET /test/zrange"
docker-compose exec app curl -s http://localhost:3000/test/zrange > /dev/null

echo "  - POST /test/zrem"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "member": "score4"}' http://localhost:3000/test/zrem > /dev/null

echo "  - POST /test/zscore"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "member": "score1"}' http://localhost:3000/test/zscore > /dev/null

echo "  - POST /test/keys"
docker-compose exec app curl -s -X POST -H "Content-Type: application/json" -d '{"pattern": "test:*"}' http://localhost:3000/test/keys > /dev/null

echo "  - POST /test/flushdb"
docker-compose exec app curl -s -X POST http://localhost:3000/test/flushdb > /dev/null

echo "  - GET /test/ping"
docker-compose exec app curl -s http://localhost:3000/test/ping > /dev/null

echo "  - GET /test/pipeline"
docker-compose exec app curl -s http://localhost:3000/test/pipeline > /dev/null

echo "  - GET /test/multi"
docker-compose exec app curl -s http://localhost:3000/test/multi > /dev/null

echo "  - GET /test/new-client"
docker-compose exec app curl -s http://localhost:3000/test/new-client > /dev/null

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

echo "ioredis E2E test run complete."

exit $EXIT_CODE
