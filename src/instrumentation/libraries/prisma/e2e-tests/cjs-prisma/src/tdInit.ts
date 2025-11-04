import { TuskDrift } from "@use-tusk/drift-node-sdk";

TuskDrift.initialize({
  apiKey: "api-key",
  env: "dev",
  logLevel: "debug",
});

export { TuskDrift };
