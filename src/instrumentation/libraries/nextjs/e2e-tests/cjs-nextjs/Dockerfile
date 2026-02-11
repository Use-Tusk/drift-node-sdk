FROM node:18

WORKDIR /app

# Copy package files from e2e test directory
COPY src/instrumentation/libraries/nextjs/e2e-tests/cjs-nextjs/package*.json ./
COPY src/instrumentation/libraries/nextjs/e2e-tests/cjs-nextjs/tsconfig.json ./
COPY src/instrumentation/libraries/nextjs/e2e-tests/cjs-nextjs/next.config.js ./

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

COPY src/instrumentation/libraries/nextjs/e2e-tests/cjs-nextjs/entrypoint.sh ./
RUN chmod +x entrypoint.sh
RUN mkdir -p /app/.tusk/traces /app/.tusk/logs

# Copy shared test infrastructure
COPY src/instrumentation/libraries/e2e-common/base-entrypoint.sh /app/base-entrypoint.sh
COPY src/instrumentation/libraries/e2e-common/test-utils.mjs /app/test-utils.mjs
RUN chmod +x /app/base-entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
