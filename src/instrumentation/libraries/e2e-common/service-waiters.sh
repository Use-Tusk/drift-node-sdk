#!/bin/bash

# Service waiter utilities for E2E tests
# Provides wait_for_* functions for various services

# Colors for output
WAITER_GREEN='\033[0;32m'
WAITER_RED='\033[0;31m'
WAITER_YELLOW='\033[1;33m'
WAITER_NC='\033[0m'

# Wait for PostgreSQL to be ready
# Usage: wait_for_postgres [HOST] [USER] [DB] [TIMEOUT]
wait_for_postgres() {
  local HOST="${1:-postgres}"
  local USER="${2:-testuser}"
  local DB="${3:-testdb}"
  local TIMEOUT="${4:-30}"

  echo "Waiting for PostgreSQL at $HOST..."
  local ELAPSED=0
  while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -p "$PROJECT_NAME" exec -T app sh -c "pg_isready -h $HOST -U $USER -d $DB" > /dev/null 2>&1; then
      echo -e "${WAITER_GREEN}✓${WAITER_NC} PostgreSQL is ready"
      return 0
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  echo -e "${WAITER_RED}✗${WAITER_NC} PostgreSQL did not become ready within ${TIMEOUT}s"
  return 1
}

# Wait for MySQL to be ready
# Usage: wait_for_mysql [HOST] [USER] [PASS] [TIMEOUT]
wait_for_mysql() {
  local HOST="${1:-mysql}"
  local USER="${2:-testuser}"
  local PASS="${3:-testpass}"
  local TIMEOUT="${4:-30}"

  echo "Waiting for MySQL at $HOST..."
  local ELAPSED=0
  while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -p "$PROJECT_NAME" exec -T app sh -c "mysqladmin ping -h $HOST -u$USER -p$PASS --silent" > /dev/null 2>&1; then
      echo -e "${WAITER_GREEN}✓${WAITER_NC} MySQL is ready"
      return 0
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  echo -e "${WAITER_RED}✗${WAITER_NC} MySQL did not become ready within ${TIMEOUT}s"
  return 1
}

# Wait for Redis to be ready
# Usage: wait_for_redis [HOST] [TIMEOUT]
wait_for_redis() {
  local HOST="${1:-redis}"
  local TIMEOUT="${2:-30}"

  echo "Waiting for Redis at $HOST..."
  local ELAPSED=0
  while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -p "$PROJECT_NAME" exec -T app sh -c "redis-cli -h $HOST ping" 2>/dev/null | grep -q "PONG"; then
      echo -e "${WAITER_GREEN}✓${WAITER_NC} Redis is ready"
      return 0
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  echo -e "${WAITER_RED}✗${WAITER_NC} Redis did not become ready within ${TIMEOUT}s"
  return 1
}

# Wait for MongoDB to be ready
# Usage: wait_for_mongodb [HOST] [TIMEOUT]
wait_for_mongodb() {
  local HOST="${1:-mongodb}"
  local TIMEOUT="${2:-30}"

  echo "Waiting for MongoDB at $HOST..."
  local ELAPSED=0
  while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -p "$PROJECT_NAME" exec -T app sh -c "mongosh --host $HOST --eval 'db.runCommand({ ping: 1 })'" > /dev/null 2>&1; then
      echo -e "${WAITER_GREEN}✓${WAITER_NC} MongoDB is ready"
      return 0
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  echo -e "${WAITER_RED}✗${WAITER_NC} MongoDB did not become ready within ${TIMEOUT}s"
  return 1
}

# Wait for application to be ready (health endpoint)
# Usage: wait_for_app [PORT] [TIMEOUT] [HEALTH_ENDPOINT]
wait_for_app() {
  local PORT="${1:-3000}"
  local TIMEOUT="${2:-30}"
  local HEALTH_ENDPOINT="${3:-/health}"

  echo "Waiting for app at localhost:${PORT}${HEALTH_ENDPOINT}..."
  local ELAPSED=0
  while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -p "$PROJECT_NAME" exec -T app curl -s "http://localhost:${PORT}${HEALTH_ENDPOINT}" > /dev/null 2>&1; then
      echo -e "${WAITER_GREEN}✓${WAITER_NC} App is ready"
      return 0
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  echo -e "${WAITER_RED}✗${WAITER_NC} App did not become ready within ${TIMEOUT}s"
  return 1
}

# Wait for a generic TCP port to be open
# Usage: wait_for_port [HOST] [PORT] [TIMEOUT]
wait_for_port() {
  local HOST="${1:-localhost}"
  local PORT="${2:-3000}"
  local TIMEOUT="${3:-30}"

  echo "Waiting for $HOST:$PORT..."
  local ELAPSED=0
  while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker compose -p "$PROJECT_NAME" exec -T app sh -c "nc -z $HOST $PORT" > /dev/null 2>&1; then
      echo -e "${WAITER_GREEN}✓${WAITER_NC} Port $HOST:$PORT is open"
      return 0
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
  done

  echo -e "${WAITER_RED}✗${WAITER_NC} Port $HOST:$PORT did not open within ${TIMEOUT}s"
  return 1
}
