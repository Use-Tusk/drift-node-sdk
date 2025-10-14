# Benchmarks

These are some benchmarks.
Each benchmark is actually just a AVA test suite that uses tinybench for
measurements and formatting.
At the start of each test suite, we launch a server in `server/test-server.ts`.
Interestingly, it is this server that does all the work rather than the actual
benchmark files.

## Results

Results gathered on Apple M4 Max macOS 26.0.1.

**SDK Disabled (Baseline)**
```
npm test benchmarks/bench/sdk-disabled.bench.ts

┌─────────┬───────────────────────────────────────────────┬───────────────────┬────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)  │ Latency med (ns)   │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼───────────────────┼────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '69078 ± 0.66%'   │ '64916 ± 1666.0'   │ '15329 ± 0.04%'        │ '15405 ± 395'          │ 144764  │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '80576 ± 0.75%'   │ '73500 ± 1875.0'   │ '13328 ± 0.05%'        │ '13605 ± 356'          │ 124106  │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '468764 ± 2.84%'  │ '389000 ± 5500.0'  │ '2559 ± 0.12%'         │ '2571 ± 36'            │ 21333   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '241484 ± 0.32%'  │ '226542 ± 4750.0'  │ '4254 ± 0.10%'         │ '4414 ± 94'            │ 41411   │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '494070 ± 0.23%'  │ '484416 ± 11417'   │ '2053 ± 0.12%'         │ '2064 ± 49'            │ 20241   │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '2205006 ± 0.53%' │ '2025750 ± 57166'  │ '465 ± 0.40%'          │ '494 ± 14'             │ 4536    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '4521437 ± 0.53%' │ '4272125 ± 52376'  │ '224 ± 0.43%'          │ '234 ± 3'              │ 2212    │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '4152334 ± 0.57%' │ '3884000 ± 53625'  │ '245 ± 0.46%'          │ '257 ± 4'              │ 2409    │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '8861893 ± 0.53%' │ '8445458 ± 133333' │ '114 ± 0.47%'          │ '118 ± 2'              │ 1129    │
│ 9       │ 'Transform endpoints'                         │ '81646 ± 0.75%'   │ '74250 ± 1750.0'   │ '13162 ± 0.05%'        │ '13468 ± 324'          │ 122482  │
└─────────┴───────────────────────────────────────────────┴───────────────────┴────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

**SDK Active**
```
npm test benchmarks/bench/sdk-active.bench.ts

┌─────────┬───────────────────────────────────────────────┬─────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)    │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '173353 ± 9.03%'    │ '84583 ± 5292.0'    │ '11917 ± 0.10%'        │ '11823 ± 712'          │ 57856   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '215256 ± 9.70%'    │ '107292 ± 3292.0'   │ '9212 ± 0.10%'         │ '9320 ± 284'           │ 46592   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '658298 ± 8.16%'    │ '441166 ± 12875'    │ '2255 ± 0.17%'         │ '2267 ± 65'            │ 15209   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '1256441 ± 30.09%'  │ '438000 ± 16416'    │ '2244 ± 0.26%'         │ '2283 ± 86'            │ 7959    │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '2886154 ± 35.56%'  │ '1337125 ± 36500'   │ '726 ± 0.45%'          │ '748 ± 21'             │ 3465    │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '7832218 ± 73.99%'  │ '3251750 ± 84875'   │ '285 ± 0.84%'          │ '308 ± 8'              │ 1277    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '25001896 ± 61.91%' │ '10775833 ± 222208' │ '88 ± 1.15%'           │ '93 ± 2'               │ 445     │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '17109041 ± 82.05%' │ '6371959 ± 182834'  │ '147 ± 1.17%'          │ '157 ± 5'              │ 585     │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '42684328 ± 54.58%' │ '21115042 ± 416604' │ '45 ± 1.52%'           │ '47 ± 1'               │ 270     │
│ 9       │ 'Transform endpoints'                         │ '219503 ± 9.98%'    │ '108208 ± 4291.0'   │ '9174 ± 0.10%'         │ '9241 ± 362'           │ 45558   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

**SDK Active with Transforms**
```
npm test benchmarks/bench/sdk-active-with-transforms.bench.ts

┌─────────┬───────────────────────────────────────────────┬─────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)    │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '159993 ± 8.61%'    │ '78875 ± 4208.0'    │ '12794 ± 0.11%'        │ '12678 ± 654'          │ 62503   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '202520 ± 9.46%'    │ '99750 ± 3000.0'    │ '9824 ± 0.10%'         │ '10025 ± 306'          │ 49625   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '624002 ± 8.78%'    │ '403291 ± 5666.0'   │ '2453 ± 0.16%'         │ '2480 ± 35'            │ 16040   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '1139663 ± 28.98%'  │ '380750 ± 17125'    │ '2569 ± 0.25%'         │ '2626 ± 119'           │ 9048    │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '2818801 ± 35.52%'  │ '1327688 ± 39728'   │ '741 ± 0.46%'          │ '753 ± 22'             │ 3584    │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '8111852 ± 76.75%'  │ '3246084 ± 63834'   │ '288 ± 0.85%'          │ '308 ± 6'              │ 1233    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '24268117 ± 60.06%' │ '10779500 ± 204333' │ '88 ± 1.20%'           │ '93 ± 2'               │ 460     │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '17172781 ± 82.41%' │ '6345541 ± 163562'  │ '147 ± 1.16%'          │ '158 ± 4'              │ 584     │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '41597293 ± 54.13%' │ '21129459 ± 806293' │ '46 ± 1.54%'           │ '47 ± 2'               │ 275     │
│ 9       │ 'Transform endpoints'                         │ '223005 ± 9.52%'    │ '113625 ± 5292.0'   │ '8675 ± 0.11%'         │ '8801 ± 409'           │ 45056   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

## Performance Analysis

### SDK Active vs Disabled

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|
| High Throughput: GET /api/simple | +151.0% | -22.3% |
| High Throughput: POST /api/simple-post | +167.1% | -30.9% |
| High CPU: POST /api/compute-hash | +40.4% | -11.9% |
| Large Payload: GET /api/small (100KB) | +420.3% | -47.2% |
| Large Payload: POST /api/small-post (100KB) | +484.2% | -64.6% |
| Large Payload: GET /api/medium (1MB) | +255.2% | -38.7% |
| Large Payload: POST /api/medium-post (1MB) | +452.9% | -60.7% |
| Large Payload: GET /api/large (2MB) | +312.1% | -40.0% |
| Large Payload: POST /api/large-post (2MB) | +381.6% | -60.5% |
| Transform endpoints | +168.9% | -30.3% |

### SDK Active with transforms vs SDK Active without transforms

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|
| High Throughput: GET /api/simple | -7.7% | +7.4% |
| High Throughput: POST /api/simple-post | -5.9% | +6.6% |
| High CPU: POST /api/compute-hash | -5.2% | +8.8% |
| Large Payload: GET /api/small (100KB) | -9.3% | +14.5% |
| Large Payload: POST /api/small-post (100KB) | -2.3% | +2.1% |
| Large Payload: GET /api/medium (1MB) | +3.6% | +1.1% |
| Large Payload: POST /api/medium-post (1MB) | -2.9% | +0.0% |
| Large Payload: GET /api/large (2MB) | +0.4% | +0.0% |
| Large Payload: POST /api/large-post (2MB) | -2.5% | +2.2% |
| Transform endpoints | +1.6% | -5.4% |

`/api/simple` models a non-CPU bound workload. All it does is return "hello
world" with the current timestamp.

`/api/compute-hash` models a CPU bound workload. It computes the SHA256 hash of
the input request 1000 times.

The various `large payload` endpoints just send different sizes of random data
to see if our exporting becomes a bottleneck.
POST requests have a request body of the same size, so the 1MB case actually has
1MB request and 1MB response.
This test is also a little unfair because we're exporting to filesystem
instead of network which is orders of magnitudes faster.

Seems like with or without transforms is around the same impact, within the
error margins.

The results... don't look too good... not only do we cause a huge hit to latency
we also increase the variance by a huge margin which will negatively impact tail
latency.

Profiling is the next step to find out what's causing this, but I can come up
with two probable culprits: hashing and base64.
