#!/bin/bash

# Running from the root of the SDK

# Usage: ./integration-test-runner/run-instrumentation-tests.sh <instrumentation-path>
# Example: ./integration-test-runner/run-instrumentation-tests.sh src/instrumentation/libraries/http/integration-tests

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <instrumentation-path>"
    echo "Example: $0 ../../src/instrumentation/libraries/pg/integration-tests"
    exit 1
fi

INSTRUMENTATION_PATH=$1

# Get the absolute path
INSTRUMENTATION_PATH=$(cd "$INSTRUMENTATION_PATH" && pwd)

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if instrumentation path exists
if [ ! -d "$INSTRUMENTATION_PATH" ]; then
    echo "Error: Instrumentation path '$INSTRUMENTATION_PATH' not found"
    exit 1
fi

# Check if test-config.json exists
if [ ! -f "$INSTRUMENTATION_PATH/test-config.json" ]; then
    echo "Error: test-config.json not found at $INSTRUMENTATION_PATH"
    exit 1
fi

echo "Running integration tests for instrumentation at: $INSTRUMENTATION_PATH"

# Get the SDK root directory
SDK_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Install dependencies if needed (using main package.json)
cd "$SDK_ROOT"
if [ ! -d "node_modules" ] || [ ! -d "node_modules/ts-node" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Run the test from SDK root
npx tsx -e "
import { runScenario } from './integration-test-runner/test-runner';

async function main() {
  try {
    const results = await runScenario('$INSTRUMENTATION_PATH');

    console.log('\n=== Test Results ===');
    let passed = 0;
    let failed = 0;

    results.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(\`\${status} \${result.method} \${result.endpoint}\`);

      if (!result.success) {
        console.log(\`   Error: \${result.error}\`);
        if (result.recordResponse) {
          console.log(\`   Record response: \${JSON.stringify(result.recordResponse, null, 2)}\`);
        }
        if (result.replayResponse) {
          console.log(\`   Replay response: \${JSON.stringify(result.replayResponse, null, 2)}\`);
        }
        failed++;
      } else {
        passed++;
      }
    });

    console.log(\`\nSummary: \${passed} passed, \${failed} failed\`);

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  }
}

main();
"