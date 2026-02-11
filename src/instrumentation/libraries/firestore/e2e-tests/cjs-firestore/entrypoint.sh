#!/bin/bash
SERVER_WAIT_TIME=10
setup_library() {
  if [ -z "$FIREBASE_PROJECT_ID" ]; then
    echo -e "\033[0;31mERROR: FIREBASE_PROJECT_ID environment variable is not set\033[0m"
    exit 1
  fi
  if [ -z "$FIREBASE_SERVICE_ACCOUNT" ]; then
    echo -e "\033[0;31mERROR: FIREBASE_SERVICE_ACCOUNT environment variable is not set\033[0m"
    exit 1
  fi
}
source /app/base-entrypoint.sh
