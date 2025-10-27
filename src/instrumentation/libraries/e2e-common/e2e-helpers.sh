#!/bin/bash

# Common helpers for E2E test scripts
# Source this file from individual run.sh scripts

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Clean up traces and logs
cleanup_tusk_files() {
  echo "Cleaning up traces and logs..."
  if [ -n "$CI" ]; then
    # In CI, use sudo since files are owned by root from Docker
    sudo rm -rf .tusk/traces/* 2>/dev/null || true
    sudo rm -rf .tusk/logs/* 2>/dev/null || true
  else
    # Locally, use regular rm
    rm -rf .tusk/traces/* 2>/dev/null || true
    rm -rf .tusk/logs/* 2>/dev/null || true
  fi
  echo "Cleanup complete."
}

# Parse JSON test results and display with colored check marks
# Args:
#   $1: TEST_RESULTS JSON string
# Returns:
#   Sets EXIT_CODE global variable
parse_and_display_test_results() {
  local TEST_RESULTS="$1"

  echo ""
  echo "======================================"
  echo "Test Results:"
  echo "======================================"

  # Extract JSON objects from output
  # Find the section containing JSON (between first { and last })
  # Use sed to extract from first line with { to end, then use jq to parse
  local JSON_ARRAY=$(echo "$TEST_RESULTS" | sed -n '/^[[:space:]]*{/,$p' | jq -s '[.[] | select(type == "object")]')

  # Parse JSON results and display with colored check marks
  echo "$JSON_ARRAY" | jq -r '.[] | "\(.test_id) \(.passed) \(.duration)"' | while read -r test_id passed duration; do
    if [ "$passed" = "true" ]; then
      echo -e "${GREEN}✓${NC} Test ID: $test_id (Duration: ${duration}ms)"
    else
      echo -e "${RED}✗${NC} Test ID: $test_id (Duration: ${duration}ms)"
    fi
  done

  echo "======================================"

  # Check if all tests passed
  ALL_PASSED=$(echo "$JSON_ARRAY" | jq -r 'all(.passed)')
  if [ "$ALL_PASSED" = "true" ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    EXIT_CODE=0
  else
    echo -e "${RED}Some tests failed!${NC}"
    EXIT_CODE=1
  fi
}

# Check for TCP instrumentation warnings in logs
# Args:
#   $1: PROJECT_NAME (optional, for docker compose -p flag)
# Returns:
#   Updates EXIT_CODE global variable if warning found
check_tcp_instrumentation_warning() {
  local PROJECT_NAME="$1"
  local DOCKER_COMPOSE_CMD="docker compose"

  # Add project name flag if provided
  if [ -n "$PROJECT_NAME" ]; then
    DOCKER_COMPOSE_CMD="docker compose -p $PROJECT_NAME"
  fi

  echo ""
  echo "Checking for TCP instrumentation warnings..."
  FIRST_LOG_FILE=$($DOCKER_COMPOSE_CMD exec -T app ls -1 .tusk/logs 2>/dev/null | head -n 1)
  if [ -n "$FIRST_LOG_FILE" ]; then
    if $DOCKER_COMPOSE_CMD exec -T app grep -q "\[TcpInstrumentation\] TCP called from inbound request context, likely unpatched dependency" .tusk/logs/"$FIRST_LOG_FILE" 2>/dev/null; then
      echo -e "${RED}✗ ERROR: Found TCP instrumentation warning in logs!${NC}"
      echo -e "${RED}  This indicates an unpatched dependency is making TCP calls.${NC}"
      EXIT_CODE=1
    else
      echo -e "${GREEN}✓ No TCP instrumentation warnings found.${NC}"
    fi
  else
    echo -e "${RED}✗ ERROR: No log files found, skipping TCP warning check.${NC}"
    EXIT_CODE=1
  fi

  echo "Checking for traces files..."
  FIRST_TRACE_FILE=$($DOCKER_COMPOSE_CMD exec -T app ls -1 .tusk/traces 2>/dev/null | head -n 1)
  if [ -n "$FIRST_TRACE_FILE" ]; then
    echo -e "${GREEN}✓ Found trace files.${NC}"
  else
    echo -e "${RED}✗ ERROR: No traces found!${NC}"
    EXIT_CODE=1
  fi

}

# Run all E2E tests in a library's e2e-tests directory
# Args:
#   $1: E2E tests directory path
#   $2: Library name (e.g., "ioredis", "fetch")
#   $3: Base port (optional, default: 3000)
#   $4: Run mode (optional, "sequential" or "parallel", default: "parallel")
# Returns:
#   Exit code 0 if all tests pass, 1 if any test fails
run_all_e2e_tests() {
  local E2E_TESTS_DIR="$1"
  local LIBRARY_NAME="$2"
  local BASE_PORT="${3:-3000}"
  local RUN_MODE="${4:-parallel}"

  # Find all test variant directories (cjs-*, esm-*) and filter out non-directories
  local TEST_DIRS=()
  for dir in "$E2E_TESTS_DIR"/*-*; do
    if [ -d "$dir" ] && [ -f "$dir/run.sh" ]; then
      TEST_DIRS+=("$(basename "$dir")")
    fi
  done
  # Sort the array
  IFS=$'\n' TEST_DIRS=($(sort <<<"${TEST_DIRS[*]}"))
  unset IFS
  local NUM_TESTS=${#TEST_DIRS[@]}

  if [ $NUM_TESTS -eq 0 ]; then
    echo -e "${RED}No test directories found in $E2E_TESTS_DIR${NC}"
    return 1
  fi

  echo ""
  echo "========================================"
  echo "Running all E2E tests for: $LIBRARY_NAME"
  echo "Found $NUM_TESTS test variant(s): ${TEST_DIRS[*]}"
  echo "Base port: $BASE_PORT"
  echo "Run mode: $RUN_MODE"
  echo "========================================"
  echo ""

  # Save current buildx builder and switch to default for parallel builds
  local ORIGINAL_BUILDER=$(docker buildx inspect 2>/dev/null | grep "^Name:" | awk '{print $2}' || echo "")
  if [ -n "$ORIGINAL_BUILDER" ] && [ "$RUN_MODE" = "parallel" ]; then
    echo "Switching to default Docker builder for parallel builds..."
    docker buildx use default 2>/dev/null || true
  fi

  # Track results
  declare -a TEST_RESULTS
  declare -a TEST_PORTS
  declare -a TEST_EXIT_CODES
  declare -a TEST_PIDS
  local CURRENT_PORT=$BASE_PORT
  local OVERALL_EXIT_CODE=0

  # Create temporary directory for test outputs
  local TEMP_DIR=$(mktemp -d)
  trap "rm -rf $TEMP_DIR" EXIT

  if [ "$RUN_MODE" = "sequential" ]; then
    # Run tests sequentially
    for i in "${!TEST_DIRS[@]}"; do
      local TEST_DIR="${TEST_DIRS[$i]}"
      local TEST_INDEX=$((i + 1))
      local RUN_SCRIPT="$E2E_TESTS_DIR/$TEST_DIR/run.sh"
      local TEST_PORT=$((BASE_PORT + i))

      echo ""
      echo "========================================="
      echo "[$TEST_INDEX/$NUM_TESTS] Running $TEST_DIR on port $TEST_PORT..."
      echo "========================================="

      # Check if run.sh exists
      if [ ! -f "$RUN_SCRIPT" ]; then
        echo -e "${RED}✗ Error: run.sh not found at $RUN_SCRIPT${NC}"
        TEST_RESULTS+=("$TEST_DIR")
        TEST_PORTS+=("$TEST_PORT")
        TEST_EXIT_CODES+=(1)
        OVERALL_EXIT_CODE=1
        continue
      fi

      # Make sure run.sh is executable
      chmod +x "$RUN_SCRIPT"

      # Run test and capture exit code
      cd "$E2E_TESTS_DIR/$TEST_DIR" && ./run.sh "$TEST_PORT"
      local EXIT_CODE=$?

      TEST_RESULTS+=("$TEST_DIR")
      TEST_PORTS+=("$TEST_PORT")
      TEST_EXIT_CODES+=($EXIT_CODE)

      if [ $EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $TEST_DIR (port $TEST_PORT) completed successfully"
      else
        echo -e "${RED}✗${NC} $TEST_DIR (port $TEST_PORT) failed with exit code $EXIT_CODE"
        OVERALL_EXIT_CODE=1
      fi
      echo ""
    done
  else
    # Launch all tests in parallel
    for i in "${!TEST_DIRS[@]}"; do
      local TEST_DIR="${TEST_DIRS[$i]}"
      local TEST_INDEX=$((i + 1))
      local RUN_SCRIPT="$E2E_TESTS_DIR/$TEST_DIR/run.sh"
      local TEST_PORT=$((BASE_PORT + i))

      echo ""
      echo "========================================="
      echo "[$TEST_INDEX/$NUM_TESTS] Starting $TEST_DIR on port $TEST_PORT..."
      echo "========================================="

      # Check if run.sh exists
      if [ ! -f "$RUN_SCRIPT" ]; then
        echo -e "${RED}✗ Error: run.sh not found at $RUN_SCRIPT${NC}"
        TEST_RESULTS+=("$TEST_DIR")
        TEST_PORTS+=("$TEST_PORT")
        TEST_EXIT_CODES+=(1)
        TEST_PIDS+=(0)
        OVERALL_EXIT_CODE=1
        continue
      fi

      # Make sure run.sh is executable
      chmod +x "$RUN_SCRIPT"

      # Run test in background and capture output
      local OUTPUT_FILE="$TEMP_DIR/${TEST_DIR}.log"
      local EXIT_CODE_FILE="$TEMP_DIR/${TEST_DIR}.exit"

      # Run without script command to properly capture exit codes
      # Disable 'set -e' in subshell to ensure exit code is always written
      (set +e; cd "$E2E_TESTS_DIR/$TEST_DIR" && ./run.sh "$TEST_PORT" > "$OUTPUT_FILE" 2>&1; EXIT=$?; echo $EXIT > "$EXIT_CODE_FILE"; exit $EXIT) &
      local PID=$!

      TEST_RESULTS+=("$TEST_DIR")
      TEST_PORTS+=("$TEST_PORT")
      TEST_PIDS+=("$PID")
      echo "Started in background (PID: $PID)"
    done

    echo ""
    echo "========================================"
    echo "Waiting for all tests to complete..."
    echo "========================================"
    echo ""

    # Wait for all background jobs and collect exit codes
    for i in "${!TEST_PIDS[@]}"; do
      local PID="${TEST_PIDS[$i]}"
      local TEST_DIR="${TEST_RESULTS[$i]}"
      local TEST_PORT="${TEST_PORTS[$i]}"
      local OUTPUT_FILE="$TEMP_DIR/${TEST_DIR}.log"

      if [ "$PID" -eq 0 ]; then
        # Test was skipped due to missing run.sh
        TEST_EXIT_CODES+=(1)
        continue
      fi

      # Wait for specific PID
      wait "$PID" 2>/dev/null || true

      # Wait for the exit file to exist (with timeout)
      local TIMEOUT=10
      local ELAPSED=0
      while [ ! -f "$TEMP_DIR/${TEST_DIR}.exit" ] && [ $ELAPSED -lt $TIMEOUT ]; do
        sleep 0.1
        ELAPSED=$((ELAPSED + 1))
      done

      # Read the actual exit code from the file
      local EXIT_CODE_FILE="$TEMP_DIR/${TEST_DIR}.exit"
      local ACTUAL_EXIT_CODE=1
      if [ -f "$EXIT_CODE_FILE" ]; then
        ACTUAL_EXIT_CODE=$(cat "$EXIT_CODE_FILE")
      fi

      TEST_EXIT_CODES+=($ACTUAL_EXIT_CODE)

      if [ $ACTUAL_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $TEST_DIR (port $TEST_PORT) completed successfully"
      else
        echo -e "${RED}✗${NC} $TEST_DIR (port $TEST_PORT) failed with exit code $ACTUAL_EXIT_CODE"
        OVERALL_EXIT_CODE=1
      fi

      # Show output from the test
      echo ""
      echo "--- Output from $TEST_DIR ---"
      if [ -f "$OUTPUT_FILE" ]; then
        cat "$OUTPUT_FILE"
      else
        echo "(No log file found)"
      fi
      echo "--- End of output from $TEST_DIR ---"
      echo ""
    done
  fi

  # Display summary
  echo ""
  echo ""
  echo "========================================"
  echo "Summary:"
  echo "========================================"

  for i in "${!TEST_RESULTS[@]}"; do
    local TEST_NAME="${TEST_RESULTS[$i]}"
    local TEST_PORT="${TEST_PORTS[$i]}"
    local TEST_CODE="${TEST_EXIT_CODES[$i]}"

    if [ $TEST_CODE -eq 0 ]; then
      echo -e "${GREEN}✓${NC} $TEST_NAME (port $TEST_PORT)"
    else
      echo -e "${RED}✗${NC} $TEST_NAME (port $TEST_PORT)"
    fi
  done

  echo "========================================"

  if [ $OVERALL_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All $NUM_TESTS test variant(s) passed!${NC}"
  else
    echo -e "${RED}✗ Some tests failed!${NC}"
  fi

  echo "========================================"
  echo ""

  # Restore original buildx builder if it was changed
  if [ -n "$ORIGINAL_BUILDER" ] && [ "$ORIGINAL_BUILDER" != "default" ] && [ "$RUN_MODE" = "parallel" ]; then
    echo "Restoring original Docker builder: $ORIGINAL_BUILDER"
    docker buildx use "$ORIGINAL_BUILDER" 2>/dev/null || true
  fi

  return $OVERALL_EXIT_CODE
}
