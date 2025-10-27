export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log('[Next.js Instrumentation] Initializing Tusk Drift SDK...');
    console.log('[Next.js Instrumentation] TUSK_DRIFT_MODE:', process.env.TUSK_DRIFT_MODE);
    console.log('[Next.js Instrumentation] NODE_ENV:', process.env.NODE_ENV);

    const { TuskDrift } = await import("@use-tusk/drift-node-sdk");

    TuskDrift.initialize({
      apiKey: "api-key",
      env: "dev",
      logLevel: "debug",
    });

    console.log('[Next.js Instrumentation] SDK initialized, marking as ready...');

    // Mark app as ready immediately
    TuskDrift.markAppAsReady();

    console.log('[Next.js Instrumentation] SDK marked as ready');
  }
}
