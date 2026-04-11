#!/bin/bash
set -e

# Export Pipeline Benchmark Runner
# Tests event loop blocking under different fix configurations.
#
# Usage: ./run-export-bench.sh
# Requires: Docker, docker compose, SDK built (npx tsdown)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${2:-$NC}$1${NC}"; }

# Files we patch for each fix variant
EXPORTER="$SDK_ROOT/src/core/tracing/TdSpanExporter.ts"
FS_ADAPTER="$SDK_ROOT/src/core/tracing/adapters/FilesystemSpanAdapter.ts"

# Save originals
cp "$EXPORTER" "$EXPORTER.orig"
cp "$FS_ADAPTER" "$FS_ADAPTER.orig"

restore_originals() {
  cp "$EXPORTER.orig" "$EXPORTER"
  cp "$FS_ADAPTER.orig" "$FS_ADAPTER"
  rm -f "$EXPORTER.orig" "$FS_ADAPTER.orig"
}
trap restore_originals EXIT

rebuild_sdk() {
  log "  Rebuilding SDK..." "$YELLOW"
  (cd "$SDK_ROOT" && npx tsdown 2>&1 | tail -1)
}

run_bench() {
  local label="$1"
  log "Running: $label" "$BLUE"

  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d postgres 2>&1 | tail -1

  # Wait for postgres
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" run --rm --name pg-export-bench \
    --entrypoint "" \
    -e TUSK_DRIFT_MODE=RECORD \
    -e TUSK_LOG_LEVEL=error \
    app bash -c "npm install --silent 2>&1 && npx tsc 2>&1 && node dist/export-pipeline-bench.js 2>/dev/null" \
    2>/dev/null
}

# ============================================================
log "============================================================" "$BLUE"
log "Export Pipeline Benchmark" "$BLUE"
log "============================================================" "$BLUE"
echo ""

RESULTS_FILE=$(mktemp)

# --- Baseline ---
log "=== BASELINE (current code) ===" "$BLUE"
restore_originals
rebuild_sdk
echo -n '{"variant":"baseline","data":' >> "$RESULTS_FILE"
run_bench "baseline" >> "$RESULTS_FILE"
echo '}' >> "$RESULTS_FILE"
echo ""

# --- Fix A: Chunked transform ---
log "=== FIX A: Chunked transformSpanToCleanJSON ===" "$BLUE"
restore_originals

# Apply Fix A: replace the synchronous .map() with chunked async processing
cat > /tmp/fix-a.py << 'PYEOF'
import re, sys
content = open(sys.argv[1]).read()

old = """    // Transform spans to CleanSpanData
    const cleanSpans: CleanSpanData[] = filteredBlockedSpans.map((span) =>
      SpanTransformer.transformSpanToCleanJSON(span, this.environment),
    );"""

new = """    // Transform spans to CleanSpanData (chunked to avoid blocking event loop)
    const CHUNK_SIZE = 20;
    const cleanSpans: CleanSpanData[] = [];
    for (let _i = 0; _i < filteredBlockedSpans.length; _i += CHUNK_SIZE) {
      const chunk = filteredBlockedSpans.slice(_i, _i + CHUNK_SIZE);
      cleanSpans.push(...chunk.map((span) =>
        SpanTransformer.transformSpanToCleanJSON(span, this.environment),
      ));
      if (_i + CHUNK_SIZE < filteredBlockedSpans.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }"""

if old not in content:
    print("ERROR: could not find target in TdSpanExporter.ts", file=sys.stderr)
    sys.exit(1)
content = content.replace(old, new)

# Make export() async
content = content.replace(
    "export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {",
    "export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {\n    this._exportAsync(spans, resultCallback);\n  }\n\n  private async _exportAsync(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): Promise<void> {"
)

# Remove the duplicate mode check since _exportAsync handles it
# Actually, we need to be careful here. Let's just wrap the whole body.
# The simplest approach: make the method async by extracting to a helper.

open(sys.argv[1], 'w').write(content)
print("Fix A applied")
PYEOF
python3 /tmp/fix-a.py "$EXPORTER"
rebuild_sdk
echo -n ',{"variant":"fix-a-chunked-transform","data":' >> "$RESULTS_FILE"
run_bench "fix-a" >> "$RESULTS_FILE"
echo '}' >> "$RESULTS_FILE"
echo ""

# --- Fix B: Async filesystem ---
log "=== FIX B: Async FilesystemSpanAdapter ===" "$BLUE"
restore_originals

# Apply Fix B: replace appendFileSync with appendFile
cat > /tmp/fix-b.py << 'PYEOF'
import sys
content = open(sys.argv[1]).read()

content = content.replace(
    'import * as fs from "fs";',
    'import * as fs from "fs";\nimport * as fsPromises from "fs/promises";'
)
content = content.replace(
    "fs.appendFileSync(filePath, jsonLine, \"utf8\");",
    "await fsPromises.appendFile(filePath, jsonLine, \"utf8\");"
)
content = content.replace(
    "async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {",
    "async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {"
)

open(sys.argv[1], 'w').write(content)
print("Fix B applied")
PYEOF
python3 /tmp/fix-b.py "$FS_ADAPTER"
rebuild_sdk
echo -n ',{"variant":"fix-b-async-fs","data":' >> "$RESULTS_FILE"
run_bench "fix-b" >> "$RESULTS_FILE"
echo '}' >> "$RESULTS_FILE"
echo ""

# --- Fix A+B: Both ---
log "=== FIX A+B: Chunked transform + Async filesystem ===" "$BLUE"
restore_originals
python3 /tmp/fix-a.py "$EXPORTER"
python3 /tmp/fix-b.py "$FS_ADAPTER"
rebuild_sdk
echo -n ',{"variant":"fix-ab-both","data":' >> "$RESULTS_FILE"
run_bench "fix-a+b" >> "$RESULTS_FILE"
echo '}' >> "$RESULTS_FILE"
echo ""

# --- Print comparison ---
log "============================================================" "$BLUE"
log "RESULTS COMPARISON" "$BLUE"
log "============================================================" "$BLUE"

python3 << PYEOF
import json

with open("$RESULTS_FILE") as f:
    raw = '[' + f.read().strip() + ']'
    # Fix trailing commas between objects
    raw = raw.replace('}{', '},{').replace('}\n{', '},\n{')

results = json.loads(raw)

print(f"{'Variant':<35} {'Max Stall':>10} {'Total Stall':>12} {'Stall Count':>12} {'Req Time':>10}")
print("-" * 85)

for r in results:
    v = r['variant']
    d = r['data']
    print(f"{v:<35} {d['maxStallMs']:>8}ms {d['totalStallMs']:>10}ms {d['stallCount']:>12} {d['requestDurationMs']:>8}ms")

print()
baseline = results[0]['data']
for r in results[1:]:
    d = r['data']
    if baseline['maxStallMs'] > 0:
        improvement = (1 - d['maxStallMs'] / baseline['maxStallMs']) * 100
        print(f"{r['variant']}: max stall {improvement:+.0f}% vs baseline")
PYEOF

# Cleanup
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down 2>/dev/null || true
rm -f "$RESULTS_FILE" /tmp/fix-a.py /tmp/fix-b.py
