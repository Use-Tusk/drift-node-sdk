# Prisma Instrumentation

## Purpose

Records and replays Prisma database operations to ensure deterministic behavior during replay. Captures queries, arguments, and results during recording, then provides previously recorded results during replay, eliminating database dependencies.

## Behavior by Mode

### Record Mode

- Intercepts all Prisma operations via `$extends` query middleware (`$allOperations`)
- Records model operations (findFirst, create, update, delete, aggregate, etc.)
- Records raw queries (`$queryRaw`, `$executeRaw`)
- Records transaction operations (sequential and interactive)
- Captures Prisma error class information for faithful error replay
- Builds a per-column type map (`_tdTypeMap`) for raw queries to preserve type information (see [Type Deserialization](#type-deserialization))

### Replay Mode

- Returns previously recorded results instead of executing against the database
- Reconstructs Prisma-specific JS types that are lost during JSON serialization (see [Type Deserialization](#type-deserialization))
- Restores correct Prisma error class prototypes (`PrismaClientKnownRequestError`, etc.)
- Throws errors if no matching mock data is found

### Disabled Mode

- No patching - uses original `@prisma/client` behavior

## Implementation Details

### Patching Strategy

- Wraps the `PrismaClient` constructor to return an extended client
- Uses Prisma's `$extends` API with a `query.$allOperations` hook
- Supports both CJS and ESM module formats
- Stores a reference to the Prisma client instance for `_runtimeDataModel` access during replay
- Stores the `Prisma` namespace for `Decimal` class access during type reconstruction

### Type Deserialization

Prisma returns special JS types for certain column types. JSON round-trip during record/replay loses this type information, causing runtime crashes in application code:

| Prisma Type | JS Type Returned | After JSON Round-Trip | Breaks |
|-------------|-----------------|----------------------|--------|
| `DateTime` | `Date` | string `"2026-03-10T..."` | `.toISOString()`, `.getTime()`, `instanceof Date` |
| `Decimal` | `Decimal` (decimal.js) | number `100.5` | `.toFixed()`, `.toString()` (Decimal-specific) |
| `BigInt` | `bigint` | crashes `JSON.stringify` | Everything - recording itself throws |
| `Bytes` | `Buffer` / `Uint8Array` | plain object `{0: 222, ...}` | `Buffer.isBuffer()`, `.toString('base64')` |

All four types also have array variants (`BigInt[]`, `Decimal[]`, `DateTime[]`, `Bytes[]`).

#### Two Reconstruction Strategies

Type reconstruction during replay uses two strategies depending on whether the operation has a model. Both strategies share a single `_reconstructSingleValue` method.

**1. Model-based operations** (findFirst, create, update, etc.): The `$allOperations` middleware provides the `model` name (e.g., `"User"`). We look up field types from `prisma._runtimeDataModel.models[modelName].fields` and reconstruct each field based on its declared Prisma type. Handles scalars, arrays, and nested relations recursively. No extra metadata is stored during recording.

**2. Raw queries** (`$queryRaw`): No model name is available. During recording, we sniff the JS types of each value in the result and store a per-column type map (e.g., `{bigNum: "bigint", data: "bytes"}`) as `_tdTypeMap` alongside the result. During replay, we use this map to reconstruct the values.

#### Type Naming Convention

Our type names (`"bigint"`, `"bytes"`, `"decimal"`, `"datetime"` and their `-array` variants) mirror Prisma's internal `QueryIntrospectionBuiltinType` enum from `@prisma/client/runtime`. We don't import these types directly - we use our own string literals that match Prisma's naming convention.

#### Decimal Detection

Prisma uses `decimal.js` internally but minifies the class name in production builds (constructor name may be `"i"` instead of `"Decimal"`). We detect Decimals by checking for `decimal.js`-specific methods (`toFixed`, `toExponential`, `toSignificantDigits`) rather than constructor name.

#### BigInt Serialization

`JSON.stringify` throws on BigInt values. We use `safeJsonStringify` (from `dataNormalizationUtils.ts`) which converts BigInt to string via a custom replacer. This is used in `SpanUtils.addSpanAttributes` for the outputValue attribute.

### Error Handling

- Identifies Prisma error classes (`PrismaClientKnownRequestError`, `PrismaClientValidationError`, etc.) via `instanceof` checks during recording
- Stores the error class name as `customTdName` on the serialized error
- During replay, restores the correct prototype using `Object.setPrototypeOf` so `instanceof` checks work in application code

### Version Support

- **@prisma/client**: Versions 5.x and 6.x

## Architecture

### File Structure

- **`Instrumentation.ts`** - Main instrumentation: patching, record/replay logic, type reconstruction
- **`types.ts`** - TypeScript interfaces (`PrismaInputValue`, `PrismaOutputValue`, error types)
- **`index.ts`** - Module export

### Key Dependencies

- `safeJsonStringify` from `core/utils/dataNormalizationUtils.ts` - handles BigInt serialization
- `SpanUtils` from `core/tracing/SpanUtils.ts` - span creation and attribute storage
- Design doc: `docs/prisma-type-deserialization-bug.md`
