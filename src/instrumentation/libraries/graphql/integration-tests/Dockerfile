FROM node:20-alpine

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