FROM node:20-alpine
WORKDIR /app

# Install Docker CLI for testcontainers
RUN apk add --no-cache docker-cli

# Copy package.json first for better caching
COPY package.json .
RUN npm install

# Copy the test server
COPY server.js .

EXPOSE 3000

# Create recordings directory and tmp directory structure
RUN mkdir -p /app/tmp

CMD ["node", "server.js"]