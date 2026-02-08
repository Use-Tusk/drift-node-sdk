#!/bin/bash
set -e

# E2E Test Entrypoint for Upstash-redis-js (CJS) Instrumentation

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${2:-$NC}$1${NC}"; }

cleanup() {
  log "Stopping server..." "$YELLOW"
  [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT
SERVER_PID=""

log "================================================" "$BLUE"
log "Phase 1: Setup" "$BLUE"
log "================================================" "$BLUE"

log "Installing dependencies..."
npm install --silent

log "Building TypeScript..."
npm run build --silent

rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
mkdir -p .tusk/traces .tusk/logs

log "Setup complete" "$GREEN"

log "================================================" "$BLUE"
log "Phase 2: Recording traces" "$BLUE"
log "================================================" "$BLUE"

log "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev > /dev/null 2>&1 &
SERVER_PID=$!

log "Waiting for server to be ready..."
sleep 8

log "Health check..."
curl -sf http://localhost:3000/health > /dev/null || { log "Health check failed" "$RED"; exit 1; }

log "Hitting endpoints..."
curl -sSf http://localhost:3000/health > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/set > /dev/null
curl -sSf http://localhost:3000/test/string/get > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/mset > /dev/null
curl -sSf http://localhost:3000/test/string/mget > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/setex > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/setnx > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/getdel > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/append > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/incr > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/incrby > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/incrbyfloat > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/decr > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/decrby > /dev/null
curl -sSf http://localhost:3000/test/string/strlen > /dev/null
curl -sSf http://localhost:3000/test/string/getrange > /dev/null
curl -sSf -X POST http://localhost:3000/test/string/setrange > /dev/null
curl -sSf -X POST http://localhost:3000/test/hash/hset > /dev/null
curl -sSf http://localhost:3000/test/hash/hget > /dev/null
curl -sSf http://localhost:3000/test/hash/hgetall > /dev/null
curl -sSf -X POST http://localhost:3000/test/hash/hmset > /dev/null
curl -sSf http://localhost:3000/test/hash/hmget > /dev/null
curl -sSf -X POST http://localhost:3000/test/hash/hdel > /dev/null
curl -sSf http://localhost:3000/test/hash/hexists > /dev/null
curl -sSf http://localhost:3000/test/hash/hkeys > /dev/null
curl -sSf http://localhost:3000/test/hash/hvals > /dev/null
curl -sSf http://localhost:3000/test/hash/hlen > /dev/null
curl -sSf -X POST http://localhost:3000/test/hash/hincrby > /dev/null
curl -sSf -X POST http://localhost:3000/test/hash/hincrbyfloat > /dev/null
curl -sSf -X POST http://localhost:3000/test/hash/hsetnx > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/lpush > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/rpush > /dev/null
curl -sSf http://localhost:3000/test/list/lrange > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/lpop > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/rpop > /dev/null
curl -sSf http://localhost:3000/test/list/llen > /dev/null
curl -sSf http://localhost:3000/test/list/lindex > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/lset > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/linsert > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/lrem > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/ltrim > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/rpoplpush > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/lpos > /dev/null
curl -sSf -X POST http://localhost:3000/test/list/lmove > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/sadd > /dev/null
curl -sSf http://localhost:3000/test/set/smembers > /dev/null
curl -sSf http://localhost:3000/test/set/sismember > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/srem > /dev/null
curl -sSf http://localhost:3000/test/set/scard > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/spop > /dev/null
curl -sSf http://localhost:3000/test/set/srandmember > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/sdiff > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/sinter > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/sunion > /dev/null
curl -sSf -X POST http://localhost:3000/test/set/smove > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zadd > /dev/null
curl -sSf http://localhost:3000/test/zset/zrange > /dev/null
curl -sSf http://localhost:3000/test/zset/zrange-withscores > /dev/null
curl -sSf http://localhost:3000/test/zset/zrevrange > /dev/null
curl -sSf http://localhost:3000/test/zset/zscore > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zincrby > /dev/null
curl -sSf http://localhost:3000/test/zset/zcard > /dev/null
curl -sSf http://localhost:3000/test/zset/zcount > /dev/null
curl -sSf http://localhost:3000/test/zset/zrank > /dev/null
curl -sSf http://localhost:3000/test/zset/zrevrank > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zrem > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zpopmin > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zpopmax > /dev/null
curl -sSf http://localhost:3000/test/zset/zrangebyscore > /dev/null
curl -sSf http://localhost:3000/test/zset/zrevrangebyscore > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zremrangebyrank > /dev/null
curl -sSf -X POST http://localhost:3000/test/zset/zremrangebyscore > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/del > /dev/null
curl -sSf http://localhost:3000/test/key/exists > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/expire > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/expireat > /dev/null
curl -sSf http://localhost:3000/test/key/ttl > /dev/null
curl -sSf http://localhost:3000/test/key/pttl > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/persist > /dev/null
curl -sSf http://localhost:3000/test/key/keys > /dev/null
curl -sSf http://localhost:3000/test/key/randomkey > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/rename > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/renamenx > /dev/null
curl -sSf http://localhost:3000/test/key/type > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/touch > /dev/null
curl -sSf -X POST http://localhost:3000/test/key/unlink > /dev/null
curl -sSf -X POST http://localhost:3000/test/bitmap/setbit > /dev/null
curl -sSf http://localhost:3000/test/bitmap/getbit > /dev/null
curl -sSf http://localhost:3000/test/bitmap/bitcount > /dev/null
curl -sSf http://localhost:3000/test/bitmap/bitpos > /dev/null
curl -sSf -X POST http://localhost:3000/test/bitmap/bitop > /dev/null
curl -sSf http://localhost:3000/test/server/ping > /dev/null
curl -sSf http://localhost:3000/test/server/dbsize > /dev/null
curl -sSf -X POST http://localhost:3000/test/server/echo > /dev/null
curl -sSf -X POST http://localhost:3000/test/hll/pfadd > /dev/null
curl -sSf http://localhost:3000/test/hll/pfcount > /dev/null
curl -sSf -X POST http://localhost:3000/test/hll/pfmerge > /dev/null
curl -sSf -X POST http://localhost:3000/test/geo/geoadd > /dev/null
curl -sSf http://localhost:3000/test/geo/geopos > /dev/null
curl -sSf -X POST http://localhost:3000/test/geo/geodist > /dev/null
curl -sSf http://localhost:3000/test/geo/geohash > /dev/null
curl -sSf http://localhost:3000/cleanup > /dev/null

log "All endpoints hit successfully" "$GREEN"

log "Waiting for traces to be written..."
sleep 3

cleanup

log "================================================" "$BLUE"
log "Phase 3: Running replay tests" "$BLUE"
log "================================================" "$BLUE"

TUSK_ANALYTICS_DISABLED=1 tusk run --print --output-format "json" --enable-service-logs

log "================================================" "$BLUE"
log "Phase 4: Running benchmarks" "$BLUE"
log "================================================" "$BLUE"

if [ -n "$BENCHMARKS" ]; then
  log "Starting server in REPLAY mode..."
  TUSK_DRIFT_MODE=REPLAY npm run dev > /dev/null 2>&1 &
  SERVER_PID=$!
  
  log "Waiting for server to be ready..."
  sleep 8
  
  log "Running benchmarks for ${BENCHMARK_DURATION}s..."
  TUSK_ANALYTICS_DISABLED=1 tusk benchmark \
    --duration "${BENCHMARK_DURATION}" \
    --endpoints "/health,/test/string/get,/test/server/ping"
  
  cleanup
fi

log "================================================" "$BLUE"
log "Test run complete" "$GREEN"
log "================================================" "$BLUE"
