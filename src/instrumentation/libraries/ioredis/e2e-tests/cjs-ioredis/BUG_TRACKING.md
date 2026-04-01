# ioredis Instrumentation Bug Tracking

Generated: 2026-03-09

## Summary

- Total tests attempted: 3
- Confirmed bugs: 3
- No bugs found: 0
- Skipped tests: 0

---

## Test Results

### Test 1: Missing `connect` event in replay mode

**Status**: Confirmed Bug

**Endpoint**: `/test/new-client-connect-event`

**Failure Point**: REPLAY

**Description**:
In replay mode, the instrumentation's `_handleReplayConnect` method (line 562-570) and `noOpRequestHandler` (line 246-248) only emit the `ready` event. Real ioredis emits events in order: `connecting` -> `connect` -> `ready`. Any app that waits on `client.once('connect', ...)` will hang forever during replay.

**Expected Behavior**:
The `connect` event should fire, the endpoint should return `{"success":true,"data":{"result":"PONG","eventReceived":"connect"}}` with HTTP 200.

**Actual Behavior**:
The endpoint times out after 5 seconds and returns HTTP 500 with `{"error":"Timeout waiting for 'connect' event","success":false}`.

**Error Logs**:
```json
{
  "test_id": "76950a419d1bc16c300c05b7f7140cb4",
  "passed": false,
  "duration": 5006,
  "deviations": [
    {"field": "response.status", "expected": 200, "actual": 500},
    {"field": "response.body", "expected": {"data":{"eventReceived":"connect","result":"PONG"},"operation":"NEW_CLIENT_CONNECT_EVENT","success":true}, "actual": {"error":"Timeout waiting for 'connect' event","success":false}}
  ]
}
```

**Additional Notes**:
This is the exact bug that causes `collection-service` to hang on startup in replay mode (`src/services/cache/index.ts:34` uses `client.once('connect', ...)`). The `@redis/client` instrumentation correctly emits both `connect` and `ready` in replay mode, confirming this is an ioredis-specific oversight.

**Fix**: In `_handleReplayConnect` (line 565) and `noOpRequestHandler` (line 246-248), emit both events:
```typescript
process.nextTick(() => {
  (thisContext as any).emit("connect");
  (thisContext as any).emit("ready");
});
```

---

### Test 2: Missing `connecting` and `connect` events - only `ready` emitted in replay

**Status**: Confirmed Bug

**Endpoint**: `/test/new-client-connecting-event`

**Failure Point**: REPLAY

**Description**:
This test tracks all connection lifecycle events (`connecting`, `connect`, `ready`). In replay mode, only `ready` is emitted. Both `connecting` and `connect` events are missing, which means the replay does not faithfully reproduce the real ioredis connection lifecycle.

**Expected Behavior**:
Events received should be `["connecting", "connect", "ready"]` with `hasConnecting: true`, `hasConnect: true`, `hasReady: true`.

**Actual Behavior**:
Events received are `["ready"]` only, with `hasConnecting: false`, `hasConnect: false`, `hasReady: true`.

**Error Logs**:
```json
{
  "test_id": "90b37047b23bb928a20849017710b6ce",
  "passed": false,
  "duration": 12,
  "deviations": [
    {"field": "response.body",
     "expected": {"data":{"eventsReceived":["connecting","connect","ready"],"hasConnect":true,"hasConnecting":true,"hasReady":true,"result":"PONG"}},
     "actual": {"data":{"eventsReceived":["ready"],"hasConnect":false,"hasConnecting":false,"hasReady":true,"result":"PONG"}}}
  ]
}
```

**Additional Notes**:
Real ioredis uses `setStatus()` which emits events via `process.nextTick(this.emit.bind(this, status, arg))` in order: `connecting` -> `connect` -> `ready`. The instrumentation skips the first two. While `connecting` is less commonly listened to by apps than `connect`, it's part of the contract and could be relied upon by monitoring/health-check code.

**Fix**: Emit all three events in sequence:
```typescript
process.nextTick(() => {
  (thisContext as any).emit("connecting");
  (thisContext as any).emit("connect");
  (thisContext as any).emit("ready");
});
```

---

### Test 3: `redis.status` property not updated in replay mode

**Status**: Confirmed Bug

**Endpoint**: `/test/new-client-status-check`

**Failure Point**: REPLAY

**Description**:
Real ioredis's `setStatus()` method both sets `this.status = status` AND emits the event. The instrumentation only calls `emit("ready")` without updating `this.status`. After connection in replay mode, `redis.status` remains `"wait"` (the initial state for `lazyConnect` or the constructor's default) instead of `"ready"`.

**Expected Behavior**:
`redis.status` should be `"ready"` and `isReady` should be `true`.

**Actual Behavior**:
`redis.status` is `"wait"` and `isReady` is `false`.

**Error Logs**:
```json
{
  "test_id": "9ef0418743b4950c7744cb5489457f7b",
  "passed": false,
  "duration": 4,
  "deviations": [
    {"field": "response.body",
     "expected": {"data":{"isReady":true,"result":"PONG","status":"ready"}},
     "actual": {"data":{"isReady":false,"result":"PONG","status":"wait"}}}
  ]
}
```

**Additional Notes**:
This is a subtler bug than the missing events. Internal ioredis code checks `this.status` to decide whether to queue commands in the offline queue or send them immediately. Libraries built on top of ioredis (like `bull`, `bullmq`) may also check `redis.status === "ready"` before proceeding. The fix should set `this.status` before emitting each event, mirroring what `setStatus()` does:
```typescript
process.nextTick(() => {
  (thisContext as any).status = "connect";
  (thisContext as any).emit("connect");
  (thisContext as any).status = "ready";
  (thisContext as any).emit("ready");
});
```

---
