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
┌─────────┬───────────────────────────────────────────────┬─────────────────────┬──────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)     │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼──────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '174630 ± 8.98%'    │ '86083 ± 6291.0'     │ '11770 ± 0.11%'        │ '11617 ± 825'          │ 57264   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '219200 ± 9.85%'    │ '109042 ± 4417.0'    │ '9057 ± 0.11%'         │ '9171 ± 373'           │ 45771   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '631806 ± 7.91%'    │ '414584 ± 10834'     │ '2353 ± 0.18%'         │ '2412 ± 63'            │ 15872   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '1132649 ± 29.25%'  │ '382583 ± 17374'     │ '2554 ± 0.27%'         │ '2614 ± 120'           │ 8829    │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '2725766 ± 34.63%'  │ '1313709 ± 51458'    │ '750 ± 0.48%'          │ '761 ± 30'             │ 3669    │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '9189942 ± 69.27%'  │ '3277479 ± 99917'    │ '285 ± 0.82%'          │ '305 ± 9'              │ 1326    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '21941087 ± 54.06%' │ '10767125 ± 219458'  │ '88 ± 1.07%'           │ '93 ± 2'               │ 527     │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '17271959 ± 82.99%' │ '6351667 ± 157500'   │ '147 ± 1.14%'          │ '157 ± 4'              │ 579     │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '40803303 ± 54.09%' │ '21069146 ± 1396813' │ '47 ± 1.56%'           │ '47 ± 3'               │ 284     │
│ 9       │ 'Transform endpoints'                         │ '212848 ± 9.88%'    │ '103000 ± 4209.0'    │ '9529 ± 0.10%'         │ '9709 ± 401'           │ 47104   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴──────────────────────┴────────────────────────┴────────────────────────┴─────────┘
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
| High Throughput: GET /api/simple | +0.7% | -1.2% |
| High Throughput: POST /api/simple-post | +1.8% | -1.7% |
| High CPU: POST /api/compute-hash | -4.0% | +4.3% |
| Large Payload: GET /api/small (100KB) | -9.9% | +13.8% |
| Large Payload: POST /api/small-post (100KB) | -5.6% | +3.3% |
| Large Payload: GET /api/medium (1MB) | +17.3% | +0.0% |
| Large Payload: POST /api/medium-post (1MB) | -12.2% | +0.0% |
| Large Payload: GET /api/large (2MB) | +1.0% | +0.0% |
| Large Payload: POST /api/large-post (2MB) | -4.4% | +4.4% |
| Transform endpoints | -3.0% | +3.9% |

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
error margins. Problem is the error margins are too huge.
