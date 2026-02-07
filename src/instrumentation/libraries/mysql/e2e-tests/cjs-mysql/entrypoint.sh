#!/bin/bash

set -e

echo "=========================================="
echo "MYSQL (CJS) E2E Test Suite"
echo "=========================================="

# ============================================================================
# Phase 1: Setup
# ============================================================================
echo ""
echo "Phase 1: Setup"
echo "----------------------------------------"

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the application
echo "Building application..."
npm run build

# Clean up any existing traces
echo "Cleaning up existing traces..."
rm -rf /app/.tusk/traces/*
rm -rf /app/.tusk/logs/*

# ============================================================================
# Benchmark Mode (if BENCHMARKS env var is set)
# ============================================================================
if [ -n "$BENCHMARKS" ]; then
  echo ""
  echo "=========================================="
  echo "BENCHMARK MODE ENABLED"
  echo "Duration: ${BENCHMARK_DURATION:-60} seconds"
  echo "=========================================="

  # Start server in background
  echo "Starting server for benchmarking..."
  TUSK_DRIFT_MODE=RECORD npm run dev > /dev/null 2>&1 &
  SERVER_PID=$!

  # Wait for server to start
  echo "Waiting for server to start..."
  sleep 10

  # Run benchmarks
  echo "Running benchmarks..."
  
  BENCHMARK_ENDPOINTS=(
    "http://localhost:3000/health"
    "http://localhost:3000/connection/query-callback"
    "http://localhost:3000/pool/query"
  )

  END_TIME=$((SECONDS + ${BENCHMARK_DURATION:-60}))
  while [ $SECONDS -lt $END_TIME ]; do
    for endpoint in "${BENCHMARK_ENDPOINTS[@]}"; do
      curl -s "$endpoint" > /dev/null || true
    done
  done

  echo "Benchmark complete. Stopping server..."
  kill $SERVER_PID 2>/dev/null || true
  wait $SERVER_PID 2>/dev/null || true
  sleep 2

  echo "Exiting benchmark mode."
  exit 0
fi

# ============================================================================
# Phase 2: Recording Traces
# ============================================================================
echo ""
echo "Phase 2: Recording Traces"
echo "----------------------------------------"

# Start server in RECORD mode
echo "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev > /dev/null 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 10

# Hit all endpoints
echo "Hitting all endpoints..."

curl -s http://localhost:3000/health > /dev/null
curl -s http://localhost:3000/connection/query-callback > /dev/null
curl -s "http://localhost:3000/connection/query-params?key=test_key_1" > /dev/null
curl -s http://localhost:3000/connection/query-options > /dev/null
curl -s http://localhost:3000/connection/query-stream > /dev/null
curl -s http://localhost:3000/connection/multi-statement > /dev/null
curl -s http://localhost:3000/pool/query > /dev/null
curl -s http://localhost:3000/pool/get-connection > /dev/null
curl -s -X POST http://localhost:3000/transaction/commit > /dev/null
curl -s -X POST http://localhost:3000/transaction/rollback > /dev/null
curl -s -X POST http://localhost:3000/test/transaction-with-options > /dev/null
curl -s -X POST -H "Content-Type: application/json" -d '{"key":"crud_test_insert","value":"test_value"}' http://localhost:3000/crud/insert > /dev/null
curl -s -X PUT -H "Content-Type: application/json" -d '{"key":"test_key_1","value":"updated_value"}' http://localhost:3000/crud/update > /dev/null
curl -s -X DELETE -H "Content-Type: application/json" -d '{"key":"crud_test_insert"}' http://localhost:3000/crud/delete > /dev/null
curl -s http://localhost:3000/advanced/join > /dev/null
curl -s http://localhost:3000/advanced/aggregate > /dev/null
curl -s http://localhost:3000/advanced/subquery > /dev/null
curl -s http://localhost:3000/advanced/prepared > /dev/null
curl -s http://localhost:3000/lifecycle/ping > /dev/null
curl -s http://localhost:3000/lifecycle/end-and-reconnect > /dev/null
curl -s -X POST http://localhost:3000/lifecycle/change-user > /dev/null
curl -s http://localhost:3000/lifecycle/pause-resume > /dev/null
curl -s http://localhost:3000/pool/end-and-recreate > /dev/null
curl -s http://localhost:3000/test/pool-events > /dev/null
curl -s http://localhost:3000/test/pool-namespace-query > /dev/null
curl -s http://localhost:3000/events/connect > /dev/null
curl -s http://localhost:3000/stream/query-stream-method > /dev/null
curl -s http://localhost:3000/test/connection-destroy > /dev/null
curl -s http://localhost:3000/test/query-object-reuse > /dev/null
curl -s http://localhost:3000/test/pool-namespace-query-stream > /dev/null
curl -s -X POST http://localhost:3000/test/pool-connection-transaction-options > /dev/null
curl -s http://localhost:3000/test/pool-getconnection-query-with-internal-callback > /dev/null
curl -s http://localhost:3000/test/pool-namespace-query-with-internal-callback > /dev/null
curl -s http://localhost:3000/knex/basic-select > /dev/null
curl -s http://localhost:3000/knex/raw-query > /dev/null

echo "All endpoints hit successfully."

# Stop server
echo "Stopping server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
sleep 2

# ============================================================================
# Phase 3: Run Tusk Tests
# ============================================================================
echo ""
echo "Phase 3: Running Tusk Tests"
echo "----------------------------------------"

tusk run --print --output-format "json" --enable-service-logs

# ============================================================================
# Phase 4: Check for Warnings
# ============================================================================
echo ""
echo "Phase 4: Checking for Warnings"
echo "----------------------------------------"

if [ -f "/app/.tusk/logs/app.log" ]; then
  if grep -q "TCP module instrumentation not loaded" /app/.tusk/logs/app.log; then
    echo "WARNING: TCP module instrumentation not loaded - this may affect trace accuracy"
  else
    echo "No TCP instrumentation warnings found."
  fi
else
  echo "No log file found at /app/.tusk/logs/app.log"
fi

echo ""
echo "=========================================="
echo "MYSQL (CJS) E2E Test Suite Complete"
echo "=========================================="
