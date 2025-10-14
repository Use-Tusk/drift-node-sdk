# Benchmarks

These are some benchmarks.
Each benchmark is actually just a AVA test suite that uses tinybench for
measurements and formatting.
At the start of each test suite, we launch a server in `server/test-server.ts`.
Interestingly, it is this server that does all the work rather than the actual
benchmark files.

## Results (with Filesystem Export)

Results gathered on Apple M4 Max macOS 26.0.1.

**SDK Disabled (Baseline)**
```
npm test benchmarks/bench/sdk-disabled.bench.ts

┌─────────┬─────────────────────────────────────────────┬───────────────────┬────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                   │ Latency avg (ns)  │ Latency med (ns)   │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼─────────────────────────────────────────────┼───────────────────┼────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'          │ '68897 ± 0.66%'   │ '64500 ± 1708.0'   │ '15369 ± 0.04%'        │ '15504 ± 411'          │ 145159  │
│ 1       │ 'High CPU: POST /api/compute-hash'          │ '450486 ± 2.77%'  │ '371625 ± 8583.0'  │ '2661 ± 0.12%'         │ '2691 ± 63'            │ 22199   │
│ 2       │ 'Large Payload: GET /api/medium (100KB)'    │ '238843 ± 0.31%'  │ '225375 ± 3334.0'  │ '4298 ± 0.10%'         │ '4437 ± 67'            │ 41869   │
│ 3       │ 'Large Payload: GET /api/large (1MB)'       │ '2126376 ± 0.55%' │ '1943250 ± 46583'  │ '483 ± 0.40%'          │ '515 ± 12'             │ 4703    │
│ 4       │ 'Large Payload: POST /api/large-post (1MB)' │ '6482363 ± 0.66%' │ '6031834 ± 132376' │ '157 ± 0.56%'          │ '166 ± 4'              │ 1543    │
│ 5       │ 'Transforms: sensitive endpoints'           │ '84276 ± 0.78%'   │ '74750 ± 2250.0'   │ '12875 ± 0.06%'        │ '13378 ± 407'          │ 118659  │
└─────────┴─────────────────────────────────────────────┴───────────────────┴────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

**SDK Active**
```
npm test benchmarks/bench/sdk-active.bench.ts

┌─────────┬──────────────────────────────────────────────┬───────────────────┬────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                    │ Latency avg (ns)  │ Latency med (ns)   │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼──────────────────────────────────────────────┼───────────────────┼────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'           │ '71375 ± 0.68%'   │ '66334 ± 1834.0'   │ '14879 ± 0.05%'        │ '15075 ± 423'          │ 140106  │
│ 1       │ 'High CPU: POST /api/compute-hash'           │ '463094 ± 2.71%'  │ '386583 ± 7209.0'  │ '2574 ± 0.12%'         │ '2587 ± 48'            │ 21594   │
│ 2       │ 'Large Payload: GET /api/medium (100KB)'     │ '235311 ± 0.27%'  │ '226000 ± 3125.0'  │ '4328 ± 0.08%'         │ '4425 ± 62'            │ 42497   │
│ 3       │ 'Large Payload: GET /api/large (1MB)'        │ '2141630 ± 0.62%' │ '1950958 ± 39208'  │ '482 ± 0.41%'          │ '513 ± 10'             │ 4670    │
│ 4       │ 'Large Payload: POST /api/large-post (1MB)'  │ '6929171 ± 0.62%' │ '6438334 ± 126021' │ '146 ± 0.55%'          │ '155 ± 3'              │ 1444    │
│ 5       │ 'Transforms: sensitive endpoints (no rules)' │ '83723 ± 0.75%'   │ '76041 ± 1751.0'   │ '12838 ± 0.05%'        │ '13151 ± 310'          │ 119442  │
└─────────┴──────────────────────────────────────────────┴───────────────────┴────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

**SDK Active with Transforms**
```
npm test benchmarks/bench/sdk-active-with-transforms.bench.ts

┌─────────┬────────────────────────────────────────────────┬──────────────────┬──────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                      │ Latency avg (ns) │ Latency med (ns) │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼────────────────────────────────────────────────┼──────────────────┼──────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'Transforms: sensitive endpoints (with rules)' │ '91335 ± 0.74%'  │ '82375 ± 6458.0' │ '11852 ± 0.08%'        │ '12140 ± 975'          │ 109487  │
└─────────┴────────────────────────────────────────────────┴──────────────────┴──────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

## Performance Analysis

### SDK Active vs Disabled

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|
| High Throughput: GET /api/simple | +3.6% | -3.2% |
| High CPU: POST /api/compute-hash | +2.8% | -3.3% |
| Large Payload: GET /api/medium (100KB) | -1.5% | +0.7% |
| Large Payload: GET /api/large (1MB) | +0.7% | -0.2% |
| Large Payload: POST /api/large-post (1MB) | +6.9% | -7.0% |
| Transforms: sensitive endpoints | -0.7% | -0.3% |

### Transform Rules vs No Transform Rules

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|
| Transforms: sensitive endpoints | +9.1% | -7.7% |

`/api/simple` models a non-CPU bound workload. All it does is return "hello
world" with the current timestamp.
In this case, we introduce a ~4% increase in latency and ~3% drop in throughput.
It is better than expected.

`/api/compute-hash` models a CPU bound workload. It computes the SHA256 hash of
the input request 1000 times.
There is still around the same performance impact, which is good, as it shows
that we do not introduce any resource contention.
Although I have also seen runs with results close to a 0% diff.

The various `large payload` endpoints just send different sizes of random data
to see if our exporting becomes a bottleneck.
This test is however still a little unfair because we're exporting to filesystem
instead of network which is orders of magnitudes faster.
For small and medium they're well in the error bars, but for `large-post` it
jumps up by 7%.
Could this be because POST requests are saved and GETs are not?

Transforms show a rather large hit to performance at 9%.
This is not surprising though I did not expect it to be that much higher than
our baseline performance impact.
Transforms have to run a matcher function on every request and this impact
scales with the number of matchers you define.
Perhaps some profiling is needed here.
