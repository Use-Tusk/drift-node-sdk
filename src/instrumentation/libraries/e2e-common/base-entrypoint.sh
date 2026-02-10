#!/bin/bash
set -e -m -o pipefail

# Shared E2E Test Entrypoint for Node SDK
# Mirrors Python SDK's base_runner.py pattern.
#
# Usage: Set config vars then source this file from each variant's entrypoint.sh:
#
#   #!/bin/bash
#   SERVER_WAIT_TIME=5
#   source /app/base-entrypoint.sh
#
# For libraries with custom setup (e.g. prisma):
#
#   #!/bin/bash
#   SERVER_WAIT_TIME=10
#   setup_library() {
#     npx prisma generate
#     npx prisma db push --force-reset --skip-generate
#   }
#   source /app/base-entrypoint.sh
#
# Configuration (set before sourcing):
#   SERVER_WAIT_TIME  - Seconds to wait after starting server (default: 5)
#   setup_library()   - Optional hook for library-specific setup

SERVER_WAIT_TIME=${SERVER_WAIT_TIME:-5}

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${2:-$NC}$1${NC}"; }

# Stop the server and all its child processes (npm spawns node underneath)
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill -- -$SERVER_PID 2>/dev/null || kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    SERVER_PID=""
  fi
}
cleanup() {
  log "Stopping server..." "$YELLOW"
  stop_server
}
trap cleanup EXIT
SERVER_PID=""

# ============================================================
# Phase 1: Setup
# ============================================================
log "================================================" "$BLUE"
log "Phase 1: Setup" "$BLUE"
log "================================================" "$BLUE"

log "Installing dependencies..."
npm install --silent

# Call library-specific setup hook if defined
if type setup_library &>/dev/null; then
  log "Running library-specific setup..."
  setup_library
fi

log "Building TypeScript..."
npm run build --silent

# Clean traces/logs
rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
mkdir -p .tusk/traces .tusk/logs

log "Setup complete" "$GREEN"

# ============================================================
# Phase 2: Record Traces (or run benchmarks)
# ============================================================
if [ -n "$BENCHMARKS" ]; then
  DURATION=${BENCHMARK_DURATION:-5}
  WARMUP=${BENCHMARK_WARMUP:-3}
  BASELINE_OUTPUT=$(mktemp)
  SDK_OUTPUT=$(mktemp)

  log "================================================" "$BLUE"
  log "BASELINE (SDK DISABLED)" "$BLUE"
  log "Duration per endpoint: ${DURATION}s, Warmup: ${WARMUP}s" "$BLUE"
  log "================================================" "$BLUE"

  TUSK_DRIFT_MODE=DISABLED npm run dev &
  SERVER_PID=$!
  sleep "$SERVER_WAIT_TIME"

  BENCHMARKS="$BENCHMARKS" BENCHMARK_DURATION="$DURATION" BENCHMARK_WARMUP="$WARMUP" \
    node /app/src/test_requests.mjs | tee "$BASELINE_OUTPUT"

  stop_server
  sleep 2

  log ""
  log "================================================" "$BLUE"
  log "WITH SDK (TUSK_DRIFT_MODE=RECORD)" "$BLUE"
  log "================================================" "$BLUE"

  rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
  TUSK_DRIFT_MODE=RECORD npm run dev &
  SERVER_PID=$!
  sleep "$SERVER_WAIT_TIME"

  BENCHMARKS="$BENCHMARKS" BENCHMARK_DURATION="$DURATION" BENCHMARK_WARMUP="$WARMUP" \
    node /app/src/test_requests.mjs | tee "$SDK_OUTPUT"

  stop_server

  # Print comparison table
  log ""
  log "==============================================================================" "$BLUE"
  log "COMPARISON (negative = slower with SDK)" "$BLUE"
  log "==============================================================================" "$BLUE"
  printf "%-40s %12s %12s %10s\n" "Benchmark" "Baseline" "With SDK" "Diff"
  log "------------------------------------------------------------------------------"

  # Parse baseline results into parallel arrays
  BENCH_NAMES=()
  BENCH_BASELINE=()
  while IFS= read -r line; do
    name=$(echo "$line" | grep -oE '^Benchmark_\S+' || true)
    ops=$(echo "$line" | grep -oE '[0-9.]+\s+ops/s' | awk '{print $1}' || true)
    if [ -n "$name" ] && [ -n "$ops" ]; then
      BENCH_NAMES+=("$name")
      BENCH_BASELINE+=("$ops")
    fi
  done < "$BASELINE_OUTPUT"

  # Parse SDK results into associative-style lookup (using parallel array)
  SDK_NAMES=()
  SDK_OPS=()
  while IFS= read -r line; do
    name=$(echo "$line" | grep -oE '^Benchmark_\S+' || true)
    ops=$(echo "$line" | grep -oE '[0-9.]+\s+ops/s' | awk '{print $1}' || true)
    if [ -n "$name" ] && [ -n "$ops" ]; then
      SDK_NAMES+=("$name")
      SDK_OPS+=("$ops")
    fi
  done < "$SDK_OUTPUT"

  # Display comparison for each benchmark
  for i in "${!BENCH_NAMES[@]}"; do
    name="${BENCH_NAMES[$i]}"
    base_ops="${BENCH_BASELINE[$i]}"

    # Find matching SDK result
    sdk_ops=""
    for j in "${!SDK_NAMES[@]}"; do
      if [ "${SDK_NAMES[$j]}" = "$name" ]; then
        sdk_ops="${SDK_OPS[$j]}"
        break
      fi
    done

    if [ -z "$sdk_ops" ]; then
      printf "%-40s %10s/s %12s %10s\n" "$name" "$base_ops" "N/A" ""
      continue
    fi

    # Calculate percentage difference using awk
    diff_str=$(awk "BEGIN {
      diff = (($sdk_ops - $base_ops) / $base_ops) * 100;
      printf \"%+.1f%%\", diff
    }")

    diff_val=$(awk "BEGIN {
      print (($sdk_ops - $base_ops) / $base_ops) * 100
    }")

    # Color: red if >5% slower, yellow if slower, green if faster
    color="$GREEN"
    if awk "BEGIN { exit !($diff_val < -5) }"; then
      color="$RED"
    elif awk "BEGIN { exit !($diff_val < 0) }"; then
      color="$YELLOW"
    fi

    echo -e "${color}$(printf "%-40s %10s/s %10s/s %10s" "$name" "$base_ops" "$sdk_ops" "$diff_str")${NC}"
  done

  log "==============================================================================" "$BLUE"

  rm -f "$BASELINE_OUTPUT" "$SDK_OUTPUT"
  log ""
  log "Benchmark complete" "$GREEN"
  exit 0
fi

# Normal E2E test mode
log "================================================" "$BLUE"
log "Phase 2: Recording Traces" "$BLUE"
log "================================================" "$BLUE"

log "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev &
SERVER_PID=$!
sleep "$SERVER_WAIT_TIME"

log "Executing test requests..."
node /app/src/test_requests.mjs

log "Waiting for traces to flush..."
sleep 3

log "Stopping server..."
stop_server
sleep 2

TRACE_COUNT=$(ls -1 .tusk/traces/*.jsonl 2>/dev/null | wc -l)
log "Recorded $TRACE_COUNT trace files" "$GREEN"

if [ "$TRACE_COUNT" -eq 0 ]; then
  log "ERROR: No traces recorded!" "$RED"
  exit 1
fi

# ============================================================
# Phase 3: Run Tusk Tests
# ============================================================
log "================================================" "$BLUE"
log "Phase 3: Running Tusk Tests" "$BLUE"
log "================================================" "$BLUE"

set +e
TEST_OUTPUT=$(TUSK_ANALYTICS_DISABLED=1 tusk run --print --output-format json --enable-service-logs 2>&1)
TUSK_EXIT=$?
set -e

echo "$TEST_OUTPUT"

# Check tusk exit code
if [ $TUSK_EXIT -ne 0 ]; then
  log "Tusk tests failed with exit code $TUSK_EXIT" "$RED"
  exit 1
fi

# Parse results - count passed/failed
ALL_PASSED=$(echo "$TEST_OUTPUT" | grep -c '"passed":\s*true' || true)
ANY_FAILED=$(echo "$TEST_OUTPUT" | grep -c '"passed":\s*false' || true)

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

# ============================================================
# Phase 4: Check for warnings
# ============================================================
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
