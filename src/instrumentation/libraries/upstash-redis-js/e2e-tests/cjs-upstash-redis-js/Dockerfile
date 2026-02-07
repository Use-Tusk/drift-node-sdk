FROM node:18

WORKDIR /app

COPY src/instrumentation/libraries/upstash-redis-js/e2e-tests/cjs-upstash-redis-js/package*.json ./
COPY src/instrumentation/libraries/upstash-redis-js/e2e-tests/cjs-upstash-redis-js/tsconfig.json ./

ARG CACHEBUST=1
ARG TUSK_CLI_VERSION=latest

RUN if [ "$TUSK_CLI_VERSION" = "latest" ]; then \
      curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh; \
    else \
      curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh -s -- ${TUSK_CLI_VERSION}; \
    fi

EXPOSE 3000

COPY src/instrumentation/libraries/upstash-redis-js/e2e-tests/cjs-upstash-redis-js/entrypoint.sh ./
RUN chmod +x entrypoint.sh
RUN mkdir -p /app/.tusk/traces /app/.tusk/logs
ENTRYPOINT ["./entrypoint.sh"]
