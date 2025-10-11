FROM node:18

WORKDIR /app

# Copy package files from e2e test directory
COPY src/instrumentation/libraries/grpc/e2e-tests/esm-grpc/package*.json ./
COPY src/instrumentation/libraries/grpc/e2e-tests/esm-grpc/tsconfig.json ./

# Install dependencies
RUN npm install

# Install Tusk Drift CLI
RUN curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh

# Expose the server ports
EXPOSE 3000
EXPOSE 50051

# Container stays running - CLI will control the app
CMD ["tail", "-f", "/dev/null"]
