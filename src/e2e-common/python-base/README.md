# Python E2E Base Image

This directory contains the base Docker image used by all Python e2e tests in the SDK.

## What's Included

- **Python 3.12** (python:3.12-slim base)
- **Tusk Drift CLI** (installed via official install script)
- **System utilities**:
  - `curl` - for HTTP requests and downloads
  - `postgresql-client` - for postgres readiness checks
- **Pre-created directories**: `.tusk/traces/` and `.tusk/logs/`
- **Python environment variables**:
  - `PYTHONUNBUFFERED=1` - immediate output in Docker logs
  - `PYTHONDONTWRITEBYTECODE=1` - no .pyc files

## Building the Base Image

From the repository root:

```bash
docker build -t python-e2e-base:latest -f src/e2e-common/python-base/Dockerfile .
```

### With specific Tusk CLI version:

```bash
docker build \
  --build-arg TUSK_CLI_VERSION=v1.2.3 \
  -t python-e2e-base:latest \
  -f src/e2e-common/python-base/Dockerfile \
  .
```

### Force rebuild (bypass cache):

```bash
docker build \
  --build-arg CACHEBUST=$(date +%s) \
  --no-cache \
  -t python-e2e-base:latest \
  -f src/e2e-common/python-base/Dockerfile \
  .
```

## Usage in E2E Tests

Each Python e2e test builds on this base image:

```dockerfile
# In python/e2e-tests/flask-http/Dockerfile
FROM python-e2e-base:latest

# Copy SDK source (for development)
COPY python /sdk

# Copy test files
COPY python/e2e-tests/flask-http /app

WORKDIR /app

# Install test-specific dependencies
RUN pip install -q -r requirements.txt

# Run test entrypoint
ENTRYPOINT ["python", "entrypoint.py"]
```

## Design Rationale

### Why a Shared Base Image?

1. **Consistency** - All tests use the same Python + Tusk CLI versions
2. **Build speed** - Base layers are cached and reused across tests
3. **Maintainability** - Update Tusk CLI version in one place
4. **Smaller total size** - Docker shares base layers between tests

### Why python:3.12-slim?

- **Size**: `slim` variant is ~50% smaller than full Python image
- **Security**: Fewer packages = smaller attack surface
- **Speed**: Faster downloads and builds
- **Compatibility**: Still includes common dependencies

### Why Install Tusk CLI at Build Time?

- **Offline testing**: CLI available without internet in container
- **Version pinning**: Can specify exact CLI version via ARG
- **Speed**: No download latency during test execution
- **Reliability**: Tests don't fail due to download issues

## Maintenance

### Updating Python Version

Edit the `FROM` line in Dockerfile:

```dockerfile
FROM python:3.13-slim  # Update to 3.13
```

Then rebuild all e2e tests.

### Updating Tusk CLI Version

Update the default ARG or pass at build time:

```dockerfile
ARG TUSK_CLI_VERSION=v2.0.0  # Update default
```

Or override at build time:

```bash
docker build --build-arg TUSK_CLI_VERSION=v2.0.0 ...
```

### Adding System Dependencies

Add to the `apt-get install` line:

```dockerfile
RUN apt-get update && apt-get install -y \
    curl \
    postgresql-client \
    redis-tools \        # New dependency
    && rm -rf /var/lib/apt/lists/*
```

**Remember to rebuild all e2e tests after updating the base image!**
