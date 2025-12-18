# Tusk Drift Bug Bot

## Checklist for Adding a New Instrumentation

1. **Initialize in `registerDefaultInstrumentations()`**
   - Add to `src/core/TuskDrift.ts` in the `registerDefaultInstrumentations()` method

2. **Add module name to `TuskDriftInstrumentationModuleNames.ts`**
   - Add package name to the array in `src/core/TuskDriftInstrumentationModuleNames.ts`

3. **Add package to `withTuskDrift.ts`**
   - Add to `coreExternals` array in `src/nextjs/withTuskDrift.ts` (inside the `isRecordOrReplay` conditional)

## Using `matchImportance` for Schema Merges

When setting `matchImportance` on input fields (e.g., to deprioritize certain fields during mock matching), you must add it in **two places**:

1. **During RECORD mode (span creation)**
   - Add `inputSchemaMerges` when calling `SpanUtils.createAndExecuteSpan()`:

   ```typescript
   inputSchemaMerges: {
     fieldName: {
       matchImportance: 0,  // 0 = lowest importance, 1 = highest
     },
   },
   ```

2. **During REPLAY mode (mock fetching)**
   - Add `inputValueSchemaMerges` when calling `findMockResponseAsync()`:

   ```typescript
   inputValueSchemaMerges: {
     fieldName: {
       matchImportance: 0,
     },
   },
   ```

If you only add it in one place, the schema hashes will differ between recording and replay, causing mock matching to fail. See the HTTP instrumentation (`src/instrumentation/libraries/http/mocks/TdMockClientRequest.ts`) for a reference implementation with `headers: { matchImportance: 0 }`.
