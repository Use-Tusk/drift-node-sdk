# Prisma Instrumentation Bug Tracking

Generated: 2026-03-09

## Summary

- Total tests attempted: 4
- Confirmed bugs: 4
- No bugs found: 0
- Skipped tests: 0

---

## Test Results

### Test 1: DateTime deserialization during replay

**Status**: Confirmed Bug

**Endpoint**: `/types/datetime`

**Failure Point**: REPLAY

**Description**:
Prisma returns `Date` objects for `DateTime` columns. During recording, `JSON.stringify` converts Date to ISO string. During replay, the mock returns the string instead of a `Date` object, causing `toISOString()` and `getTime()` to fail.

**Expected Behavior**:
```json
{"iso":"2026-03-10T00:24:59.395Z","timestamp":1773102299395,"isDate":true,"updatedAtIso":"2026-03-10T00:25:08.832Z"}
```

**Actual Behavior**:
```json
{"error":"TypeError: user.createdAt.toISOString is not a function"}
```
HTTP 500 instead of 200.

**Additional Notes**:
This affects any application code that calls Date methods on Prisma DateTime fields. The bug is in `_handleReplayPrismaOperation` which returns `outputValue.prismaResult` as-is without type reconstruction.

---

### Test 2: Decimal deserialization during replay

**Status**: Confirmed Bug

**Endpoint**: `/types/decimal`

**Failure Point**: REPLAY

**Description**:
Prisma returns `Decimal` objects for `Decimal` columns. During replay, the mock returns a plain number, which doesn't have the `toFixed` method from the Decimal class.

**Expected Behavior**:
```json
{"asString":"100.5","asNumber":100.5,"hasToFixed":true}
```

**Actual Behavior**:
```json
{"asString":"100.5","asNumber":100.5,"hasToFixed":false}
```

**Additional Notes**:
The response body partially matches — `asString` and `asNumber` work because plain numbers support `toString()` and `Number()`. Only Decimal-specific methods (`toFixed` as a Decimal method, not Number.prototype.toFixed) fail. Note: `Number.prototype.toFixed` exists, so this test checks for the Prisma Decimal-specific `toFixed` behavior.

---

### Test 3: BigInt serialization crash + replay failure

**Status**: Confirmed Bug

**Endpoint**: `/types/bigint`

**Failure Point**: RECORD (partial) + REPLAY

**Description**:
Two-part bug:
1. **RECORD**: `safeJsonStringify` in `dataNormalizationUtils.ts` throws `TypeError: Do not know how to serialize a BigInt` when adding span attributes. The error is caught and logged, but the span output value is lost.
2. **REPLAY**: Because the span has no output value, `findMockResponseAsync` returns no mock data for the `$queryRaw` call, resulting in a 404 ("TypeTest not found").

**Expected Behavior**:
```json
{"isBigInt":true,"asString":"9007199254740993","doubled":"18014398509481986"}
```

**Actual Behavior**:
```json
{"error":"TypeTest not found"}
```
HTTP 404 instead of 200.

**Error Logs**:
```
2026-03-10T00:26:24.976Z [TuskDrift] SpanUtils error adding span attributes: TypeError: Do not know how to serialize a BigInt
```

**Additional Notes**:
This is the most severe bug — it crashes the recording pipeline (silently, since the error is caught). Even if replay type reconstruction were implemented, there would be no data to reconstruct from. The fix in `safeJsonStringify` must come first.

---

### Test 4: Bytes/Buffer deserialization during replay

**Status**: Confirmed Bug

**Endpoint**: `/types/bytes`

**Failure Point**: REPLAY

**Description**:
Prisma returns `Buffer` objects for `Bytes` columns. During replay, the mock returns a plain JSON object representation of the buffer, which fails `Buffer.isBuffer()` check.

**Expected Behavior**:
```json
{"isBuffer":true,"length":4,"base64":"3q2+7w=="}
```

**Actual Behavior**:
```json
{"isBuffer":false,"base64":"3q2+7w=="}
```

**Additional Notes**:
The `base64` value matches because `Buffer.from(data)` can still create a buffer from the plain object. But `Buffer.isBuffer(data)` returns false, and `data.length` is missing from the response (the plain object doesn't have a `length` property). Any code relying on `Buffer.isBuffer()` or direct Buffer methods will break.

---
