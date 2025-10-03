# Date Instrumentation

## Purpose

Provides synchronous date generation during replay mode by replacing `new Date()` calls with timestamps from the latest mock response in the current trace.

## Behavior by Mode

### Record Mode

- No patching or interference with date operations
- Uses original `Date` constructor and methods

### Replay Mode

- Patches global `Date` constructor to intercept `new Date()` calls without arguments
- Returns the latest timestamp from the current trace's mock responses
  - Stored in `DateTracker`
- Only affects calls made within SERVER spans (inbound requests). Any other requests will use the original `Date` constructor and methods
- Preserves original behavior for `Date` calls with arguments

### Disabled Mode

- No patching - uses original `Date` constructor

## Implementation Details

### Patching Strategy

- Replaces `globalThis.Date` with a wrapper function
- Leverages `DateTracker.getCurrentTraceLatestDate()` to get replacement timestamp
- Only replaces `new Date()` calls (no arguments)
- Respects constructor vs function call patterns:
  - `new Date()` → returns Date object
  - `Date()` → returns string representation

### Limitations

- Only date calls in replay mode within a SERVER span will be replaced. This means all date calls pre app start will call the original `Date`
- Date is replaced by the latest timestamp from the current trace's mock responses. Meaning this won't match the exact milliseconds of the original execution. This should be fine considering it will be in the general range of the original execution, but worth noting.
