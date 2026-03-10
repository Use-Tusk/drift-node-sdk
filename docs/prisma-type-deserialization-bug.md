# Prisma Type Deserialization Bug

## Problem

Prisma returns special JS types for certain column types. When we record these values, `JSON.stringify` loses the type information. During replay, the mock returns plain JSON values instead of the original types, causing runtime crashes in application code.

| Prisma Type | JS Type Returned | After JSON Round-Trip | Breaks |
|-------------|-----------------|----------------------|--------|
| `DateTime` | `Date` | string `"2026-03-10T..."` | `.toISOString()`, `.getTime()`, `instanceof Date` |
| `Decimal` | `Decimal` (prisma runtime) | number `100.5` | `.toFixed()`, `.toString()` (Decimal-specific) |
| `BigInt` | `bigint` | **crashes `JSON.stringify`** | Everything — recording itself throws |
| `Bytes` | `Buffer` / `Uint8Array` | plain object `{0: 222, 1: 173, ...}` | `Buffer.isBuffer()`, `.toString('base64')` |

All four types also have array variants (`BigInt[]`, `Decimal[]`, `DateTime[]`, `Bytes[]`) which suffer from the same issue.

## Two reconstruction strategies

Type reconstruction during replay uses two strategies depending on whether the operation has a model or not. Both strategies share a single `_reconstructSingleValue` method that maps Prisma query engine type names (`bigint`, `bytes`, `decimal`, `datetime`) to JS constructors.

### 1. Model-based operations (findFirst, create, update, etc.)

The `$allOperations` middleware provides the `model` name (e.g., `"User"`, `"Order"`). We look up the model's field types from `prisma._runtimeDataModel.models[modelName].fields` and reconstruct each field based on its declared Prisma type (`DateTime`, `BigInt`, `Decimal`, `Bytes`). Handles both scalar fields and array fields, plus nested relations recursively.

No extra data is stored during recording — all type info comes from the schema at replay time.

### 2. Raw queries ($queryRaw)

`$queryRaw` doesn't go through the middleware with a model name. Internally, Prisma's query engine returns a `{columns, types, rows}` structure with per-column type info. Prisma's `deserializeRawResult` consumes this metadata to reconstruct JS types. But by the time our `$allOperations` middleware sees the result, the metadata is gone — we only get the final deserialized objects.

**Our approach:** During recording, we sniff the JS types of each value in the result and build a per-column type map (e.g., `{bigNum: "bigint", data: "bytes", prices: "decimal-array"}`). We store this map as `_tdTypeMap` alongside the result in the span. This only happens for operations without a model — model-based operations don't need it.

During replay, we use `_tdTypeMap` to reconstruct the values using the same `_reconstructSingleValue` method as the model-based path.

**Type detection during recording:**
- `typeof value === "bigint"` → `"bigint"`
- `value instanceof Date` → `"datetime"`
- `Buffer.isBuffer(value) || value instanceof Uint8Array` → `"bytes"`
- `typeof value.toFixed === "function" && typeof value.toSignificantDigits === "function"` → `"decimal"` (uses `decimal.js`-specific methods since Prisma minifies the class name)

**Array detection:** If a value is an array, the first element is sniffed and stored as `"bigint-array"`, `"datetime-array"`, etc.

**Null handling:** `_buildTypeMap` scans all rows in the result, not just the first, so that columns with `null` in the first row but non-null values in later rows are still captured.

The failure mode is graceful — if a type isn't recognized, the value passes through as-is (same behavior as before the fix).

## Files

- Recording + replay: `src/instrumentation/libraries/prisma/Instrumentation.ts`
- BigInt serialization: `src/core/utils/dataNormalizationUtils.ts` (`safeJsonStringify`)
- Span output serialization: `src/core/tracing/SpanUtils.ts` (uses `safeJsonStringify` for outputValue)
- Type metadata source (model ops): `prisma._runtimeDataModel.models[modelName].fields`
- E2E tests: `src/instrumentation/libraries/prisma/e2e-tests/{cjs,esm}-prisma/`
