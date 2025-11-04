#!/bin/bash

# Exit on error
set -e

# Accept optional port parameter (default: 3000)
APP_PORT=${1:-3000}
export APP_PORT

# Generate unique docker compose project name
PROJECT_NAME="prisma-esm-${APP_PORT}"

# Source common E2E helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../../e2e-common/e2e-helpers.sh"

echo "Starting Prisma (ESM) E2E test run on port ${APP_PORT}..."

# Step 0: Clean up traces and logs
echo "Step 0: Cleaning up traces and logs..."
cleanup_tusk_files

# Step 1: Start docker containers (postgres + app)
echo "Step 1: Starting docker containers..."
docker compose -p $PROJECT_NAME build --no-cache
docker compose -p $PROJECT_NAME up -d --quiet-pull

# Wait for containers to be ready
echo "Waiting for containers to be ready..."
sleep 5

# Wait for PostgreSQL to be healthy
echo "Waiting for PostgreSQL to be healthy..."
until docker compose -p $PROJECT_NAME exec -T postgres pg_isready -U testuser -d testdb > /dev/null 2>&1; do
  echo "  PostgreSQL is not ready yet..."
  sleep 2
done
echo "PostgreSQL is ready!"

# Step 2: Install dependencies (now that /sdk volume is mounted)
echo "Step 2: Installing dependencies..."
docker compose -p $PROJECT_NAME exec -T app npm install

# Step 2.5: Generate Prisma Client
echo "Step 2.5: Generating Prisma Client..."
docker compose -p $PROJECT_NAME exec -T app npx prisma generate

# Step 2.6: Push database schema
echo "Step 2.6: Pushing database schema..."
docker compose -p $PROJECT_NAME exec -T app npx prisma db push --force-reset --skip-generate

# Step 3: Start server in RECORD mode
echo "Step 3: Starting server in RECORD mode..."
docker compose -p $PROJECT_NAME exec -d -T -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"

# Wait for server to start
echo "Waiting for server to start..."
sleep 10

# Step 4: Hit all endpoints
echo "Step 4: Hitting all Prisma endpoints..."

echo "  - GET /health"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/health > /dev/null

echo "  - GET /users/all (findMany)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/all > /dev/null

echo "  - GET /users/active (findMany with where)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/active > /dev/null

echo "  - GET /users/1 (findUnique)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/1 > /dev/null

echo "  - GET /users/first-active (findFirst)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/first-active > /dev/null

echo "  - GET /users/by-email/alice@example.com (findUniqueOrThrow)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/by-email/alice@example.com > /dev/null

echo "  - POST /users/create (create)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"email":"newuser@example.com","name":"New User","age":28}' http://localhost:3000/users/create > /dev/null

echo "  - POST /users/create-many (createMany)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/users/create-many > /dev/null

echo "  - PUT /users/1 (update)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X PUT -H "Content-Type: application/json" -d '{"name":"Updated Alice","age":31}' http://localhost:3000/users/1 > /dev/null

echo "  - PUT /users/bulk-deactivate (updateMany)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X PUT http://localhost:3000/users/bulk-deactivate > /dev/null

echo "  - POST /users/upsert (upsert)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"email":"upsert@example.com","name":"Upsert User","age":29}' http://localhost:3000/users/upsert > /dev/null

echo "  - GET /users/count (count)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/count > /dev/null

echo "  - GET /orders/aggregate (aggregate)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/orders/aggregate > /dev/null

echo "  - GET /users/1/with-posts (include relations)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/users/1/with-posts > /dev/null

echo "  - GET /posts/published (deep includes)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/posts/published > /dev/null

echo "  - POST /posts/create-with-author (nested writes)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST -H "Content-Type: application/json" -d '{"title":"Nested Post","content":"Test content","authorEmail":"alice@example.com"}' http://localhost:3000/posts/create-with-author > /dev/null

echo "  - POST /transactions/sequential (\$transaction array)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/transactions/sequential > /dev/null

echo "  - POST /transactions/interactive (\$transaction interactive)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/transactions/interactive > /dev/null

echo "  - POST /raw/query (\$queryRaw)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/raw/query > /dev/null

echo "  - POST /raw/execute (\$executeRaw)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/raw/execute > /dev/null

echo "  - POST /errors/unique-violation (error testing)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/errors/unique-violation > /dev/null

echo "  - GET /errors/not-found (error testing)"
docker compose -p $PROJECT_NAME exec -T app curl -s http://localhost:3000/errors/not-found > /dev/null

echo "  - POST /errors/validation (error testing)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X POST http://localhost:3000/errors/validation > /dev/null

echo "  - DELETE /users/inactive (deleteMany)"
docker compose -p $PROJECT_NAME exec -T app curl -s -X DELETE http://localhost:3000/users/inactive > /dev/null

# Note: We intentionally skip DELETE /users/:id to keep data for replay testing

echo "All endpoints hit successfully."

# Step 5: Wait before stopping server
echo "Step 5: Waiting 3 seconds before stopping server..."
sleep 3

# Stop the server process
echo "Stopping server..."
docker compose -p $PROJECT_NAME exec -T app pkill -f "node" || true
sleep 2

# Step 6: Run tests using tusk CLI
echo "Step 6: Running tests using tusk CLI..."
TEST_RESULTS=$(docker compose -p $PROJECT_NAME exec -T app tusk run --print --output-format "json" --enable-service-logs)

# Step 7: Log test results
parse_and_display_test_results "$TEST_RESULTS"

# Step 7.5: Check for TCP instrumentation warning in logs
check_tcp_instrumentation_warning "$PROJECT_NAME"

# Step 8: Clean up
echo ""
echo "Step 8: Cleaning up docker containers..."
docker compose -p $PROJECT_NAME down

# Step 9: Clean up traces and logs
echo "Step 9: Cleaning up traces and logs..."
# cleanup_tusk_files

echo "Prisma (ESM) E2E test run complete."

exit $EXIT_CODE
