# Run Your First Test

Let's walk through recording and replaying your first trace:

## Step 1: Set sampling rate to 1.0

Set the `sampling_rate` in `.tusk/config.yaml` to 1.0 to ensure that all requests are recorded.

## Step 2: Start server in record mode

Run your server in record mode using the `TUSK_DRIFT_MODE` environment variable:

```bash
TUSK_DRIFT_MODE=RECORD node server.js
```

> **Note:** See the [Environment Variables guide](./environment-variables.md#tusk_drift_mode) for more details about `TUSK_DRIFT_MODE` and other environment variables.

You should see logs indicating Tusk Drift is active:

```text
[TuskDrift] SDK initialized in RECORD mode
[TuskDrift] App marked as ready
```

## Step 3: Generate Traffic

Make a request to a simple endpoint that includes some database and/or network calls:

```bash
curl http://localhost:8000/api/test/weather
```

## Step 4: Stop Recording

Wait for a few seconds and then stop your server with `Ctrl+C`. This will give time for traces to be exported.

### Step 5: List Recorded Traces

In your project directory, list the recorded traces:

```bash
tusk list
```

You should see an output similar to:

![List output](/images/tusk-list-output.png)

Press `ESC` to exit the list view.

Need to install the Tusk CLI? See [CLI installation guide](https://github.com/Use-Tusk/tusk-drift-cli?tab=readme-ov-file#install).

## Step 6: Replay the Trace

Replay the recorded test:

```bash
tusk run
```

You should see an output similar to:

![Run output](/images/tusk-run-output.png)

**Success!** You've recorded and replayed your first trace.
