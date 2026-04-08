# Code Coverage (Node.js)

The Node SDK collects per-test code coverage during Tusk Drift replay using V8's built-in precise coverage. No external dependencies like NYC or c8 are needed.

## How It Works

### V8 Precise Coverage

When coverage is enabled (via `--show-coverage`, `--coverage-output`, or `coverage.enabled: true` in config), the CLI sets `NODE_V8_COVERAGE=<temp-dir>`. This tells V8 to enable precise coverage collection internally:

```
V8 internally calls: Profiler.startPreciseCoverage({ callCount: true, detailed: true })
```

This provides:
- **Real execution counts** (1, 2, 5...) not just binary covered/uncovered
- **Block-level granularity**: branches, loops, expressions
- **Zero external dependencies** — works with any Node.js version that supports `NODE_V8_COVERAGE`
- **Works with CJS, ESM, TypeScript, bundled code** — anything V8 executes

### Snapshot Flow

1. **Baseline**: After the service starts, the CLI sends a `CoverageSnapshotRequest(baseline=true)`. The SDK calls `v8.takeCoverage()`, which writes a JSON file to the `NODE_V8_COVERAGE` directory and **resets all counters**. The baseline captures all coverable lines (including uncovered at count=0) for the coverage denominator.

2. **Per-test**: After each test, the CLI sends `CoverageSnapshotRequest(baseline=false)`. The SDK calls `v8.takeCoverage()` again. Because counters were reset, the result contains **only lines executed by this specific test** — no diffing needed.

3. **Processing**: The SDK processes the V8 JSON using `ast-v8-to-istanbul`, which converts V8 byte ranges into Istanbul-format line/branch coverage. The result is sent back to the CLI via protobuf.

### Why ast-v8-to-istanbul (not v8-to-istanbul)

After `v8.takeCoverage()` resets counters, V8 only reports functions that were called since the reset. Functions that were never called are **absent** from the V8 output.

- **v8-to-istanbul** assumes complete V8 data. Missing functions are treated as "covered by default." This produces 100% coverage for files where only `/health` was hit.
- **ast-v8-to-istanbul** parses the source file's AST independently. It knows about ALL functions from the AST and correctly marks missing ones as uncovered.

This is the key reason we use `ast-v8-to-istanbul`.

### Source Map Support

For TypeScript projects using `tsc`, the SDK automatically:

1. Detects `//# sourceMappingURL=<file>.map` comments in compiled JS
2. Loads the `.map` file
3. Fixes `sourceRoot` if present (TypeScript sets `sourceRoot: "/"` which breaks ast-v8-to-istanbul's internal path resolution — the SDK resolves sources relative to the actual project root)
4. Strips the `sourceMappingURL` comment from code passed to ast-v8-to-istanbul (prevents it from loading the unpatched `.map` file)
5. Passes the fixed source map to ast-v8-to-istanbul, which remaps coverage to original `.ts` files

**Requirements:** `sourceMap: true` in `tsconfig.json`. Source map files (`.js.map`) must be present alongside compiled output.

**Supported setups:**
| Setup | Status |
|-------|--------|
| `tsc` -> `node dist/` | Works (tested) |
| `swc`/`esbuild` (compile, not bundle) -> `node dist/` | Should work (same `.js` + `.js.map` pattern) |
| `ts-node` with `TS_NODE_EMIT=true` | Works (CLI sets this automatically) |
| `ts-node-dev` | Limited — lazy compilation means only executed files have coverage |
| Bundled (webpack/esbuild/Rollup) | Untested — should work if source maps are produced |

### Multi-PID Handling

The start command in `.tusk/config.yaml` often chains processes:

```
rm -rf dist && npm run build && node dist/server.js
```

This creates multiple Node processes (npm, tsc, the server), all inheriting `NODE_V8_COVERAGE`. Each writes its own V8 coverage file. The SDK handles this by **quick-scanning** each file to check for user scripts before running the expensive ast-v8-to-istanbul processing. Files from npm/tsc (which have 0 user scripts) are skipped.

### CJS vs ESM

The SDK tries parsing source code as CJS (`sourceType: "script"`) first, falling back to ESM (`sourceType: "module"`) if that fails. This handles both module formats without configuration.

## Environment Variables

These are set automatically by the CLI when coverage is enabled. You should not set them manually.

| Variable | Description |
|----------|-------------|
| `NODE_V8_COVERAGE` | Directory for V8 to write coverage JSON files. Set by CLI. |
| `TUSK_COVERAGE` | Language-agnostic signal that coverage is enabled. Set by CLI. |
| `TS_NODE_EMIT` | Forces ts-node to write compiled JS to disk (needed for coverage processing). Set by CLI. |

## Limitations

- **acorn parse failures**: `ast-v8-to-istanbul` uses acorn to parse JavaScript. Files using syntax acorn doesn't support (stage 3 proposals, certain decorator patterns) are silently skipped.
- **Stale `dist/` artifacts**: `tsc` doesn't clean old output files. If a source file was renamed or moved, the old compiled file remains in `dist/` and may have broken imports. Use `rm -rf dist` before `tsc` in your start command.
- **Multi-process apps**: If your app uses Node's cluster module or PM2 to fork workers, each worker is a separate process. Only the worker connected to the CLI's protobuf channel handles coverage requests.
- **Dynamic imports**: Modules loaded via dynamic `import()` after startup aren't in the baseline snapshot. Their uncovered functions won't be in the denominator.
- **Large codebases**: Processing 500+ files from a 24MB V8 JSON takes several seconds. The CLI has a 30-second timeout for coverage snapshots.
- **ts-node-dev**: Lazy compilation means only files accessed during the test are compiled and covered. Pre-compiled `tsc` output gives much better coverage.
