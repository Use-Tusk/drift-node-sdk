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
  pkill -f "node" 2>/dev/null || true
}
trap cleanup EXIT

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
  ENDPOINTS="/health /test/basic-query /test/pool-query"
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
  sleep 8
  run_benchmarks "baseline"
  pkill -f "node" || true; sleep 2
  # SDK enabled
  log "WITH SDK (TUSK_DRIFT_MODE=RECORD)" "$BLUE"
  rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
  TUSK_DRIFT_MODE=RECORD npm run dev &
  sleep 8
  run_benchmarks "sdk"
  pkill -f "node" || true
  log "Benchmark complete" "$GREEN"
  exit 0
fi

# Phase 2: Recording Traces
log "================================================" "$BLUE"
log "Phase 2: Recording Traces" "$BLUE"
log "================================================" "$BLUE"
log "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev &
sleep 8
log "Executing test requests..."
curl -s http://localhost:3000/health > /dev/null
curl -s http://localhost:3000/test/basic-query > /dev/null
curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/parameterized-query > /dev/null
curl -s http://localhost:3000/test/client-query > /dev/null
curl -s http://localhost:3000/test/client-connect > /dev/null
curl -s http://localhost:3000/test/client-close > /dev/null
curl -s http://localhost:3000/test/pool-query > /dev/null
curl -s -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/pool-parameterized > /dev/null
curl -s http://localhost:3000/test/pool-connect > /dev/null
curl -s http://localhost:3000/test/pool-transaction > /dev/null
curl -s http://localhost:3000/test/query-rowmode-array > /dev/null
curl -s http://localhost:3000/test/multi-statement > /dev/null
sleep 3
pkill -f "node" || true; sleep 2
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
