# GraphQL Instrumentation

## Purpose

Provides **presentational metadata only** for GraphQL operations. This instrumentation does not record or replay GraphQL operations - it solely adds GraphQL operation information (operation type, name) to parent HTTP spans for enhanced observability.

GraphQL uses HTTP under the hood, so the HTTP instrumentation is enough to record + replay GraphQL operations.

## Behavior by Mode

### Record Mode

- Intercepts GraphQL `execute` and `executeSync` calls
- Extracts operation metadata (type, name) from GraphQL documents
- Adds presentational attributes to parent HTTP spans
- **Always calls original GraphQL functions** - no interference with execution

### Replay Mode

- Skips all instrumentation and calls original functions directly
- No patching or metadata extraction occurs
- Pure pass-through behavior

### Disabled Mode

- No patching - uses original GraphQL execution

## Implementation Details

### Patching Strategy

- Patches GraphQL execution files directly (`graphql/execution/execute.js`)
- Supports both GraphQL v15 and v16 with version-specific patching
- Does **not** patch main module exports since `execute` functions aren't exported there

### Version Support

- **GraphQL v16**: Patches `execute` only (deprecated `executeSync`)
- **GraphQL v15**: Patches both `execute` and `executeSync`

### Data Handling

- Extracts operation information using `getOperationDefinition()` utility
- Adds span attributes with `PackageType.GRAPHQL`
- No input/output value recording - metadata only
