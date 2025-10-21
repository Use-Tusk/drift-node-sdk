FROM node:18

WORKDIR /app

# Copy package files from e2e test directory
COPY src/instrumentation/libraries/http/e2e-tests/esm-http/package*.json ./
COPY src/instrumentation/libraries/http/e2e-tests/esm-http/tsconfig.json ./

# Install dependencies
RUN npm install

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

# Container stays running - CLI will control the app
CMD ["tail", "-f", "/dev/null"]
