#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="upstash-redis-js-esm-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting upstash-redis-js ESM E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (app only - no Redis needed for Upstash)
echo "Step 1: Starting docker containers..."
docker compose -p $PROJECT_NAME build --no-cache
docker compose -p $PROJECT_NAME up -d --quiet-pull

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Step 2: Install dependencies (now that /sdk volume is mounted)
echo "Step 2: Installing dependencies..."
docker compose -p $PROJECT_NAME exec -T app npm install

# Check app directory structure
echo "Checking app directory structure..."
echo "Contents of /app:"
docker compose -p $PROJECT_NAME exec -T app ls -la /app
echo ""
echo "Contents of /app/src:"
docker compose -p $PROJECT_NAME exec -T app ls -la /app/src || echo "  (src directory not found)"
echo ""
echo "Package.json scripts:"
docker compose -p $PROJECT_NAME exec -T app cat /app/package.json | grep -A 10 '"scripts"' || echo "  (could not read package.json)"
echo ""

# Step 3: Start server in RECORD mode
echo "Step 3: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "cd /app && npm run build >> /tmp/server.log 2>&1 && npm run dev >> /tmp/server.log 2>&1"

# Wait for server to start
echo "Waiting for server to start..."
sleep 8

# Show initial server output
echo "Initial server output:"
docker compose -p $PROJECT_NAME exec -T app cat /tmp/server.log 2>/dev/null || echo "  (no output yet)"

# Step 4: Hit all endpoints
echo "Step 4: Hitting all upstash-redis-js endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

# String operations
echo "  - POST /test/string/set"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/set > /dev/null

echo "  - GET /test/string/get"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/string/get > /dev/null

echo "  - POST /test/string/mset"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/mset > /dev/null

echo "  - GET /test/string/mget"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/string/mget > /dev/null

echo "  - POST /test/string/setex"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/setex > /dev/null

echo "  - POST /test/string/setnx"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/setnx > /dev/null

echo "  - POST /test/string/getdel"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/getdel > /dev/null

echo "  - POST /test/string/append"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/append > /dev/null

echo "  - POST /test/string/incr"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/incr > /dev/null

echo "  - POST /test/string/incrby"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/incrby > /dev/null

echo "  - POST /test/string/incrbyfloat"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/incrbyfloat > /dev/null

echo "  - POST /test/string/decr"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/decr > /dev/null

echo "  - POST /test/string/decrby"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/decrby > /dev/null

echo "  - GET /test/string/strlen"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/string/strlen > /dev/null

echo "  - GET /test/string/getrange"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/string/getrange > /dev/null

echo "  - POST /test/string/setrange"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/string/setrange > /dev/null

# Hash operations
echo "  - POST /test/hash/hset"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hash/hset > /dev/null

echo "  - GET /test/hash/hget"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hget > /dev/null

echo "  - GET /test/hash/hgetall"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hgetall > /dev/null

echo "  - POST /test/hash/hmset"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hash/hmset > /dev/null

echo "  - GET /test/hash/hmget"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hmget > /dev/null

echo "  - POST /test/hash/hdel"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hash/hdel > /dev/null

echo "  - GET /test/hash/hexists"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hexists > /dev/null

echo "  - GET /test/hash/hkeys"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hkeys > /dev/null

echo "  - GET /test/hash/hvals"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hvals > /dev/null

echo "  - GET /test/hash/hlen"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hash/hlen > /dev/null

echo "  - POST /test/hash/hincrby"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hash/hincrby > /dev/null

echo "  - POST /test/hash/hincrbyfloat"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hash/hincrbyfloat > /dev/null

echo "  - POST /test/hash/hsetnx"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hash/hsetnx > /dev/null

# List operations
echo "  - POST /test/list/lpush"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/lpush > /dev/null

echo "  - POST /test/list/rpush"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/rpush > /dev/null

echo "  - GET /test/list/lrange"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/list/lrange > /dev/null

echo "  - POST /test/list/lpop"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/lpop > /dev/null

echo "  - POST /test/list/rpop"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/rpop > /dev/null

echo "  - GET /test/list/llen"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/list/llen > /dev/null

echo "  - GET /test/list/lindex"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/list/lindex > /dev/null

echo "  - POST /test/list/lset"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/lset > /dev/null

echo "  - POST /test/list/linsert"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/linsert > /dev/null

echo "  - POST /test/list/lrem"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/lrem > /dev/null

echo "  - POST /test/list/ltrim"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/ltrim > /dev/null

echo "  - POST /test/list/rpoplpush"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/rpoplpush > /dev/null

echo "  - POST /test/list/lpos"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/lpos > /dev/null

echo "  - POST /test/list/lmove"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/list/lmove > /dev/null

# Set operations
echo "  - POST /test/set/sadd"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/sadd > /dev/null

echo "  - GET /test/set/smembers"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/set/smembers > /dev/null

echo "  - GET /test/set/sismember"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/set/sismember > /dev/null

echo "  - POST /test/set/srem"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/srem > /dev/null

echo "  - GET /test/set/scard"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/set/scard > /dev/null

echo "  - POST /test/set/spop"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/spop > /dev/null

echo "  - GET /test/set/srandmember"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/set/srandmember > /dev/null

echo "  - POST /test/set/sdiff"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/sdiff > /dev/null

echo "  - POST /test/set/sinter"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/sinter > /dev/null

echo "  - POST /test/set/sunion"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/sunion > /dev/null

echo "  - POST /test/set/smove"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/set/smove > /dev/null

# Sorted Set operations
echo "  - POST /test/zset/zadd"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zadd > /dev/null

echo "  - GET /test/zset/zrange"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrange > /dev/null

echo "  - GET /test/zset/zrange-withscores"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrange-withscores > /dev/null

echo "  - GET /test/zset/zrevrange"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrevrange > /dev/null

echo "  - GET /test/zset/zscore"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zscore > /dev/null

echo "  - POST /test/zset/zincrby"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zincrby > /dev/null

echo "  - GET /test/zset/zcard"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zcard > /dev/null

echo "  - GET /test/zset/zcount"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zcount > /dev/null

echo "  - GET /test/zset/zrank"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrank > /dev/null

echo "  - GET /test/zset/zrevrank"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrevrank > /dev/null

echo "  - POST /test/zset/zrem"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zrem > /dev/null

echo "  - POST /test/zset/zpopmin"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zpopmin > /dev/null

echo "  - POST /test/zset/zpopmax"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zpopmax > /dev/null

echo "  - GET /test/zset/zrangebyscore"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrangebyscore > /dev/null

echo "  - GET /test/zset/zrevrangebyscore"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/zset/zrevrangebyscore > /dev/null

echo "  - POST /test/zset/zremrangebyrank"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zremrangebyrank > /dev/null

echo "  - POST /test/zset/zremrangebyscore"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/zset/zremrangebyscore > /dev/null

# Key operations
echo "  - POST /test/key/del"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/del > /dev/null

echo "  - GET /test/key/exists"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/key/exists > /dev/null

echo "  - POST /test/key/expire"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/expire > /dev/null

echo "  - POST /test/key/expireat"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/expireat > /dev/null

echo "  - GET /test/key/ttl"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/key/ttl > /dev/null

echo "  - GET /test/key/pttl"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/key/pttl > /dev/null

echo "  - POST /test/key/persist"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/persist > /dev/null

echo "  - GET /test/key/keys"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/key/keys > /dev/null

echo "  - GET /test/key/randomkey"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/key/randomkey > /dev/null

echo "  - POST /test/key/rename"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/rename > /dev/null

echo "  - POST /test/key/renamenx"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/renamenx > /dev/null

echo "  - GET /test/key/type"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/key/type > /dev/null

echo "  - POST /test/key/touch"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/touch > /dev/null

echo "  - POST /test/key/unlink"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/key/unlink > /dev/null

# Bitmap operations
echo "  - POST /test/bitmap/setbit"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/bitmap/setbit > /dev/null

echo "  - GET /test/bitmap/getbit"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/bitmap/getbit > /dev/null

echo "  - GET /test/bitmap/bitcount"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/bitmap/bitcount > /dev/null

echo "  - GET /test/bitmap/bitpos"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/bitmap/bitpos > /dev/null

echo "  - POST /test/bitmap/bitop"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/bitmap/bitop > /dev/null

# Server operations
echo "  - GET /test/server/ping"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/server/ping > /dev/null

echo "  - GET /test/server/dbsize"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/server/dbsize > /dev/null

echo "  - POST /test/server/echo"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/server/echo > /dev/null

# HyperLogLog operations
echo "  - POST /test/hll/pfadd"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hll/pfadd > /dev/null

echo "  - GET /test/hll/pfcount"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/hll/pfcount > /dev/null

echo "  - POST /test/hll/pfmerge"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/hll/pfmerge > /dev/null

# Geo operations
echo "  - POST /test/geo/geoadd"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/geo/geoadd > /dev/null

echo "  - GET /test/geo/geopos"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/geo/geopos > /dev/null

echo "  - POST /test/geo/geodist"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/test/geo/geodist > /dev/null

echo "  - GET /test/geo/geohash"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/test/geo/geohash > /dev/null

# Cleanup - delete all test keys to save space
echo "  - GET /cleanup"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/cleanup > /dev/null

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

echo "upstash-redis-js ESM E2E test run complete."

exit $EXIT_CODE
