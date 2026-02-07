FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Add cache-busting argument to force fresh CLI download
ARG CACHEBUST=1
ARG TUSK_CLI_VERSION=latest

# Install Tusk Drift CLI
RUN if [ "$TUSK_CLI_VERSION" = "latest" ]; then \
      curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh; \
    else \
      curl -fsSL https://raw.githubusercontent.com/Use-Tusk/tusk-drift-cli/main/install.sh | sh -s -- ${TUSK_CLI_VERSION}; \
    fi

# Set working directory
WORKDIR /app

# Create directories for traces and logs
RUN mkdir -p .tusk/traces .tusk/logs

# Python environment settings for better Docker logging
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Default command (will be overridden by specific tests)
CMD ["python", "--version"]
