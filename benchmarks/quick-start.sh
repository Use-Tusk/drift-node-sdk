#!/bin/bash

# Quick start script for running benchmarks

set -e

echo "====================================================================="
echo "Tusk Drift Performance Benchmark - Quick Start"
echo "====================================================================="
echo ""

# Check if we're in the benchmarks directory
if [ ! -f "run-all.ts" ]; then
  echo "Error: Must run from benchmarks/ directory"
  exit 1
fi

# Check if SDK is built
if [ ! -d "../dist" ]; then
  echo "Building SDK..."
  cd ..
  npm run build
  cd benchmarks
  echo "SDK built successfully"
  echo ""
fi

# Check for tsx
if ! command -v npx &> /dev/null; then
  echo "Error: npx not found. Please install Node.js and npm."
  exit 1
fi

echo "Starting benchmark suite..."
echo "This will take approximately 20-30 minutes to complete."
echo ""

# Run benchmarks
npx tsx run-all.ts

echo ""
echo "====================================================================="
echo "Benchmark complete! Check results/ directory for output."
echo "====================================================================="
