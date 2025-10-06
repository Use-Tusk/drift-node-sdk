export default {
  files: [
    'src/**/*.test.ts',
    '!src/instrumentation/libraries/jsonwebtoken/**/*.test.ts',
    '!src/instrumentation/libraries/pg/**/*.test.ts'
  ],
  extensions: {
    ts: 'commonjs'
  },
  nodeArguments: ['--require=tsx/cjs'],
  environmentVariables: {
    TUSK_DRIFT_MODE: 'RECORD',
    TS_NODE_TRANSPILE_ONLY: 'true'
  },
  timeout: '2m',
  // Integration tests need isolation, but unit tests can run concurrently
  concurrency: 5,
  workerThreads: false,
};
