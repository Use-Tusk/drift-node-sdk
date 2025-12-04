# Checklist for Adding a New Instrumentation

1. **Initialize in `registerDefaultInstrumentations()`**
   - Add to `src/core/TuskDrift.ts` in the `registerDefaultInstrumentations()` method

2. **Add module name to `TuskDriftInstrumentationModuleNames.ts`**
   - Add package name to the array in `src/core/TuskDriftInstrumentationModuleNames.ts`

3. **Add package to `withTuskDrift.ts`**
   - Add to `coreExternals` array in `src/nextjs/withTuskDrift.ts` (inside the `isRecordOrReplay` conditional)
