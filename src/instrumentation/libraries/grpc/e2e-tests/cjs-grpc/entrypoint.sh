#!/bin/bash
set -e

# E2E Test Entrypoint for gRPC (CJS) Instrumentation

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
  ENDPOINTS="/health /greet/hello /calc/add /users/1"

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
  sleep 10
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
  sleep 10
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
sleep 10

log "Executing test requests..."
curl -sSf http://localhost:3000/health > /dev/null
curl -sSf http://localhost:3000/greet/hello > /dev/null
curl -sSf http://localhost:3000/greet/hello-with-metadata > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"name":"CustomUser","greeting_type":"casual"}' http://localhost:3000/greet/custom > /dev/null
curl -sSf http://localhost:3000/greet/hello-again > /dev/null
curl -sSf http://localhost:3000/greet/many-times > /dev/null
curl -sSf http://localhost:3000/calc/add > /dev/null
curl -sSf http://localhost:3000/calc/subtract > /dev/null
curl -sSf http://localhost:3000/calc/multiply > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"num1":20,"num2":4}' http://localhost:3000/calc/divide > /dev/null
curl -sSf http://localhost:3000/calc/divide-by-zero > /dev/null
curl -sSf http://localhost:3000/users/1 > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"name":"Test User","email":"testuser@example.com","age":28,"roles":["user","tester"]}' http://localhost:3000/users > /dev/null
curl -sSf -X PUT -H "Content-Type: application/json" -d '{"name":"Alice Updated","email":"alice.updated@example.com","age":31}' http://localhost:3000/users/1 > /dev/null
curl -sSf "http://localhost:3000/users?limit=5&offset=0" > /dev/null
curl -sSf -X DELETE http://localhost:3000/users/2 > /dev/null
curl -sSf http://localhost:3000/test/user-not-found > /dev/null
curl -sSf http://localhost:3000/test/sequential-calls > /dev/null
curl -sSf -X POST http://localhost:3000/test/complex-data > /dev/null
curl -sSf -X POST http://localhost:3000/files/upload > /dev/null
curl -sSf http://localhost:3000/files/download/file_1 > /dev/null
curl -sSf http://localhost:3000/test/unary-callback-only > /dev/null
curl -sSf http://localhost:3000/test/unary-options-only > /dev/null

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
