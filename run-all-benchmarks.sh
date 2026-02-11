#!/bin/bash

# Script to run benchmarks for all Node SDK E2E instrumentation tests serially.
# Each instrumentation runs with BENCHMARKS=1, producing a comparison of
# SDK disabled vs enabled (RECORD mode) with Go-style ns/op stats.
#
# Usage:
#   ./run-all-benchmarks.sh                     # Run all, 5s per endpoint
#   ./run-all-benchmarks.sh -d 20               # Run all, 20s per endpoint
#   ./run-all-benchmarks.sh -w 5                # 5s warmup per endpoint
#   ./run-all-benchmarks.sh -f http,pg          # Run only http and pg
#   ./run-all-benchmarks.sh -h                  # Show help

set -e

# Default values
BENCHMARK_DURATION=${BENCHMARK_DURATION:-5}
BENCHMARK_WARMUP=${BENCHMARK_WARMUP:-3}
FILTER=""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Run SDK benchmarks for all (or selected) instrumentations serially."
  echo ""
  echo "Options:"
  echo "  -d, --duration N       Seconds per endpoint for timed loop (default: 5)"
  echo "  -w, --warmup N         Seconds of warmup per endpoint before timing (default: 3)"
  echo "  -f, --filter LIST      Comma-separated list of instrumentations to benchmark"
  echo "                         e.g. http,pg,ioredis"
  echo "  -h, --help             Show this help message"
  echo ""
  echo "Environment variables:"
  echo "  BENCHMARK_DURATION     Same as --duration"
  echo "  BENCHMARK_WARMUP       Same as --warmup"
  echo "  TUSK_CLI_VERSION       CLI version to use in Docker builds"
  echo ""
  echo "Examples:"
  echo "  $0                           # Benchmark all instrumentations"
  echo "  $0 -d 20                     # 20s per endpoint"
  echo "  $0 -f http,pg                # Only benchmark http and pg"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--duration)
      if [[ -z "$2" ]] || [[ "$2" == -* ]]; then
        echo "Error: --duration requires a number argument"
        exit 1
      fi
      BENCHMARK_DURATION="$2"
      shift 2
      ;;
    -w|--warmup)
      if [[ -z "$2" ]] || [[ "$2" == -* ]]; then
        echo "Error: --warmup requires a number argument"
        exit 1
      fi
      BENCHMARK_WARMUP="$2"
      shift 2
      ;;
    -f|--filter)
      if [[ -z "$2" ]] || [[ "$2" == -* ]]; then
        echo "Error: --filter requires a comma-separated list"
        exit 1
      fi
      FILTER="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown option $1"
      usage
      exit 1
      ;;
  esac
done

# Validate numbers
if ! [[ "$BENCHMARK_DURATION" =~ ^[0-9]+$ ]]; then
  echo "Error: --duration must be a positive integer"
  exit 1
fi

if ! [[ "$BENCHMARK_WARMUP" =~ ^[0-9]+$ ]]; then
  echo "Error: --warmup must be a positive integer"
  exit 1
fi

# Get the directory where this script is located (SDK root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Discover CJS variant run.sh scripts (one per library).
# Benchmarks only run the CJS variant to avoid CJS+ESM running in parallel
# and skewing results - the module system doesn't affect benchmark numbers.
ALL_SCRIPTS=($(find "$SCRIPT_DIR/src/instrumentation/libraries" -path "*/e2e-tests/cjs-*/run.sh" -type f | sort))

if [ ${#ALL_SCRIPTS[@]} -eq 0 ]; then
  echo -e "${RED}No e2e test scripts found!${NC}"
  exit 1
fi

# Apply filter if provided
RUN_SCRIPTS=()
RUN_NAMES=()
for script in "${ALL_SCRIPTS[@]}"; do
  # Extract library name from path: .../libraries/{name}/e2e-tests/cjs-{name}/run.sh
  NAME=$(echo "$script" | sed -E 's|.*/libraries/([^/]+)/e2e-tests/cjs-[^/]+/run.sh|\1|')
  if [ -n "$FILTER" ]; then
    # Check if NAME is in the comma-separated filter list
    if echo ",$FILTER," | grep -q ",$NAME,"; then
      RUN_SCRIPTS+=("$script")
      RUN_NAMES+=("$NAME")
    fi
  else
    RUN_SCRIPTS+=("$script")
    RUN_NAMES+=("$NAME")
  fi
done

NUM_TESTS=${#RUN_SCRIPTS[@]}

if [ $NUM_TESTS -eq 0 ]; then
  echo -e "${RED}No matching instrumentations found for filter: $FILTER${NC}"
  echo "Available: $(printf '%s\n' "${ALL_SCRIPTS[@]}" | sed -E 's|.*/libraries/([^/]+)/e2e-tests/cjs-[^/]+/run.sh|\1|' | tr '\n' ' ')"
  exit 1
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Node SDK Benchmarks${NC}"
echo -e "${BLUE}========================================${NC}"
echo "Instrumentations: ${RUN_NAMES[*]}"
echo "Duration per endpoint: ${BENCHMARK_DURATION}s"
echo "Warmup per endpoint: ${BENCHMARK_WARMUP}s"
echo "Total instrumentations: $NUM_TESTS"
echo -e "${BLUE}========================================${NC}"
echo ""

# Export benchmark env vars so they pass through to run.sh scripts
export BENCHMARKS=1
export BENCHMARK_DURATION
export BENCHMARK_WARMUP

# Track results
OVERALL_EXIT_CODE=0
declare -a EXIT_CODES

for i in "${!RUN_SCRIPTS[@]}"; do
  SCRIPT="${RUN_SCRIPTS[$i]}"
  NAME="${RUN_NAMES[$i]}"
  TEST_DIR=$(dirname "$SCRIPT")

  echo ""
  echo -e "${BLUE}============================================================${NC}"
  echo -e "${BLUE}[$((i + 1))/$NUM_TESTS] Benchmarking: $NAME${NC}"
  echo -e "${BLUE}============================================================${NC}"
  echo ""

  # Check if this library has been migrated to entrypoint pattern
  if [ ! -f "$TEST_DIR/entrypoint.sh" ]; then
    echo -e "${YELLOW}⚠ Skipping $NAME - not yet migrated to benchmark-compatible pattern${NC}"
    echo -e "${YELLOW}  (Only libraries with entrypoint.sh support benchmarks)${NC}"
    EXIT_CODES+=("0")
    continue
  fi

  chmod +x "$SCRIPT"

  set +e
  (cd "$TEST_DIR" && ./run.sh)
  EXIT_CODE=$?
  set -e

  # Cleanup any leftover containers from this library
  docker ps -aq --filter "name=${NAME}" 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true

  EXIT_CODES+=("$EXIT_CODE")

  if [ $EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Benchmark for $NAME failed with exit code $EXIT_CODE${NC}"
    OVERALL_EXIT_CODE=1
  fi

  echo ""
done

# Final summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Benchmark Summary${NC}"
echo -e "${BLUE}========================================${NC}"

for i in "${!RUN_NAMES[@]}"; do
  NAME="${RUN_NAMES[$i]}"
  EXIT_CODE="${EXIT_CODES[$i]}"

  if [ "$EXIT_CODE" -eq 0 ]; then
    echo -e "${GREEN}  ✓${NC} $NAME"
  else
    echo -e "${RED}  ✗${NC} $NAME (exit code $EXIT_CODE)"
  fi
done

echo -e "${BLUE}========================================${NC}"

if [ $OVERALL_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}All $NUM_TESTS benchmark(s) completed successfully.${NC}"
else
  echo -e "${RED}Some benchmarks failed.${NC}"
fi

echo ""
exit $OVERALL_EXIT_CODE
