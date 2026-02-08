#!/bin/bash

set -e

echo "=========================================="
echo "MYSQL2 (ESM) E2E Test Suite"
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
  sleep 8

  # Run benchmarks
  echo "Running benchmarks..."
  
  BENCHMARK_ENDPOINTS=(
    "http://localhost:3000/health"
    "http://localhost:3000/test/connection-query"
    "http://localhost:3000/test/pool-query"
  )

  END_TIME=$((SECONDS + ${BENCHMARK_DURATION:-60}))
  while [ $SECONDS -lt $END_TIME ]; do
    for endpoint in "${BENCHMARK_ENDPOINTS[@]}"; do
      curl -sSf "$endpoint" > /dev/null || true
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
sleep 8

# Hit all endpoints
echo "Hitting all endpoints..."

curl -sSf http://localhost:3000/health > /dev/null
curl -sSf http://localhost:3000/test/connection-query > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/connection-parameterized > /dev/null
curl -sSf http://localhost:3000/test/connection-execute > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/connection-execute-params > /dev/null
curl -sSf http://localhost:3000/test/pool-query > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/pool-parameterized > /dev/null
curl -sSf http://localhost:3000/test/pool-execute > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"userId": 2}' http://localhost:3000/test/pool-execute-params > /dev/null
curl -sSf http://localhost:3000/test/pool-getConnection > /dev/null
curl -sSf http://localhost:3000/test/connection-connect > /dev/null
curl -sSf http://localhost:3000/test/connection-ping > /dev/null
curl -sSf http://localhost:3000/test/stream-query > /dev/null
curl -sSf http://localhost:3000/test/sequelize-authenticate > /dev/null
curl -sSf http://localhost:3000/test/sequelize-findall > /dev/null
curl -sSf -X POST -H "Content-Type: application/json" -d '{"userId": 1}' http://localhost:3000/test/sequelize-findone > /dev/null
curl -sSf http://localhost:3000/test/sequelize-complex > /dev/null
curl -sSf http://localhost:3000/test/sequelize-raw > /dev/null
curl -sSf -X POST http://localhost:3000/test/sequelize-transaction > /dev/null
curl -sSf http://localhost:3000/test/promise-connection-query > /dev/null
curl -sSf http://localhost:3000/test/promise-pool-query > /dev/null
curl -sSf http://localhost:3000/test/promise-pool-getconnection > /dev/null
curl -sSf http://localhost:3000/test/transaction-methods > /dev/null
curl -sSf http://localhost:3000/test/prepare-statement > /dev/null
curl -sSf http://localhost:3000/test/change-user > /dev/null
curl -sSf http://localhost:3000/test/nested-null-values > /dev/null
curl -sSf http://localhost:3000/test/binary-data > /dev/null
curl -sSf http://localhost:3000/test/knex-raw-query > /dev/null
curl -sSf -X POST http://localhost:3000/test/knex-savepoint > /dev/null
curl -sSf http://localhost:3000/test/knex-streaming > /dev/null

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
echo "MYSQL2 (ESM) E2E Test Suite Complete"
echo "=========================================="
