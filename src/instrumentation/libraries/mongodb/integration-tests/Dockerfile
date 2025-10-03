FROM node:20-alpine

# Install Docker CLI for testcontainers
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copy package.json and install dependencies
COPY package.json .
RUN npm install

# Copy server file
COPY server.js .

# Create directory for traces
RUN mkdir -p /app/tmp

EXPOSE 3000

CMD ["node", "server.js"]