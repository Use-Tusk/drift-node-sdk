#!/bin/bash

# Script to run all E2E tests for all instrumentation libraries
# This script discovers and runs all run-all.sh scripts with controlled concurrency
#
# Usage: ./run-all-e2e-tests.sh [MAX_CONCURRENT]
#   MAX_CONCURRENT: Number of tests to run concurrently (default: unlimited/all in parallel)
#
# Examples:
#   ./run-all-e2e-tests.sh     # Run all tests in parallel
#   ./run-all-e2e-tests.sh 2   # Run 2 tests concurrently
#   ./run-all-e2e-tests.sh 1   # Run tests sequentially

set -e

# Parse arguments
MAX_CONCURRENT=${1:-0}  # 0 means unlimited (all in parallel)

# Validate MAX_CONCURRENT is a number
if ! [[ "$MAX_CONCURRENT" =~ ^[0-9]+$ ]]; then
  echo "Error: MAX_CONCURRENT must be a positive integer"
  echo "Usage: $0 [MAX_CONCURRENT]"
  exit 1
fi

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find all run-all.sh scripts
RUN_ALL_SCRIPTS=($(find "$SCRIPT_DIR/src/instrumentation/libraries" -path "*/e2e-tests/run-all.sh" -type f | sort))
NUM_LIBRARIES=${#RUN_ALL_SCRIPTS[@]}

if [ $NUM_LIBRARIES -eq 0 ]; then
  echo -e "${RED}No run-all.sh scripts found!${NC}"
  exit 1
fi

# Extract library names
LIBRARY_NAMES=()
for script in "${RUN_ALL_SCRIPTS[@]}"; do
  # Extract library name from path: src/instrumentation/libraries/{name}/e2e-tests/run-all.sh
  LIBRARY_NAME=$(echo "$script" | sed -E 's|.*/libraries/([^/]+)/e2e-tests/run-all.sh|\1|')
  LIBRARY_NAMES+=("$LIBRARY_NAME")
done

echo ""
echo "========================================"
echo "Running E2E Tests for All Libraries"
echo "========================================"
echo "Found $NUM_LIBRARIES libraries: ${LIBRARY_NAMES[*]}"
if [ $MAX_CONCURRENT -eq 0 ]; then
  echo "Concurrency: Unlimited (all in parallel)"
else
  echo "Concurrency: $MAX_CONCURRENT at a time"
fi
echo ""
echo "Base port allocation:"
for i in "${!LIBRARY_NAMES[@]}"; do
  BASE_PORT=$((3000 + i * 10))
  echo "  ${LIBRARY_NAMES[$i]}: $BASE_PORT"
done
echo "========================================"
echo ""

# Save current buildx builder and switch to default for parallel builds
ORIGINAL_BUILDER=$(docker buildx inspect 2>/dev/null | grep "^Name:" | awk '{print $2}' || echo "")
if [ -n "$ORIGINAL_BUILDER" ]; then
  echo "Switching to default Docker builder for parallel builds..."
  docker buildx use default 2>/dev/null || true
  echo ""
fi

# Create temporary directory for outputs
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Track results
declare -a LIBRARY_PIDS
declare -a LIBRARY_PORTS
declare -a LIBRARY_EXIT_CODES

# Function to wait for any background job to complete
wait_for_any_job() {
  # Wait for any job and return its PID
  local pid
  while true; do
    for pid in "${LIBRARY_PIDS[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        # Found a completed PID, now actually wait for it
        wait "$pid" 2>/dev/null || true
        return 0
      fi
    done
    sleep 0.1
  done
}

# Launch all library tests with controlled concurrency
RUNNING_COUNT=0
for i in "${!RUN_ALL_SCRIPTS[@]}"; do
  SCRIPT="${RUN_ALL_SCRIPTS[$i]}"
  LIBRARY="${LIBRARY_NAMES[$i]}"
  BASE_PORT=$((3000 + i * 10))
  OUTPUT_FILE="$TEMP_DIR/${LIBRARY}.log"

  # If we have a concurrency limit and reached it, wait for a job to complete
  if [ $MAX_CONCURRENT -gt 0 ] && [ $RUNNING_COUNT -ge $MAX_CONCURRENT ]; then
    echo "Concurrency limit ($MAX_CONCURRENT) reached. Waiting for a test to complete..."
    wait_for_any_job
    RUNNING_COUNT=$((RUNNING_COUNT - 1))
  fi

  echo "========================================="
  echo "[$((i + 1))/$NUM_LIBRARIES] Starting $LIBRARY tests on base port $BASE_PORT..."
  echo "========================================="

  # Make script executable
  chmod +x "$SCRIPT"

  # Run in background
  EXIT_CODE_FILE="$TEMP_DIR/${LIBRARY}.exit"

  # Run without script command to properly capture exit codes
  # Disable 'set -e' in subshell to ensure exit code is always written
  (set +e; "$SCRIPT" "$BASE_PORT" > "$OUTPUT_FILE" 2>&1; EXIT=$?; echo $EXIT > "$EXIT_CODE_FILE"; exit $EXIT) &
  PID=$!

  LIBRARY_PIDS+=("$PID")
  LIBRARY_PORTS+=("$BASE_PORT")
  RUNNING_COUNT=$((RUNNING_COUNT + 1))

  echo "Started in background (PID: $PID)"
  echo ""
done

echo "========================================"
echo "Waiting for all library tests to complete..."
echo "========================================"
echo ""

# Wait for all background jobs and collect exit codes
OVERALL_EXIT_CODE=0
for i in "${!LIBRARY_PIDS[@]}"; do
  PID="${LIBRARY_PIDS[$i]}"
  LIBRARY="${LIBRARY_NAMES[$i]}"
  BASE_PORT="${LIBRARY_PORTS[$i]}"
  OUTPUT_FILE="$TEMP_DIR/${LIBRARY}.log"

  # Wait for specific PID
  wait "$PID"

  # Read the actual exit code from the file
  EXIT_CODE_FILE="$TEMP_DIR/${LIBRARY}.exit"
  ACTUAL_EXIT_CODE=1
  if [ -f "$EXIT_CODE_FILE" ]; then
    ACTUAL_EXIT_CODE=$(cat "$EXIT_CODE_FILE")
  fi

  LIBRARY_EXIT_CODES+=($ACTUAL_EXIT_CODE)

  if [ $ACTUAL_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $LIBRARY (base port $BASE_PORT) completed successfully"
  else
    echo -e "${RED}✗${NC} $LIBRARY (base port $BASE_PORT) failed with exit code $ACTUAL_EXIT_CODE"
    OVERALL_EXIT_CODE=1
  fi

  # Show output from the library tests
  echo ""
  echo "--- Output from $LIBRARY ---"
  cat "$OUTPUT_FILE"
  echo "--- End of output from $LIBRARY ---"
  echo ""
done

# Display final summary
echo ""
echo ""
echo "========================================"
echo "Final Summary"
echo "========================================"

for i in "${!LIBRARY_NAMES[@]}"; do
  LIBRARY="${LIBRARY_NAMES[$i]}"
  BASE_PORT="${LIBRARY_PORTS[$i]}"
  EXIT_CODE="${LIBRARY_EXIT_CODES[$i]}"

  if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $LIBRARY (base port $BASE_PORT)"
  else
    echo -e "${RED}✗${NC} $LIBRARY (base port $BASE_PORT)"
  fi
done

echo "========================================"

if [ $OVERALL_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✓ All $NUM_LIBRARIES libraries passed!${NC}"
else
  echo -e "${RED}✗ Some libraries failed!${NC}"
fi

echo "========================================"
echo ""

# Restore original buildx builder if it was changed
if [ -n "$ORIGINAL_BUILDER" ] && [ "$ORIGINAL_BUILDER" != "default" ]; then
  echo "Restoring original Docker builder: $ORIGINAL_BUILDER"
  docker buildx use "$ORIGINAL_BUILDER" 2>/dev/null || true
fi

exit $OVERALL_EXIT_CODE
