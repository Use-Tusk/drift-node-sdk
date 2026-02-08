FROM node:18

WORKDIR /app

# Copy package files from e2e test directory
COPY src/instrumentation/libraries/prisma/e2e-tests/cjs-prisma/package*.json ./
COPY src/instrumentation/libraries/prisma/e2e-tests/cjs-prisma/tsconfig.json ./

# Copy Prisma schema (needed for prisma generate)
COPY src/instrumentation/libraries/prisma/e2e-tests/cjs-prisma/prisma ./prisma

# Add cache-busting argument to force fresh CLI download
ARG CACHEBUST=1
ARG TUSK_CLI_VERSION=latest

# Install Tusk Drift CLI
RUN if [ "$TUSK_CLI_VERSION" = "latest" ]; then \
      curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh; \
    else \
      curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh -s -- ${TUSK_CLI_VERSION}; \
    fi

# Expose the server port
EXPOSE 3000

COPY src/instrumentation/libraries/prisma/e2e-tests/cjs-prisma/entrypoint.sh ./
RUN chmod +x entrypoint.sh
RUN mkdir -p /app/.tusk/traces /app/.tusk/logs
ENTRYPOINT ["./entrypoint.sh"]
