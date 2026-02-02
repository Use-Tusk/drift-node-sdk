#!/bin/bash
# Automated benchmark runner for Node SDK - compares SDK disabled vs enabled performance.
#
# Usage: ./run_benchmark.sh [duration_seconds]

set -e

DURATION=${1:-5}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR"

cleanup() {
    echo "Cleaning up..."
    kill $DELAY_PID 2>/dev/null || true
    kill $APP_PID 2>/dev/null || true
}
trap cleanup EXIT

# Start delay server
echo "Starting delay server..."
python3 delay_server.py &
DELAY_PID=$!
sleep 1

# Run baseline (SDK disabled)
echo ""
echo "============================================================"
echo "BASELINE (SDK DISABLED)"
echo "============================================================"

TUSK_DRIFT_MODE=DISABLED npx tsx app.ts &
APP_PID=$!
sleep 2

python3 benchmark.py --url=http://localhost:8080 --duration="$DURATION" | tee /tmp/baseline.txt

kill $APP_PID 2>/dev/null || true
wait $APP_PID 2>/dev/null || true
sleep 0.5

# Run with SDK enabled (with baseline comparison)
echo ""
echo "============================================================"
echo "WITH SDK (TUSK_DRIFT_MODE=RECORD)"
echo "============================================================"

TUSK_DRIFT_MODE=RECORD npx tsx app.ts &
APP_PID=$!
sleep 2

python3 benchmark.py --url=http://localhost:8080 --duration="$DURATION" --baseline=/tmp/baseline.txt
