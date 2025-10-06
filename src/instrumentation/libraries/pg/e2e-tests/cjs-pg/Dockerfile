FROM node:18

WORKDIR /app

# Copy package files from e2e test directory
COPY src/instrumentation/libraries/pg/e2e-tests/cjs-pg/package*.json ./
COPY src/instrumentation/libraries/pg/e2e-tests/cjs-pg/tsconfig.json ./

# Install dependencies
RUN npm install

# Install Tusk Drift CLI
RUN curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh

# Expose the server port
EXPOSE 3000

# Container stays running - CLI will control the app
CMD ["tail", "-f", "/dev/null"]
