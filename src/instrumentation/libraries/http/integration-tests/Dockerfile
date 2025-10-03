FROM node:18-alpine
WORKDIR /app

# Copy package.json first for better caching
COPY package.json .
RUN npm install

# Copy the test server
COPY server.js .

EXPOSE 3000

# Create recordings directory and tmp directory structure
RUN mkdir -p /app/tmp

CMD ["node", "server.js"]