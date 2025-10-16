#!/bin/bash

# Exit on error
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common E2E helpers
source "$SCRIPT_DIR/../../e2e-common/e2e-helpers.sh"

# Run all E2E tests for ioredis
# Accepts optional base port parameter (default: 3000)
run_all_e2e_tests "$SCRIPT_DIR" "grpc" "${1:-3000}"
