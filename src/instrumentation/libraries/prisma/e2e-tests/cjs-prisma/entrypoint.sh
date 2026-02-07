#!/bin/bash
set -e

# E2E Test Entrypoint for Prisma (CJS) Instrumentation

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${2:-$NC}$1${NC}"; }

cleanup() {
  log "Stopping server..." "$YELLOW"
  pkill -f "node" 2>/dev/null || true
}
trap cleanup EXIT

log "================================================" "$BLUE"
log "Phase 1: Setup" "$BLUE"
log "================================================" "$BLUE"

log "Installing dependencies..."
npm install --silent

log "Generating Prisma Client..."
npx prisma generate

log "Pushing database schema..."
npx prisma db push --force-reset --skip-generate

log "Building TypeScript..."
npm run build --silent

rm -rf .tusk/traces/* .tusk/logs/* 2>/dev/null || true
mkdir -p .tusk/traces .tusk/logs

log "Setup complete" "$GREEN"

log "================================================" "$BLUE"
log "Phase 2: Recording traces" "$BLUE"
log "================================================" "$BLUE"

log "Starting server in RECORD mode..."
TUSK_DRIFT_MODE=RECORD npm run dev > /dev/null 2>&1 &
SERVER_PID=$!

log "Waiting for server to be ready..."
sleep 10

log "Health check..."
curl -sf http://localhost:3000/health > /dev/null || { log "Health check failed" "$RED"; exit 1; }

log "Hitting endpoints..."
curl -s http://localhost:3000/health > /dev/null
curl -s http://localhost:3000/users/all > /dev/null
curl -s http://localhost:3000/users/active > /dev/null
curl -s http://localhost:3000/users/1 > /dev/null
curl -s http://localhost:3000/users/first-active > /dev/null
curl -s http://localhost:3000/users/by-email/alice@example.com > /dev/null
curl -s -X POST -H "Content-Type: application/json" -d '{"email":"newuser@example.com","name":"New User","age":28}' http://localhost:3000/users/create > /dev/null
curl -s -X POST http://localhost:3000/users/create-many > /dev/null
curl -s -X PUT -H "Content-Type: application/json" -d '{"name":"Updated Alice","age":31}' http://localhost:3000/users/1 > /dev/null
curl -s -X PUT http://localhost:3000/users/bulk-deactivate > /dev/null
curl -s -X POST -H "Content-Type: application/json" -d '{"email":"upsert@example.com","name":"Upsert User","age":29}' http://localhost:3000/users/upsert > /dev/null
curl -s http://localhost:3000/users/count > /dev/null
curl -s http://localhost:3000/orders/aggregate > /dev/null
curl -s http://localhost:3000/users/1/with-posts > /dev/null
curl -s http://localhost:3000/posts/published > /dev/null
curl -s -X POST -H "Content-Type: application/json" -d '{"title":"Nested Post","content":"Test content","authorEmail":"alice@example.com"}' http://localhost:3000/posts/create-with-author > /dev/null
curl -s -X POST http://localhost:3000/transactions/sequential > /dev/null
curl -s -X POST http://localhost:3000/transactions/interactive > /dev/null
curl -s -X POST http://localhost:3000/raw/query > /dev/null
curl -s -X POST http://localhost:3000/raw/execute > /dev/null
curl -s -X POST http://localhost:3000/errors/unique-violation > /dev/null
curl -s http://localhost:3000/errors/not-found > /dev/null
curl -s -X POST http://localhost:3000/errors/validation > /dev/null
curl -s -X DELETE http://localhost:3000/users/inactive > /dev/null

log "All endpoints hit successfully" "$GREEN"

log "Waiting for traces to be written..."
sleep 3

cleanup

log "================================================" "$BLUE"
log "Phase 3: Running replay tests" "$BLUE"
log "================================================" "$BLUE"

TUSK_ANALYTICS_DISABLED=1 tusk run --print --output-format "json" --enable-service-logs

log "================================================" "$BLUE"
log "Phase 4: Running benchmarks" "$BLUE"
log "================================================" "$BLUE"

if [ -n "$BENCHMARKS" ]; then
  log "Starting server in REPLAY mode..."
  TUSK_DRIFT_MODE=REPLAY npm run dev > /dev/null 2>&1 &
  SERVER_PID=$!
  
  log "Waiting for server to be ready..."
  sleep 10
  
  log "Running benchmarks for ${BENCHMARK_DURATION}s..."
  TUSK_ANALYTICS_DISABLED=1 tusk benchmark \
    --duration "${BENCHMARK_DURATION}" \
    --endpoints "/health,/users/all,/users/count"
  
  cleanup
fi

log "================================================" "$BLUE"
log "Test run complete" "$GREEN"
log "================================================" "$BLUE"
