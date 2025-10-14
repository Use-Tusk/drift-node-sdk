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
```

**SDK Active**
```
npm test benchmarks/bench/sdk-active.bench.ts
```

**SDK Active with Transforms**
```
npm test benchmarks/bench/sdk-active-with-transforms.bench.ts
```

## Performance Analysis

### SDK Active vs Disabled

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|

### SDK Active with Transforms vs SDK Active (No Transform Rules)

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|

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
POST requests have a request body of the same size, so the 1MB case actually has
1MB request and 1MB response.
This test is also a little unfair because we're exporting to filesystem
instead of network which is orders of magnitudes faster.
Here we see a problematic point and which I believe is caused by base64
encoding. The small post endpoints see a huge hit to performance because they
are smaller and faster and hence encounter the hot path more often.
The GET endpoints don't have a request body and so skip this section.

Transforms show a rather large hit to performance at 9%.
This is not surprising though I did not expect it to be that much higher than
our baseline performance impact.
Transforms have to run a matcher function on every request and this impact
scales with the number of matchers you define.
Perhaps some profiling is needed here.
