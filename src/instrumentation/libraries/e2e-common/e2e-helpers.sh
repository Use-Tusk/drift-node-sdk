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
  rm -rf .tusk/traces/*
  rm -rf .tusk/logs/*
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

  # Parse JSON results and display with colored check marks
  echo "$TEST_RESULTS" | jq -r '.[] | "\(.test_id) \(.passed) \(.duration)"' | while read -r test_id passed duration; do
    if [ "$passed" = "true" ]; then
      echo -e "${GREEN}✓${NC} Test ID: $test_id (Duration: ${duration}ms)"
    else
      echo -e "${RED}✗${NC} Test ID: $test_id (Duration: ${duration}ms)"
    fi
  done

  echo "======================================"

  # Check if all tests passed
  ALL_PASSED=$(echo "$TEST_RESULTS" | jq -r 'all(.passed)')
  if [ "$ALL_PASSED" = "true" ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    EXIT_CODE=0
  else
    echo -e "${RED}Some tests failed!${NC}"
    EXIT_CODE=1
  fi
}

# Check for TCP instrumentation warnings in logs
# Returns:
#   Updates EXIT_CODE global variable if warning found
check_tcp_instrumentation_warning() {
  echo ""
  echo "Checking for TCP instrumentation warnings..."
  FIRST_LOG_FILE=$(docker-compose exec -T app ls -1 .tusk/logs 2>/dev/null | head -n 1)
  if [ -n "$FIRST_LOG_FILE" ]; then
    if docker-compose exec -T app grep -q "\[TcpInstrumentation\] TCP called from inbound request context, likely unpatched dependency" .tusk/logs/"$FIRST_LOG_FILE" 2>/dev/null; then
      echo -e "${RED}✗ WARNING: Found TCP instrumentation warning in logs!${NC}"
      echo -e "${RED}  This indicates an unpatched dependency is making TCP calls.${NC}"
      EXIT_CODE=1
    else
      echo -e "${GREEN}✓ No TCP instrumentation warnings found.${NC}"
    fi
  else
    echo -e "${YELLOW}⚠ No log files found, skipping TCP warning check.${NC}"
  fi
}
