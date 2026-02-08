#!/bin/bash
set -e

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

# Phase 1: Setup
log "================================================" "$BLUE"
log "Phase 1: Setup" "$BLUE"
log "================================================" "$BLUE"
npm install --silent
npm run build --silent
rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
mkdir -p .tusk/traces .tusk/logs
log "Setup complete" "$GREEN"

# Benchmark mode
if [ -n "$BENCHMARKS" ]; then
  DURATION=${BENCHMARK_DURATION:-5}
  ENDPOINTS="/health /cache/all /cache/raw"
  run_benchmarks() {
    local mode=$1
    for endpoint in $ENDPOINTS; do
      BENCH_NAME="Benchmark_GET${endpoint//\//_}"
      START=$(date +%s%N); COUNT=0; END=$((START + DURATION * 1000000000))
      while [ $(date +%s%N) -lt $END ]; do
        curl -s "http://localhost:3000$endpoint" > /dev/null; COUNT=$((COUNT + 1))
      done
      ELAPSED=$(( $(date +%s%N) - START ))
      if [ $COUNT -gt 0 ]; then
        NS_PER_OP=$((ELAPSED / COUNT))
        OPS_PER_SEC=$(awk "BEGIN {printf \"%.2f\", $COUNT * 1000000000 / $ELAPSED}")
        printf "%-45s %5d %12d ns/op %10s ops/s\n" "$BENCH_NAME" "$COUNT" "$NS_PER_OP" "$OPS_PER_SEC"
      fi
    done
  }
  # Baseline
  log "BASELINE (SDK DISABLED)" "$BLUE"
  TUSK_DRIFT_MODE=DISABLED npm run dev &
  SERVER_PID=$!
  sleep 10
  run_benchmarks "baseline"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true; sleep 2
  # SDK enabled
  log "WITH SDK (TUSK_DRIFT_MODE=RECORD)" "$BLUE"
  rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
  TUSK_DRIFT_MODE=RECORD npm run dev &
  SERVER_PID=$!
  sleep 10
  run_benchmarks "sdk"
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  log "Benchmark complete" "$GREEN"
  exit 0
fi

# Phase 2: Recording Traces
log "================================================" "$BLUE"
log "Phase 2: Recording Traces" "$BLUE"
log "================================================" "$BLUE"
log "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev &
SERVER_PID=$!
sleep 10
log "Executing test requests..."
curl -sSf http://localhost:3000/health > /dev/null
curl -sSf http://localhost:3000/cache/all > /dev/null
curl -sSf http://localhost:3000/cache/sample > /dev/null
curl -sSf http://localhost:3000/cache/raw > /dev/null
curl -sSf -X POST http://localhost:3000/cache/execute-raw > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"key":"test_insert","value":"test_value"}' http://localhost:3000/cache/insert > /dev/null
curl -sSf -X PUT -H "Content-Type: application/json" -d '{"key":"test_key_1","value":"updated_value"}' http://localhost:3000/cache/update > /dev/null
curl -sSf -X DELETE -H "Content-Type: application/json" -d '{"key":"test_insert"}' http://localhost:3000/cache/delete > /dev/null
curl -sSf "http://localhost:3000/users/by-email?email=alice@example.com" > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"name":"Test User","email":"testuser@example.com"}' http://localhost:3000/users/insert > /dev/null
curl -sSf http://localhost:3000/cache/dynamic-fragments > /dev/null
curl -sSf -X POST http://localhost:3000/cache/update-with-fragments > /dev/null
curl -sSf http://localhost:3000/cache/complex-fragments > /dev/null
curl -sSf http://localhost:3000/test/execute-method > /dev/null
curl -sSf http://localhost:3000/test/sql-file > /dev/null
curl -sSf http://localhost:3000/test/pending-query-raw > /dev/null
curl -sSf http://localhost:3000/test/sql-reserve > /dev/null
curl -sSf http://localhost:3000/test/sql-cursor > /dev/null
curl -sSf http://localhost:3000/test/sql-cursor-callback > /dev/null
curl -sSf http://localhost:3000/test/sql-foreach > /dev/null
curl -sSf http://localhost:3000/test/describe-method > /dev/null
curl -sSf http://localhost:3000/test/savepoint > /dev/null
curl -sSf http://localhost:3000/test/listen-notify > /dev/null
curl -sSf http://localhost:3000/test/bytea-data > /dev/null
curl -sSf http://localhost:3000/test/unsafe-cursor > /dev/null
curl -sSf http://localhost:3000/test/unsafe-foreach > /dev/null
curl -sSf http://localhost:3000/test/large-object > /dev/null
sleep 3
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true; sleep 2
TRACE_COUNT=$(ls -1 .tusk/traces/*.jsonl 2>/dev/null | wc -l)
log "Recorded $TRACE_COUNT trace files" "$GREEN"
if [ "$TRACE_COUNT" -eq 0 ]; then
  log "ERROR: No traces recorded" "$RED"
  exit 1
fi

# Phase 3: Run Tusk Tests
log "================================================" "$BLUE"
log "Phase 3: Run Tusk Tests" "$BLUE"
log "================================================" "$BLUE"
set +e
TEST_OUTPUT=$(TUSK_ANALYTICS_DISABLED=1 tusk run --print --output-format json --enable-service-logs 2>&1)
TUSK_EXIT=$?
set -e
echo "$TEST_OUTPUT"
if [ $TUSK_EXIT -ne 0 ]; then
  log "ERROR: Tusk tests failed with exit code $TUSK_EXIT" "$RED"
  exit 1
fi
ALL_PASSED=$(echo "$TEST_OUTPUT" | grep -c '"passed":true' || true)
ANY_FAILED=$(echo "$TEST_OUTPUT" | grep -c '"passed":false' || true)
log "Tests passed: $ALL_PASSED, failed: $ANY_FAILED" "$GREEN"
if [ "$ANY_FAILED" -gt 0 ]; then
  log "ERROR: Some tests failed" "$RED"
  exit 1
fi

# Phase 4: Check for warnings
log "================================================" "$BLUE"
log "Phase 4: Check for warnings" "$BLUE"
log "================================================" "$BLUE"
if grep -r "TCP called from inbound request context" .tusk/logs/ 2>/dev/null; then
  log "ERROR: Found TCP instrumentation warnings in logs" "$RED"
  exit 1
fi
log "No warnings found" "$GREEN"

exit 0
