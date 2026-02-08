#!/bin/bash

# Base runner for E2E tests
# Provides run_e2e_test() orchestration and benchmark mode support
#
# NOTE: Each run.sh should set up its own cleanup trap BEFORE sourcing this file.
# This ensures cleanup happens even if sourcing fails.

# Source other utilities
COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$COMMON_DIR/e2e-helpers.sh"
source "$COMMON_DIR/request-utils.sh"
source "$COMMON_DIR/service-waiters.sh"

# Default server wait time (can be overridden by get_server_wait_time in endpoints.sh)
DEFAULT_SERVER_WAIT_TIME=5

# Run E2E test for a library
# Args:
#   $1: PROJECT_SUFFIX - unique suffix for docker compose project (e.g., "http-cjs")
#   $2: LIBRARY_NAME - display name (e.g., "HTTP (CJS)")
#   $3: PORT - optional port (default: 3000)
run_e2e_test() {
  local PROJECT_SUFFIX="$1"
  local LIBRARY_NAME="$2"
  local PORT="${3:-3000}"

  # Export for use by make_request and other functions
  # (PROJECT_NAME already set by run_e2e_or_benchmark, but set here too for direct calls)
  export APP_PORT="$PORT"
  export PROJECT_NAME="${PROJECT_SUFFIX}-${PORT}"

  # Get server wait time (library can override via get_server_wait_time function)
  local SERVER_WAIT_TIME=$DEFAULT_SERVER_WAIT_TIME
  if type get_server_wait_time &>/dev/null; then
    SERVER_WAIT_TIME=$(get_server_wait_time)
  fi

  echo "Starting $LIBRARY_NAME E2E test run on port ${PORT}..."

  # Step 0: Clean up traces and logs
  echo "Step 0: Cleaning up traces and logs..."
  cleanup_tusk_files

  # Step 1: Start docker container
  echo "Step 1: Starting docker container..."
  docker compose -p "$PROJECT_NAME" build --no-cache
  docker compose -p "$PROJECT_NAME" up -d --quiet-pull

  # Wait for container to be ready
  echo "Waiting for container to be ready..."
  sleep 3

  # Step 2: Install dependencies (now that /sdk volume is mounted)
  echo "Step 2: Installing dependencies..."
  docker compose -p "$PROJECT_NAME" exec -T app npm install

  # Step 2.5: Wait for external services if needed (library can override)
  if type wait_for_services &>/dev/null; then
    echo "Step 2.5: Waiting for external services..."
    wait_for_services
  fi

  # Step 3: Start server in RECORD mode
  echo "Step 3: Starting server in RECORD mode..."
  docker compose -p "$PROJECT_NAME" exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

  # Wait for server to start
  echo "Waiting for server to start..."
  sleep "$SERVER_WAIT_TIME"

  # Step 4: Hit all endpoints
  echo "Step 4: Hitting all endpoints..."
  define_endpoints
  echo "All endpoints hit successfully."

  # Step 5: Wait before stopping server
  echo "Step 5: Waiting 3 seconds before stopping server..."
  sleep 3

  # Stop the server process
  echo "Stopping server..."
  docker compose -p "$PROJECT_NAME" exec -T app pkill -f "node" || true
  sleep 2

  # Step 6: Run tests using tusk CLI
  echo "Step 6: Running tests using tusk CLI..."
  TEST_RESULTS=$(docker compose -p "$PROJECT_NAME" exec -T -e TUSK_ANALYTICS_DISABLED=1 app tusk run --print --output-format "json" --enable-service-logs)

  # Step 7: Log test results
  parse_and_display_test_results "$TEST_RESULTS"

  # Step 7.5: Check for TCP instrumentation warning in logs
  check_tcp_instrumentation_warning "$PROJECT_NAME"

  # Step 8: Clean up docker containers
  # (trap in run.sh will also fire on exit, but that's OK - down on already-down project is a no-op)
  echo ""
  echo "Step 8: Cleaning up docker containers..."
  docker compose -p "$PROJECT_NAME" down -v

  # Step 9: Clean up traces and logs
  echo "Step 9: Cleaning up traces and logs..."
  cleanup_tusk_files

  echo "$LIBRARY_NAME E2E test run complete."

  return $EXIT_CODE
}

# Run benchmarks for a library (SDK disabled vs enabled comparison)
# Args:
#   $1: PROJECT_SUFFIX - unique suffix for docker compose project
#   $2: LIBRARY_NAME - display name
#   $3: PORT - optional port (default: 3000)
run_benchmarks() {
  local PROJECT_SUFFIX="$1"
  local LIBRARY_NAME="$2"
  local PORT="${3:-3000}"

  # Export for use by make_request
  # (PROJECT_NAME already set by run_e2e_or_benchmark, but set here too for direct calls)
  export APP_PORT="$PORT"
  export PROJECT_NAME="${PROJECT_SUFFIX}-${PORT}"

  # Get server wait time
  local SERVER_WAIT_TIME=$DEFAULT_SERVER_WAIT_TIME
  if type get_server_wait_time &>/dev/null; then
    SERVER_WAIT_TIME=$(get_server_wait_time)
  fi

  echo ""
  echo "============================================================"
  echo "BENCHMARKING: $LIBRARY_NAME"
  echo "Duration per endpoint: ${BENCHMARK_DURATION}s"
  echo "============================================================"
  echo ""

  # Clean up traces (pre-cleanup of containers done by run.sh)
  cleanup_tusk_files

  # Step 1: Start docker container
  echo "Setting up environment..."
  docker compose -p "$PROJECT_NAME" build --no-cache
  docker compose -p "$PROJECT_NAME" up -d --quiet-pull
  sleep 3

  # Step 2: Install dependencies
  docker compose -p "$PROJECT_NAME" exec -T app npm install

  # Step 2.5: Wait for external services if needed
  if type wait_for_services &>/dev/null; then
    echo "Waiting for external services..."
    wait_for_services
  fi

  # ============================================================
  # RUN 1: BASELINE (SDK DISABLED)
  # ============================================================
  echo ""
  echo "============================================================"
  echo "BASELINE (SDK DISABLED)"
  echo "============================================================"

  # Start server with SDK disabled
  docker compose -p "$PROJECT_NAME" exec -d -T -e TUSK_DRIFT_MODE=DISABLED app sh -c "npm run build && npm run dev"
  sleep "$SERVER_WAIT_TIME"

  # Run benchmarks and store results
  reset_benchmark_results
  define_endpoints

  # Copy baseline results to global arrays for comparison
  BASELINE_NAMES=("${BENCHMARK_NAMES[@]}")
  BASELINE_OPS=("${BENCHMARK_OPS[@]}")
  BASELINE_NS_PER_OP=("${BENCHMARK_NS_PER_OP[@]}")
  BASELINE_OPS_PER_SEC=("${BENCHMARK_OPS_PER_SEC[@]}")

  # Stop server
  docker compose -p "$PROJECT_NAME" exec -T app pkill -f "node" || true
  sleep 2

  # ============================================================
  # RUN 2: WITH SDK (TUSK_DRIFT_MODE=RECORD)
  # ============================================================
  echo ""
  echo "============================================================"
  echo "WITH SDK (TUSK_DRIFT_MODE=RECORD)"
  echo "============================================================"

  # Clean traces for fresh recording
  cleanup_tusk_files

  # Start server with SDK enabled
  docker compose -p "$PROJECT_NAME" exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"
  sleep "$SERVER_WAIT_TIME"

  # Run benchmarks
  reset_benchmark_results
  define_endpoints

  # Copy SDK results to global arrays for comparison
  SDK_NAMES=("${BENCHMARK_NAMES[@]}")
  SDK_OPS=("${BENCHMARK_OPS[@]}")
  SDK_NS_PER_OP=("${BENCHMARK_NS_PER_OP[@]}")
  SDK_OPS_PER_SEC=("${BENCHMARK_OPS_PER_SEC[@]}")

  # Stop server
  docker compose -p "$PROJECT_NAME" exec -T app pkill -f "node" || true
  sleep 2

  # ============================================================
  # Print Comparison
  # ============================================================
  print_benchmark_comparison

  # Clean up docker containers
  # (trap in run.sh will also fire on exit, but that's OK - down on already-down project is a no-op)
  echo ""
  echo "Cleaning up..."
  docker compose -p "$PROJECT_NAME" down -v
  cleanup_tusk_files

  echo ""
  echo "Benchmark complete for $LIBRARY_NAME"
}

# Entry point: run E2E test or benchmark based on BENCHMARKS env var
# Args:
#   $1: PROJECT_SUFFIX - unique suffix for docker compose project
#   $2: LIBRARY_NAME - display name
#   $3: PORT - optional port (default: 3000)
#
# NOTE: Caller (run.sh) must set PROJECT_NAME and cleanup trap BEFORE calling this
run_e2e_or_benchmark() {
  local PROJECT_SUFFIX="$1"
  local LIBRARY_NAME="$2"
  local PORT="${3:-3000}"

  # Ensure PROJECT_NAME is set (should be set by run.sh already)
  export APP_PORT="$PORT"
  export PROJECT_NAME="${PROJECT_SUFFIX}-${PORT}"

  if [ -n "$BENCHMARKS" ]; then
    run_benchmarks "$PROJECT_SUFFIX" "$LIBRARY_NAME" "$PORT"
    exit 0
  else
    run_e2e_test "$PROJECT_SUFFIX" "$LIBRARY_NAME" "$PORT"
    exit $?
  fi
}
