FROM node:18

WORKDIR /app

# Copy package files from e2e test directory
COPY src/instrumentation/libraries/mysql2/e2e-tests/esm-mysql2/package*.json ./
COPY src/instrumentation/libraries/mysql2/e2e-tests/esm-mysql2/tsconfig.json ./

# Install dependencies
RUN npm install

# Add cache-busting argument to force fresh CLI download
ARG CACHEBUST=1
# Install Tusk Drift CLI
RUN curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh

# Expose the server port
EXPOSE 3000

# Container stays running - CLI will control the app
CMD ["tail", "-f", "/dev/null"]
