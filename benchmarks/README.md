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

The results... don't look too good... not only do we cause a huge hit to latency
we also increase the variance by a huge margin which will negatively impact tail
latency.

Profiling is the next step to find out what's causing this, but I can come up
with two probable culprits: hashing and base64.


## After merging master

This change removed many unneeded dependencies.

### No sdk
```
┌─────────┬───────────────────────────────────────────────┬───────────────────┬────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)  │ Latency med (ns)   │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼───────────────────┼────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '69465 ± 0.66%'   │ '65166 ± 2082.0'   │ '15234 ± 0.04%'        │ '15345 ± 486'          │ 143958  │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '80828 ± 0.77%'   │ '73334 ± 1792.0'   │ '13323 ± 0.05%'        │ '13636 ± 340'          │ 123721  │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '457796 ± 2.81%'  │ '380084 ± 6874.0'  │ '2621 ± 0.12%'         │ '2631 ± 47'            │ 21844   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '236728 ± 0.25%'  │ '225041 ± 3249.0'  │ '4320 ± 0.09%'         │ '4444 ± 64'            │ 42243   │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '481393 ± 0.23%'  │ '471042 ± 7583.0'  │ '2108 ± 0.12%'         │ '2123 ± 34'            │ 20774   │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '2183309 ± 0.57%' │ '1973458 ± 56833'  │ '472 ± 0.43%'          │ '507 ± 15'             │ 4581    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '4419649 ± 0.54%' │ '4165833 ± 50333'  │ '229 ± 0.43%'          │ '240 ± 3'              │ 2263    │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '4097528 ± 0.60%' │ '3805125 ± 52250'  │ '249 ± 0.48%'          │ '263 ± 4'              │ 2441    │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '8711769 ± 0.53%' │ '8270187 ± 114625' │ '116 ± 0.48%'          │ '121 ± 2'              │ 1148    │
│ 9       │ 'Transform endpoints'                         │ '81938 ± 0.75%'   │ '74625 ± 1667.0'   │ '13118 ± 0.05%'        │ '13400 ± 306'          │ 122044  │
└─────────┴───────────────────────────────────────────────┴───────────────────┴────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

### SDK, no transforms
```
┌─────────┬───────────────────────────────────────────────┬─────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)    │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '173423 ± 9.03%'    │ '84333 ± 5667.0'    │ '11994 ± 0.10%'        │ '11858 ± 774'          │ 57856   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '211033 ± 9.45%'    │ '106625 ± 3584.0'   │ '9281 ± 0.09%'         │ '9379 ± 312'           │ 47616   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '636799 ± 7.36%'    │ '438333 ± 15166'    │ '2273 ± 0.17%'         │ '2281 ± 78'            │ 15707   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '1242702 ± 29.32%'  │ '432375 ± 14250'    │ '2277 ± 0.25%'         │ '2313 ± 77'            │ 8357    │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '2822193 ± 35.31%'  │ '1329292 ± 45938'   │ '738 ± 0.47%'          │ '752 ± 26'             │ 3584    │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '7951635 ± 75.70%'  │ '3234271 ± 56395'   │ '288 ± 0.83%'          │ '309 ± 5'              │ 1258    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '24881532 ± 61.37%' │ '10846396 ± 285854' │ '88 ± 1.19%'           │ '92 ± 2'               │ 452     │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '17311206 ± 83.04%' │ '6373292 ± 160959'  │ '147 ± 1.12%'          │ '157 ± 4'              │ 578     │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '42472819 ± 53.95%' │ '21209250 ± 461479' │ '45 ± 1.53%'           │ '47 ± 1'               │ 274     │
│ 9       │ 'Transform endpoints'                         │ '219743 ± 10.11%'   │ '106958 ± 5125.0'   │ '9257 ± 0.10%'         │ '9349 ± 451'           │ 45568   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

### SDK, with transforms
```
┌─────────┬───────────────────────────────────────────────┬─────────────────────┬──────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)     │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼──────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '171440 ± 8.88%'    │ '84750 ± 4250.0'     │ '11964 ± 0.10%'        │ '11799 ± 574'          │ 58368   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '212817 ± 9.66%'    │ '106209 ± 2834.0'    │ '9330 ± 0.09%'         │ '9415 ± 250'           │ 47104   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '664018 ± 8.34%'    │ '442125 ± 11500'     │ '2252 ± 0.17%'         │ '2262 ± 58'            │ 15060   │
│ 3       │ 'Large Payload: GET /api/small (100KB)'       │ '1156236 ± 29.30%'  │ '402750 ± 20083'     │ '2450 ± 0.26%'         │ '2483 ± 124'           │ 8649    │
│ 4       │ 'Large Payload: POST /api/small-post (100KB)' │ '2709528 ± 34.67%'  │ '1306167 ± 42834'    │ '751 ± 0.44%'          │ '766 ± 25'             │ 3691    │
│ 5       │ 'Large Payload: GET /api/medium (1MB)'        │ '9173578 ± 70.53%'  │ '3224896 ± 55250'    │ '289 ± 0.83%'          │ '310 ± 5'              │ 1272    │
│ 6       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '21762522 ± 54.18%' │ '10700209 ± 210417'  │ '89 ± 1.03%'           │ '93 ± 2'               │ 532     │
│ 7       │ 'Large Payload: GET /api/large (2MB)'         │ '17215511 ± 82.81%' │ '6352916 ± 173541'   │ '147 ± 1.12%'          │ '157 ± 4'              │ 583     │
│ 8       │ 'Large Payload: POST /api/large-post (2MB)'   │ '41292977 ± 54.33%' │ '20994979 ± 1249520' │ '46 ± 1.55%'           │ '48 ± 3'               │ 282     │
│ 9       │ 'Transform endpoints'                         │ '215022 ± 9.82%'    │ '105625 ± 4667.0'    │ '9381 ± 0.10%'         │ '9467 ± 421'           │ 46592   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴──────────────────────┴────────────────────────┴────────────────────────┴─────────┘
```

### SDK Active vs Disabled

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|
| High Throughput: GET /api/simple | +149.6% | -21.3% |
| High Throughput: POST /api/simple-post | +161.1% | -30.3% |
| High CPU: POST /api/compute-hash | +39.1% | -13.3% |
| Large Payload: GET /api/small (100KB) | +424.9% | -47.3% |
| Large Payload: POST /api/small-post (100KB) | +486.2% | -65.0% |
| Large Payload: GET /api/medium (1MB) | +264.2% | -39.0% |
| Large Payload: POST /api/medium-post (1MB) | +462.9% | -61.6% |
| Large Payload: GET /api/large (2MB) | +322.5% | -41.0% |
| Large Payload: POST /api/large-post (2MB) | +387.5% | -61.2% |
| Transform endpoints | +168.2% | -29.4% |

### SDK Active with transforms vs SDK Active without transforms

| Endpoint | Latency Change | Throughput Change |
|----------|---------------|------------------|
| High Throughput: GET /api/simple | -1.1% | -0.3% |
| High Throughput: POST /api/simple-post | +0.8% | +0.5% |
| High CPU: POST /api/compute-hash | +4.3% | -0.9% |
| Large Payload: GET /api/small (100KB) | -7.0% | +7.6% |
| Large Payload: POST /api/small-post (100KB) | -4.0% | +1.8% |
| Large Payload: GET /api/medium (1MB) | +15.4% | +0.3% |
| Large Payload: POST /api/medium-post (1MB) | -12.5% | +1.1% |
| Large Payload: GET /api/large (2MB) | -0.6% | +0.0% |
| Large Payload: POST /api/large-post (2MB) | -2.8% | +2.2% |
| Transform endpoints | -2.1% | +1.3% |

No drastic changes in performance.
