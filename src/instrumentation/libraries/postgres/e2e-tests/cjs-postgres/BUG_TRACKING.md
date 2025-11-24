# postgres Instrumentation Bug Tracking

Generated: 2025-11-23

## Summary

- Total tests attempted: 3
- Confirmed bugs: 3
- No bugs found: 0
- Skipped tests: 0

---

## Test Results

### Test 1: `.execute()` method - Immediate query execution

**Status**: Confirmed Bug - Unpatched dependency

**Endpoint**: `/test/execute-method`

**Failure Point**: REPLAY

**Description**:
Testing the `.execute()` method which forces immediate execution of queries instead of lazy execution. The instrumentation should handle this method and properly track the query execution.

**Expected Behavior**:
Query should execute immediately, be recorded in RECORD mode, and replay without TCP warnings in REPLAY mode.

**Actual Behavior**:
The query executes and replays successfully, but TCP unpatched dependency warnings appear during replay:

**Error Logs**:

```
time=2025-11-24T00:47:18.858Z level=INFO msg="Unpatched dependency alert" traceTestServerSpanId=a182d7d768821ac4eafdf6477eefbbf9 stackTrace="Error\n    at TcpInstrumentation._logUnpatchedDependency (/sdk/dist/index.cjs:15772:40)\n    at TcpInstrumentation._handleTcpCall (/sdk/dist/index.cjs:15791:148)\n    at netModule.Socket.connect (/sdk/dist/index.cjs:15753:16)\n    at Timeout.connect [as _onTimeout] (/app/node_modules/postgres/cjs/src/connection.js:345:12)" sdkVersion=0.1.15

time=2025-11-24T00:47:18.870Z level=INFO msg="Unpatched dependency alert" traceTestServerSpanId=a182d7d768821ac4eafdf6477eefbbf9 stackTrace="Error\n    at TcpInstrumentation._logUnpatchedDependency (/sdk/dist/index.cjs:15772:40)\n    at TcpInstrumentation._handleTcpCall (/sdk/dist/index.cjs:15791:148)\n    at netModule.Socket.write (/sdk/dist/index.cjs:15756:16)\n    at Immediate.nextWrite [as _onImmediate] (/app/node_modules/postgres/cjs/src/connection.js:250:22)\n    at process.processImmediate (node:internal/timers:476:21)\n    at process.callbackTrampoline (node:internal/async_hooks:128:17)" sdkVersion=0.1.15
```

**Additional Notes**:
The `.execute()` method is not explicitly wrapped in the instrumentation code. When called, it appears to make TCP calls that are detected as unpatched dependencies. This suggests that the query execution path through `.execute()` bypasses the instrumentation's proper handling, even though the test passes.

---

### Test 2: `sql.file()` method - Loading queries from files

**Status**: Confirmed Bug - Unpatched dependency

**Endpoint**: `/test/sql-file`

**Failure Point**: REPLAY

**Description**:
Testing the `sql.file()` method which allows loading SQL queries from external files. This is a commonly used feature but is not currently instrumented. The test loads a simple SELECT query from /tmp/test-query.sql.

**Expected Behavior**:
The query should load from the file and execute successfully in all modes without generating TCP warnings.

**Actual Behavior**:
The query executes successfully and the test passes, but TCP unpatched dependency warnings appear during REPLAY mode, similar to Test 1 with `.execute()`.

**Error Logs**:

```
time=2025-11-24T00:54:08.819Z level=INFO msg="Unpatched dependency alert" traceTestServerSpanId=b2e479e5f00cff59c7b2150aa48d6126 stackTrace="Error\n    at TcpInstrumentation._logUnpatchedDependency (/sdk/dist/index.cjs:15772:40)\n    at TcpInstrumentation._handleTcpCall (/sdk/dist/index.cjs:15791:148)\n    at netModule.Socket.connect (/sdk/dist/index.cjs:15753:16)\n    at Timeout.connect [as _onTimeout] (/app/node_modules/postgres/cjs/src/connection.js:345:12)" sdkVersion=0.1.15

time=2025-11-24T00:54:08.825Z level=INFO msg="Unpatched dependency alert" traceTestServerSpanId=b2e479e5f00cff59c7b2150aa48d6126 stackTrace="Error\n    at TcpInstrumentation._logUnpatchedDependency (/sdk/dist/index.cjs:15772:40)\n    at TcpInstrumentation._handleTcpCall (/sdk/dist/index.cjs:15791:148)\n    at netModule.Socket.write (/sdk/dist/index.cjs:15756:16)\n    at Immediate.nextWrite [as _onImmediate] (/app/node_modules/postgres/cjs/src/connection.js:250:22)\n    at process.processImmediate (node:internal/timers:476:21)\n    at process.callbackTrampoline (node:internal/async_hooks:128:17)" sdkVersion=0.1.15
```

**Additional Notes**:
The `sql.file()` method is not wrapped in the instrumentation code at all. Looking at the postgres source code (src/index.js:129-144), `sql.file()` creates a new Query object but delegates actual file reading to the handler. The instrumentation only wraps the main sql template literal queries and a few methods like `unsafe` and `begin`, but does not wrap `file()`. This causes the same TCP unpatched dependency issue as `.execute()`.

---
