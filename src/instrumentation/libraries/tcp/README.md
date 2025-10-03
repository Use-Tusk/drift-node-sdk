# TCP Instrumentation

## Purpose

**Diagnostic tool for identifying unpatched dependencies** - This instrumentation monitors TCP socket connections and writes to detect when application code makes network calls that haven't been instrumented by TuskDrift. It serves as an early warning system for missing instrumentation coverage. This DOES NOT record + replay TCP operations.

## Behavior by Mode

### Record Mode

- No instrumentation or monitoring
- Uses original `net` module behavior

### Replay Mode

- Monitors `net.Socket.prototype.connect()` and `net.Socket.prototype.write()` calls within SERVER span contexts
- Logs warnings when TCP connections are initiated from inbound request handling
  - Logic: if there was a TCP call and the parent span is a SERVER span, this means some library outside of the ones we have instrumented is making a TCP call and likely needs to be instrumented
- Keeps track of logged spans to prevent duplicate logs/alerts for the same span + method combination
  - Cleans up old span entries periodically to prevent memory leaks
- Custom checks for HTTP related TCP calls + ProtobufCommunicator calls, no need to log those as unpatched dependencies

### Disabled Mode

- No patching - uses original `net` module behavior

## Implementation Details

### Patching Strategy

- Patches `net.Socket.prototype.connect()` and `net.Socket.prototype.write()` methods only
- Focuses on connection initiation rather than data transfer
- Minimal scope to reduce performance impact and complexity

### Detection Logic

- Only monitors TCP calls made within **SERVER span contexts**
- Uses `SPAN_KIND_CONTEXT_KEY` to identify inbound request processing
  - This is set by `SpanUtils.createSpan()`
- Ignores TCP calls from CLIENT spans or outside span contexts

### Limitations

- A lot of things use TCP (e.g. logger), so will likely get a lot of alerts
