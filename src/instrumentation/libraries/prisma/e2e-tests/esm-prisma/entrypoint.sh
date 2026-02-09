#!/bin/bash
SERVER_WAIT_TIME=10
setup_library() {
  npx prisma generate
  npx prisma db push --force-reset --skip-generate
}
source /app/base-entrypoint.sh
