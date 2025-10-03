#!/bin/bash

# Running from the root of the SDK

# Usage: ./integration-test-runner/run-all-instrumentation-tests.sh [library]
# Example: ./integration-test-runner/run-all-instrumentation-tests.sh        # Run all instrumentation integration tests
# Example: ./integration-test-runner/run-all-instrumentation-tests.sh pg     # Run pg instrumentation tests only

# Remove set -e to prevent early exit on test failures
# set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTRUMENTATION_DIR="$SDK_ROOT_DIR/src/instrumentation/libraries"

LIBRARY_FILTER=${1:-""}

if [ ! -d "$INSTRUMENTATION_DIR" ]; then
    echo "Error: Instrumentation directory not found at $INSTRUMENTATION_DIR"
    exit 1
fi

# Install dependencies if needed (using main package.json)
cd "$SDK_ROOT_DIR"
if [ ! -d "node_modules" ] || [ ! -d "node_modules/ts-node" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "=== Tusk Drift SDK Instrumentation Integration Tests ==="
echo "Instrumentation directory: $INSTRUMENTATION_DIR"

total_passed=0
total_failed=0
failed_tests=()

# Function to run tests for a specific instrumentation
run_instrumentation_test() {
    local library=$1
    local test_path=$2

    echo ""
    echo "🧪 Testing $library instrumentation"
    echo "────────────────────────────────────────"

    # Run the test and capture exit code without affecting script execution
    "$SCRIPT_DIR/run-instrumentation-tests.sh" "$test_path"
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo "✅ $library instrumentation - PASSED"
        ((total_passed++))
    else
        echo "❌ $library instrumentation - FAILED"
        ((total_failed++))
        failed_tests+=("$library instrumentation")
    fi
}

# If a specific library is provided, run tests for that library only
if [ -n "$LIBRARY_FILTER" ]; then
    LIBRARY_PATH="$INSTRUMENTATION_DIR/$LIBRARY_FILTER"
    INTEGRATION_TESTS_PATH="$LIBRARY_PATH/integration-tests"

    if [ ! -d "$LIBRARY_PATH" ]; then
        echo "Error: Library '$LIBRARY_FILTER' not found"
        echo "Available libraries:"
        ls -1 "$INSTRUMENTATION_DIR" 2>/dev/null || echo "No libraries found"
        exit 1
    fi

    if [ ! -d "$INTEGRATION_TESTS_PATH" ] || [ ! -f "$INTEGRATION_TESTS_PATH/test-config.json" ]; then
        echo "Error: Integration tests not found for library '$LIBRARY_FILTER'"
        echo "Expected: $INTEGRATION_TESTS_PATH/test-config.json"
        exit 1
    fi

    run_instrumentation_test "$LIBRARY_FILTER" "$INTEGRATION_TESTS_PATH"
else
    # Run all instrumentation tests
    for library_dir in "$INSTRUMENTATION_DIR"/*; do
        if [ ! -d "$library_dir" ]; then
            continue
        fi

        library=$(basename "$library_dir")
        integration_tests_path="$library_dir/integration-tests"

        # Check if the library has integration tests
        if [ -d "$integration_tests_path" ] && [ -f "$integration_tests_path/test-config.json" ]; then
            echo "🔍 Found integration tests for $library"
            run_instrumentation_test "$library" "$integration_tests_path"
        else
            echo "⏭️  Skipping $library (no integration tests found)"
            echo "    Checked path: $integration_tests_path"
            echo "    Dir exists: $([ -d "$integration_tests_path" ] && echo "yes" || echo "no")"
            echo "    Config exists: $([ -f "$integration_tests_path/test-config.json" ] && echo "yes" || echo "no")"
        fi
    done
fi

echo ""
echo "=== Final Results ==="
echo "Total tests run: $((total_passed + total_failed))"
echo "Passed: $total_passed"
echo "Failed: $total_failed"

if [ $total_failed -gt 0 ]; then
    echo ""
    echo "Failed tests:"
    for test in "${failed_tests[@]}"; do
        echo "  ❌ $test"
    done
    echo ""
    echo "Some tests failed! 🚨"
    exit 1
else
    echo ""
    echo "All tests passed! 🎉"
    exit 0
fi