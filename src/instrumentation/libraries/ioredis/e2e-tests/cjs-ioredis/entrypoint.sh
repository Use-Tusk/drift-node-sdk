#!/bin/bash
set -e

# E2E Test Entrypoint for ioredis (CJS) Instrumentation

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

if [ -n "$BENCHMARKS" ]; then
  DURATION=${BENCHMARK_DURATION:-5}
  ENDPOINTS="/health /test/get /test/ping"

  run_benchmarks() {
    local mode=$1
    for endpoint in $ENDPOINTS; do
      BENCH_NAME="Benchmark_GET${endpoint//\//_}"
      START=$(date +%s%N)
      COUNT=0
      END=$((START + DURATION * 1000000000))
      while [ $(date +%s%N) -lt $END ]; do
        curl -s "http://localhost:3000$endpoint" > /dev/null
        COUNT=$((COUNT + 1))
      done
      ELAPSED=$(( $(date +%s%N) - START ))
      if [ $COUNT -gt 0 ]; then
        NS_PER_OP=$((ELAPSED / COUNT))
        OPS_PER_SEC=$(awk "BEGIN {printf \"%.2f\", $COUNT * 1000000000 / $ELAPSED}")
        printf "%-45s %5d %12d ns/op %10s ops/s\n" "$BENCH_NAME" "$COUNT" "$NS_PER_OP" "$OPS_PER_SEC"
      fi
    done
  }

  log "================================================" "$BLUE"
  log "BASELINE (SDK DISABLED)" "$BLUE"
  log "Duration per endpoint: ${DURATION}s" "$BLUE"
  log "================================================" "$BLUE"

  TUSK_DRIFT_MODE=DISABLED npm run dev &
  SERVER_PID=$!
  sleep 8
  run_benchmarks "baseline"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  sleep 2

  log ""
  log "================================================" "$BLUE"
  log "WITH SDK (TUSK_DRIFT_MODE=RECORD)" "$BLUE"
  log "================================================" "$BLUE"

  rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
  TUSK_DRIFT_MODE=RECORD npm run dev &
  SERVER_PID=$!
  sleep 8
  run_benchmarks "sdk"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true

  log ""
  log "Benchmark complete" "$GREEN"
  exit 0
fi

log "================================================" "$BLUE"
log "Phase 2: Recording Traces" "$BLUE"
log "================================================" "$BLUE"

log "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev &
SERVER_PID=$!
sleep 8

log "Executing test requests..."
curl -sSf http://localhost:3000/health > /dev/null
curl -sSf http://localhost:3000/test/get > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:newkey", "value": "newvalue"}' http://localhost:3000/test/set > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:newkey"}' http://localhost:3000/test/del > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:key1"}' http://localhost:3000/test/exists > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:key1", "seconds": 100}' http://localhost:3000/test/expire > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:key1"}' http://localhost:3000/test/ttl > /dev/null
curl -sSf http://localhost:3000/test/incr > /dev/null
curl -sSf http://localhost:3000/test/decr > /dev/null
curl -sSf http://localhost:3000/test/mget > /dev/null
curl -sSf -X POST http://localhost:3000/test/mset > /dev/null
curl -sSf http://localhost:3000/test/hget > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:user:2", "field": "name", "value": "Jane Doe"}' http://localhost:3000/test/hset > /dev/null
curl -sSf http://localhost:3000/test/hgetall > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:user:1", "field": "age"}' http://localhost:3000/test/hdel > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:list", "value": "item0"}' http://localhost:3000/test/lpush > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:list", "value": "item4"}' http://localhost:3000/test/rpush > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/lpop > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/rpop > /dev/null
curl -sSf http://localhost:3000/test/lrange > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:list"}' http://localhost:3000/test/llen > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member4"}' http://localhost:3000/test/sadd > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member4"}' http://localhost:3000/test/srem > /dev/null
curl -sSf http://localhost:3000/test/smembers > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:set", "member": "member1"}' http://localhost:3000/test/sismember > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "score": 4, "member": "score4"}' http://localhost:3000/test/zadd > /dev/null
curl -sSf http://localhost:3000/test/zrange > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "member": "score4"}' http://localhost:3000/test/zrem > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key": "test:zset", "member": "score1"}' http://localhost:3000/test/zscore > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"pattern": "test:*"}' http://localhost:3000/test/keys > /dev/null
curl -sSf -X POST http://localhost:3000/test/flushdb > /dev/null
curl -sSf http://localhost:3000/test/ping > /dev/null
curl -sSf http://localhost:3000/test/pipeline > /dev/null
curl -sSf http://localhost:3000/test/multi > /dev/null
curl -sSf http://localhost:3000/test/new-client > /dev/null
curl -sSf http://localhost:3000/test/getbuffer > /dev/null
curl -sSf http://localhost:3000/test/mgetbuffer > /dev/null

log "Waiting for traces to flush..."
sleep 3

log "Stopping server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
sleep 2

TRACE_COUNT=$(ls -1 .tusk/traces/*.jsonl 2>/dev/null | wc -l)
log "Recorded $TRACE_COUNT trace files" "$GREEN"

if [ "$TRACE_COUNT" -eq 0 ]; then
  log "ERROR: No traces recorded!" "$RED"
  exit 1
fi

log "================================================" "$BLUE"
log "Phase 3: Running Tusk Tests" "$BLUE"
log "================================================" "$BLUE"

set +e
TEST_OUTPUT=$(TUSK_ANALYTICS_DISABLED=1 tusk run --print --output-format json --enable-service-logs 2>&1)
TUSK_EXIT=$?
set -e

echo "$TEST_OUTPUT"

if [ $TUSK_EXIT -ne 0 ]; then
  log "Tusk tests failed with exit code $TUSK_EXIT" "$RED"
  exit 1
fi

ALL_PASSED=$(echo "$TEST_OUTPUT" | grep -c '"passed":true' || true)
ANY_FAILED=$(echo "$TEST_OUTPUT" | grep -c '"passed":false' || true)

log "================================================"
if [ "$ANY_FAILED" -gt 0 ]; then
  log "Some tests failed!" "$RED"
  exit 1
elif [ "$ALL_PASSED" -gt 0 ]; then
  log "All $ALL_PASSED tests passed!" "$GREEN"
else
  log "No test results found" "$YELLOW"
  exit 1
fi

log "================================================" "$BLUE"
log "Phase 4: Checking for Instrumentation Warnings" "$BLUE"
log "================================================" "$BLUE"

if grep -r "TCP called from inbound request context" .tusk/logs/ 2>/dev/null; then
  log "ERROR: Found TCP instrumentation warning!" "$RED"
  exit 1
else
  log "No instrumentation warnings found" "$GREEN"
fi

log "================================================" "$BLUE"
log "E2E Test Complete" "$GREEN"
log "================================================" "$BLUE"

exit 0
