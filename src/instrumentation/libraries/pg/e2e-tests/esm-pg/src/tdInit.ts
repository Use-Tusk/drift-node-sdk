import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// Register the ESM loader
// This enables interception of ESM module imports
register('@use-tusk/drift-node-sdk/hook.mjs', pathToFileURL('./'));

import { TuskDrift } from '@use-tusk/drift-node-sdk';

TuskDrift.initialize({
  apiKey: "api-key",
  env: "dev",
  logLevel: "debug",
});

export { TuskDrift };
