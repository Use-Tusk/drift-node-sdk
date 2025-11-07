import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  exports: false, // need to manage exports so we can export the hook.mjs file
  target: "es2020",
  platform: "node",
  noExternal: [
    // Bundle all OpenTelemetry packages to ensure patched @opentelemetry/api isolation
    "@opentelemetry/api",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/semantic-conventions",
    "@opentelemetry/core",
    "@protobuf-ts/twirp-transport",
    "@use-tusk/drift-schemas",
  ],
  // Keep these external - they need to work with Node's module system for dynamic instrumentation
  external: ["import-in-the-middle", "require-in-the-middle", "jsonpath", "semver", "js-yaml"],
});
