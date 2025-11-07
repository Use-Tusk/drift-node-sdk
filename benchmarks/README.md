# Benchmarks

These are some benchmarks.
Each benchmark is actually just a AVA test suite that uses tinybench for
measurements and formatting.
At the start of each test suite, we launch a server in `server/test-server.ts`.
Interestingly, it is this server that does all the work rather than the actual
benchmark files.

## Usage

You can run all tests and get a summary with
```
npm run test:bench
```
You can disable memory monitoring with
```
BENCHMARK_ENABLE_MEMORY=false npm run test:bench
```
Memory monitoring introduces a non-trivial impact to CPU, roughly around 10% or
so.

The results are placed in the `results` folder, and there's a
`compare-benchmarks.ts` script that is run automatically and summarizes the data
in a markdown table; if you want to process the data further this can be a good
starting point.
