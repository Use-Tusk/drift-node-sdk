# Troubleshooting

## Common Issues

### No traces being recorded

1. **Check sampling rate**: Verify your sampling rate configuration is set to 1.0 for 100% recording. The SDK checks in this order:
   - `samplingRate` in `TuskDrift.initialize()` (highest priority)
   - `TUSK_SAMPLING_RATE` environment variable
   - `sampling_rate` in `.tusk/config.yaml`
   - Default: 1.0
2. **Verify app readiness**: Make sure you're calling `TuskDrift.markAppAsReady()`
3. **Use debug mode in SDK**: Add `logLevel: 'debug'` to the initialization parameters

### Existing telemetry not working

Ensure that `TuskDrift.initialize()` is called before any other telemetry providers (e.g. OpenTelemetry, Sentry, etc.).

### Replay failures

1. **Enable service and CLI logs**:

   ```bash
   tusk run --debug
   ```

   Logs will be written to `.tusk/logs/`

2. **Test with simple endpoint**: Start with endpoints that only return static data

3. **Check dependencies**: Verify you're using supported package versions

4. **Remove concurrency setting for slow replays**: If replaying works but takes a long time (>10,000 ms), remove any `concurrency` setting from your `.tusk/config.yaml` (default is `1`). When tests run concurrently, the Node process may struggle to synchronously fetch mocks while other tests are executing. Running tests sequentially can help in these cases.
