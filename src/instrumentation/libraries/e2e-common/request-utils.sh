#!/bin/bash

# Request utilities for E2E tests
# Provides make_request() with optional benchmark mode

# Colors for output
REQUEST_GREEN='\033[0;32m'
REQUEST_YELLOW='\033[1;33m'
REQUEST_NC='\033[0m'

# Benchmark mode configuration
BENCHMARK_DURATION=${BENCHMARK_DURATION:-5}

# Store benchmark results for later comparison
declare -a BENCHMARK_NAMES
declare -a BENCHMARK_OPS
declare -a BENCHMARK_NS_PER_OP
declare -a BENCHMARK_OPS_PER_SEC

# Reset benchmark results (call before each benchmark run)
reset_benchmark_results() {
  BENCHMARK_NAMES=()
  BENCHMARK_OPS=()
  BENCHMARK_NS_PER_OP=()
  BENCHMARK_OPS_PER_SEC=()
}

# Make HTTP request to the app container
# In normal mode: prints request info, executes curl, sleeps 0.5s
# In benchmark mode: runs tight loop for BENCHMARK_DURATION seconds, prints Go-style output
#
# Usage: make_request METHOD ENDPOINT [CURL_OPTIONS...]
# Example: make_request GET /health
# Example: make_request POST /api/data -H "Content-Type: application/json" -d '{"key":"value"}'
make_request() {
  local METHOD="$1"
  local ENDPOINT="$2"
  shift 2
  local CURL_OPTS=("$@")

  # Require PROJECT_NAME and APP_PORT to be set
  if [ -z "$PROJECT_NAME" ]; then
    echo "ERROR: PROJECT_NAME must be set before calling make_request"
    return 1
  fi

  local PORT="${APP_PORT:-3000}"
  local URL="http://localhost:${PORT}${ENDPOINT}"

  if [ -n "$BENCHMARKS" ]; then
    _run_benchmark "$METHOD" "$ENDPOINT" "$URL" "${CURL_OPTS[@]}"
  else
    _run_normal_request "$METHOD" "$ENDPOINT" "$URL" "${CURL_OPTS[@]}"
  fi
}

# Internal: Run a normal (non-benchmark) request
_run_normal_request() {
  local METHOD="$1"
  local ENDPOINT="$2"
  local URL="$3"
  shift 3
  local CURL_OPTS=("$@")

  echo "  - $METHOD $ENDPOINT"

  # Build curl command
  local CURL_CMD="curl -s -X $METHOD"
  if [ ${#CURL_OPTS[@]} -gt 0 ]; then
    for opt in "${CURL_OPTS[@]}"; do
      CURL_CMD="$CURL_CMD '$opt'"
    done
  fi
  CURL_CMD="$CURL_CMD '$URL'"

  # Execute inside container
  docker compose -p "$PROJECT_NAME" exec -T app sh -c "$CURL_CMD" > /dev/null

  # Small delay between requests
  sleep 0.5
}

# Internal: Run a benchmark for a single endpoint
_run_benchmark() {
  local METHOD="$1"
  local ENDPOINT="$2"
  local URL="$3"
  shift 3
  local CURL_OPTS=("$@")

  local BENCH_NAME="Benchmark_${METHOD}_${ENDPOINT}"
  # Replace slashes and special chars for cleaner names
  BENCH_NAME=$(echo "$BENCH_NAME" | tr '/' '_' | tr -d '{}')

  # Build curl command
  local CURL_CMD="curl -s -X $METHOD"
  if [ ${#CURL_OPTS[@]} -gt 0 ]; then
    for opt in "${CURL_OPTS[@]}"; do
      CURL_CMD="$CURL_CMD '$opt'"
    done
  fi
  CURL_CMD="$CURL_CMD '$URL'"

  # Run benchmark loop inside container for accurate timing
  # This script runs a tight loop and measures total time
  local BENCH_SCRIPT="
START_TIME=\$(date +%s%N)
END_TIME=\$((START_TIME + ${BENCHMARK_DURATION} * 1000000000))
COUNT=0
while [ \$(date +%s%N) -lt \$END_TIME ]; do
  $CURL_CMD > /dev/null 2>&1
  COUNT=\$((COUNT + 1))
done
ACTUAL_END=\$(date +%s%N)
ELAPSED_NS=\$((ACTUAL_END - START_TIME))
echo \"\$COUNT \$ELAPSED_NS\"
"

  # Run the benchmark
  local RESULT=$(docker compose -p "$PROJECT_NAME" exec -T app sh -c "$BENCH_SCRIPT" 2>/dev/null)

  local COUNT=$(echo "$RESULT" | awk '{print $1}')
  local ELAPSED_NS=$(echo "$RESULT" | awk '{print $2}')

  # Calculate metrics
  if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ] && [ -n "$ELAPSED_NS" ] && [ "$ELAPSED_NS" -gt 0 ]; then
    local NS_PER_OP=$((ELAPSED_NS / COUNT))
    # Calculate ops/sec with 2 decimal places using awk
    local OPS_PER_SEC=$(awk "BEGIN {printf \"%.2f\", $COUNT * 1000000000 / $ELAPSED_NS}")

    # Store results for comparison
    BENCHMARK_NAMES+=("$BENCH_NAME")
    BENCHMARK_OPS+=("$COUNT")
    BENCHMARK_NS_PER_OP+=("$NS_PER_OP")
    BENCHMARK_OPS_PER_SEC+=("$OPS_PER_SEC")

    # Print Go-style benchmark output
    printf "%-45s %5d %12d ns/op %10s ops/s\n" "$BENCH_NAME" "$COUNT" "$NS_PER_OP" "$OPS_PER_SEC"
  else
    printf "%-45s FAILED\n" "$BENCH_NAME"
  fi
}

# Print benchmark comparison table
# Uses global arrays: BASELINE_NAMES, BASELINE_OPS_PER_SEC, SDK_NAMES, SDK_OPS_PER_SEC
print_benchmark_comparison() {
  echo ""
  echo "======================================================================"
  echo "COMPARISON (negative = slower with SDK)"
  echo "======================================================================"
  printf "%-45s %12s %12s %10s\n" "Benchmark" "Baseline" "Current" "Diff"
  echo "----------------------------------------------------------------------"

  for i in "${!BASELINE_NAMES[@]}"; do
    local name="${BASELINE_NAMES[$i]}"
    local base_rate="${BASELINE_OPS_PER_SEC[$i]}"
    local curr_rate="${SDK_OPS_PER_SEC[$i]}"

    # Calculate percentage difference
    local diff=$(awk "BEGIN {
      if ($base_rate > 0) {
        diff = (($curr_rate - $base_rate) / $base_rate) * 100
        printf \"%.1f%%\", diff
      } else {
        print \"N/A\"
      }
    }")

    printf "%-45s %10s/s %10s/s %10s\n" "$name" "$base_rate" "$curr_rate" "$diff"
  done

  echo "======================================================================"
}
