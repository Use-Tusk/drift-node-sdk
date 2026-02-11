#!/bin/bash
set -e

APP_PORT=${1:-3000}
export APP_PORT

PROJECT_NAME="prisma-esm-${APP_PORT}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Running Node E2E Test: PRISMA (ESM)${NC}"
echo -e "${BLUE}Port: ${APP_PORT}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

cleanup() {
  echo ""
  echo -e "${YELLOW}Cleaning up containers...${NC}"
  docker compose -p "$PROJECT_NAME" down -v 2>/dev/null || true
}

trap cleanup EXIT

echo -e "${BLUE}Building containers...${NC}"
docker compose -p "$PROJECT_NAME" build --no-cache

echo -e "${BLUE}Starting test...${NC}"
echo ""

set +e
docker compose -p "$PROJECT_NAME" run --rm app
EXIT_CODE=$?
set -e

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}Test passed!${NC}"
  echo -e "${GREEN}========================================${NC}"
else
  echo -e "${RED}========================================${NC}"
  echo -e "${RED}Test failed with exit code ${EXIT_CODE}${NC}"
  echo -e "${RED}========================================${NC}"
fi

exit $EXIT_CODE
