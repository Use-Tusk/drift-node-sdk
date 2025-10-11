# Troubleshooting

## Common Issues

### No traces being recorded

1. **Check sampling rate**: Ensure `sampling_rate` in `.tusk/config.yaml` is 1.0
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
