# Benchmarks

These are some benchmarks.
Each benchmark is actually just a AVA test suite that uses tinybench for
measurements and formatting.
At the start of each test suite, we launch a server in `server/test-server.ts`.
Interestingly, it is this server that does all the work rather than the actual
benchmark files.

## Results

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

```
> @use-tusk/drift-node-sdk@0.1.4 test
> ava --workerThreads false benchmarks/bench/sdk-disabled.bench.ts


Test server started at http://127.0.0.1:55253

Test server started at http://127.0.0.1:55253
┌─────────┬───────────────────────────────────────────────┬────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)   │ Latency med (ns)    │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '70512 ± 0.67%'    │ '65625 ± 2458.0'    │ '15041 ± 0.04%'        │ '15238 ± 568'          │ 141820  │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '81212 ± 0.76%'    │ '73041 ± 2000.0'    │ '13302 ± 0.06%'        │ '13691 ± 380'          │ 123135  │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '452968 ± 2.75%'   │ '377000 ± 7500.0'   │ '2640 ± 0.12%'         │ '2653 ± 53'            │ 22077   │
│ 3       │ 'High IO, Low CPU: POST /api/io-bound'        │ '29052511 ± 0.48%' │ '29058041 ± 433958' │ '34 ± 0.39%'           │ '34 ± 1'               │ 345     │
│ 4       │ 'Large Payload: GET /api/small (100KB)'       │ '245133 ± 0.28%'   │ '231167 ± 4083.0'   │ '4184 ± 0.10%'         │ '4326 ± 77'            │ 40795   │
│ 5       │ 'Large Payload: POST /api/small-post (100KB)' │ '487036 ± 0.23%'   │ '475708 ± 7458.0'   │ '2083 ± 0.12%'         │ '2102 ± 33'            │ 20533   │
│ 6       │ 'Large Payload: GET /api/medium (1MB)'        │ '2191494 ± 0.63%'  │ '1992271 ± 39625'   │ '471 ± 0.42%'          │ '502 ± 10'             │ 4564    │
│ 7       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '4535792 ± 0.62%'  │ '4246708 ± 58958'   │ '224 ± 0.47%'          │ '235 ± 3'              │ 2205    │
│ 8       │ 'Large Payload: GET /api/large (2MB)'         │ '4207022 ± 0.66%'  │ '3894541 ± 50416'   │ '243 ± 0.51%'          │ '257 ± 3'              │ 2377    │
│ 9       │ 'Large Payload: POST /api/large-post (2MB)'   │ '8921477 ± 0.61%'  │ '8439458 ± 127416'  │ '113 ± 0.53%'          │ '118 ± 2'              │ 1121    │
│ 10      │ 'Transform endpoints'                         │ '87623 ± 0.73%'    │ '80708 ± 1875.0'    │ '12184 ± 0.05%'        │ '12390 ± 288'          │ 114126  │
└─────────┴───────────────────────────────────────────────┴────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴─────────┘

================================================================================
CPU UTILIZATION PER TASK
================================================================================
CPU Cores: 14

High Throughput: GET /api/simple
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   111.38%
    Average System: 11.55%
    Average Total:  122.93%
    Max User:       131.90%
    Max System:     15.27%
    Max Total:      143.31%

High Throughput: POST /api/simple-post
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   93.59%
    Average System: 7.60%
    Average Total:  101.19%
    Max User:       111.01%
    Max System:     9.71%
    Max Total:      116.90%

High CPU: POST /api/compute-hash
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   7.13%
    Average System: 0.88%
    Average Total:  8.01%
    Max User:       75.72%
    Max System:     11.49%
    Max Total:      81.60%

High IO, Low CPU: POST /api/io-bound
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   104.53%
    Average System: 9.89%
    Average Total:  114.41%
    Max User:       149.96%
    Max System:     16.88%
    Max Total:      166.84%

Large Payload: GET /api/small (100KB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   97.69%
    Average System: 12.50%
    Average Total:  110.19%
    Max User:       135.23%
    Max System:     14.89%
    Max Total:      143.60%

Large Payload: POST /api/small-post (100KB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   123.37%
    Average System: 20.01%
    Average Total:  143.38%
    Max User:       148.59%
    Max System:     22.45%
    Max Total:      168.90%

Large Payload: GET /api/medium (1MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   107.96%
    Average System: 17.03%
    Average Total:  125.00%
    Max User:       118.18%
    Max System:     19.01%
    Max Total:      136.81%

Large Payload: POST /api/medium-post (1MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   117.52%
    Average System: 18.30%
    Average Total:  135.82%
    Max User:       135.88%
    Max System:     19.77%
    Max Total:      153.77%

Large Payload: GET /api/large (2MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   109.41%
    Average System: 15.76%
    Average Total:  125.17%
    Max User:       122.92%
    Max System:     17.20%
    Max Total:      138.69%

Large Payload: POST /api/large-post (2MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   109.89%
    Average System: 9.63%
    Average Total:  119.52%
    Max User:       129.12%
    Max System:     18.79%
    Max Total:      138.72%

Transform endpoints
--------------------------------------------------------------------------------
  No CPU data collected

================================================================================

High Throughput: GET /api/simple
--------------------------------------------------------------------------------
       0ns - 0ns        │ 141517
       0ns - 0ns        │     64
       0ns - 1ns        │      3
       1ns - 1ns        │      1
       1ns - 1ns        │      0
       1ns - 1ns        │      1
       1ns - 1ns        │      9
       1ns - 1ns        │     12
       1ns - 2ns        │      6
       2ns - 2ns        │      7
       2ns - 2ns        │     25
       2ns - 2ns        │      5
       2ns - 2ns        │      2
       2ns - 2ns        │     21
       2ns - 2ns        │     72
       2ns - 3ns        │     30
       3ns - 3ns        │     16
       3ns - 3ns        │     23
       3ns - 3ns        │      4
       3ns - 3ns        │      2

High Throughput: POST /api/simple-post
--------------------------------------------------------------------------------
       0ns - 0ns        │ 122757
       0ns - 0ns        │     82
       0ns - 1ns        │      6
       1ns - 1ns        │      1
       1ns - 1ns        │      0
       1ns - 1ns        │      5
       1ns - 1ns        │      7
       1ns - 2ns        │     19
       2ns - 2ns        │     24
       2ns - 2ns        │     25
       2ns - 2ns        │      2
       2ns - 2ns        │     10
       2ns - 2ns        │     71
       2ns - 3ns        │     71
       3ns - 3ns        │     15
       3ns - 3ns        │     33
       3ns - 3ns        │      5
       3ns - 3ns        │      0
       3ns - 4ns        │      0
       4ns - 4ns        │      2

High CPU: POST /api/compute-hash
--------------------------------------------------------------------------------
       0ns - 1ns        │  21928
       1ns - 2ns        │      3
       2ns - 2ns        │      5
       2ns - 3ns        │      0
       3ns - 3ns        │      0
       3ns - 4ns        │      0
       4ns - 5ns        │      0
       5ns - 5ns        │      0
       5ns - 6ns        │      0
       6ns - 7ns        │      0
       7ns - 7ns        │      1
       7ns - 8ns        │      0
       8ns - 8ns        │      0
       8ns - 9ns        │      0
       9ns - 10ns       │      0
      10ns - 10ns       │      0
      10ns - 11ns       │      0
      11ns - 12ns       │      0
      12ns - 12ns       │     83
      12ns - 13ns       │     57

High IO, Low CPU: POST /api/io-bound
--------------------------------------------------------------------------------
      26ns - 27ns       │      2
      27ns - 28ns       │     24
      28ns - 29ns       │     99
      29ns - 30ns       │    194
      30ns - 31ns       │     20
      31ns - 32ns       │      2
      32ns - 33ns       │      0
      33ns - 34ns       │      0
      34ns - 35ns       │      2
      35ns - 36ns       │      1
      36ns - 37ns       │      0
      37ns - 38ns       │      0
      38ns - 39ns       │      0
      39ns - 40ns       │      0
      40ns - 41ns       │      0
      41ns - 42ns       │      0
      42ns - 43ns       │      0
      43ns - 45ns       │      0
      45ns - 46ns       │      0
      46ns - 47ns       │      1

Large Payload: GET /api/small (100KB)
--------------------------------------------------------------------------------
       0ns - 0ns        │  40163
       0ns - 1ns        │    168
       1ns - 1ns        │    156
       1ns - 1ns        │    192
       1ns - 1ns        │     45
       1ns - 1ns        │     35
       1ns - 1ns        │     16
       1ns - 1ns        │      5
       1ns - 2ns        │      5
       2ns - 2ns        │      5
       2ns - 2ns        │      1
       2ns - 2ns        │      1
       2ns - 2ns        │      0
       2ns - 2ns        │      0
       2ns - 3ns        │      2
       3ns - 3ns        │      0
       3ns - 3ns        │      0
       3ns - 3ns        │      0
       3ns - 3ns        │      0
       3ns - 3ns        │      1

Large Payload: POST /api/small-post (100KB)
--------------------------------------------------------------------------------
       0ns - 0ns        │  19155
       0ns - 1ns        │    662
       1ns - 1ns        │    201
       1ns - 1ns        │     38
       1ns - 1ns        │     46
       1ns - 1ns        │     61
       1ns - 1ns        │     17
       1ns - 1ns        │    190
       1ns - 1ns        │     80
       1ns - 1ns        │     13
       1ns - 1ns        │      3
       1ns - 1ns        │     42
       1ns - 1ns        │     20
       1ns - 1ns        │      1
       1ns - 1ns        │      2
       1ns - 2ns        │      0
       2ns - 2ns        │      0
       2ns - 2ns        │      1
       2ns - 2ns        │      0
       2ns - 2ns        │      1

Large Payload: GET /api/medium (1MB)
--------------------------------------------------------------------------------
       2ns - 2ns        │   3302
       2ns - 2ns        │    307
       2ns - 2ns        │     81
       2ns - 3ns        │    384
       3ns - 3ns        │     12
       3ns - 3ns        │      4
       3ns - 3ns        │      9
       3ns - 3ns        │     72
       3ns - 3ns        │    145
       3ns - 3ns        │     73
       3ns - 4ns        │     57
       4ns - 4ns        │     40
       4ns - 4ns        │     27
       4ns - 4ns        │     20
       4ns - 4ns        │     14
       4ns - 4ns        │      9
       4ns - 5ns        │      4
       5ns - 5ns        │      1
       5ns - 5ns        │      0
       5ns - 5ns        │      3

Large Payload: POST /api/medium-post (1MB)
--------------------------------------------------------------------------------
       4ns - 4ns        │   1035
       4ns - 4ns        │    634
       4ns - 5ns        │     71
       5ns - 5ns        │      6
       5ns - 5ns        │     76
       5ns - 5ns        │     49
       5ns - 5ns        │     83
       5ns - 5ns        │     21
       5ns - 5ns        │      2
       5ns - 6ns        │      1
       6ns - 6ns        │      0
       6ns - 6ns        │      2
       6ns - 6ns        │     10
       6ns - 6ns        │     54
       6ns - 6ns        │     83
       6ns - 7ns        │     47
       7ns - 7ns        │     21
       7ns - 7ns        │      3
       7ns - 7ns        │      3
       7ns - 7ns        │      4

Large Payload: GET /api/large (2MB)
--------------------------------------------------------------------------------
       4ns - 4ns        │   1285
       4ns - 4ns        │    494
       4ns - 4ns        │    121
       4ns - 4ns        │     85
       4ns - 5ns        │     11
       5ns - 5ns        │      2
       5ns - 5ns        │      0
       5ns - 5ns        │      3
       5ns - 5ns        │      1
       5ns - 5ns        │     18
       5ns - 5ns        │     57
       5ns - 6ns        │     70
       6ns - 6ns        │     61
       6ns - 6ns        │     82
       6ns - 6ns        │     53
       6ns - 6ns        │     26
       6ns - 6ns        │      5
       6ns - 7ns        │      1
       7ns - 7ns        │      0
       7ns - 7ns        │      2

Large Payload: POST /api/large-post (2MB)
--------------------------------------------------------------------------------
       8ns - 8ns        │    114
       8ns - 8ns        │    528
       8ns - 9ns        │    116
       9ns - 9ns        │     78
       9ns - 9ns        │      8
       9ns - 9ns        │     11
       9ns - 9ns        │     36
       9ns - 10ns       │      3
      10ns - 10ns       │      0
      10ns - 10ns       │      0
      10ns - 10ns       │      1
      10ns - 10ns       │      4
      10ns - 10ns       │     50
      10ns - 11ns       │     56
      11ns - 11ns       │     57
      11ns - 11ns       │     29
      11ns - 11ns       │     18
      11ns - 11ns       │      5
      11ns - 12ns       │      5
      12ns - 12ns       │      2

Transform endpoints
--------------------------------------------------------------------------------
       0ns - 0ns        │ 113802
       0ns - 0ns        │     39
       0ns - 1ns        │     17
       1ns - 1ns        │      2
       1ns - 1ns        │      0
       1ns - 1ns        │      1
       1ns - 1ns        │      2
       1ns - 1ns        │      4
       1ns - 2ns        │      8
       2ns - 2ns        │      7
       2ns - 2ns        │     37
       2ns - 2ns        │      6
       2ns - 2ns        │      2
       2ns - 2ns        │     20
       2ns - 2ns        │     55
       2ns - 3ns        │     76
       3ns - 3ns        │     34
       3ns - 3ns        │     12
       3ns - 3ns        │      0
       3ns - 3ns        │      2
  ✔ SDK Active (2m 3.2s)
Test server stopped
Test server stopped

  ─

  1 test passed

> @use-tusk/drift-node-sdk@0.1.4 test
> ava --workerThreads false benchmarks/bench/sdk-active.bench.ts


2025-10-15T02:55:22.764Z [TuskDrift] SDK initialized successfully
2025-10-15T02:55:22.764Z [TuskDrift] Record mode active - capturing requests and responses
Test server started at http://127.0.0.1:55271

Test server started at http://127.0.0.1:55271
┌─────────┬───────────────────────────────────────────────┬─────────────────────┬──────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)     │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼──────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '173020 ± 9.05%'    │ '84083 ± 5458.0'     │ '11989 ± 0.10%'        │ '11893 ± 741'          │ 57797   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '214809 ± 9.71%'    │ '106542 ± 3583.0'    │ '9296 ± 0.10%'         │ '9386 ± 312'           │ 46651   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '651087 ± 7.85%'    │ '442188 ± 16354'     │ '2250 ± 0.17%'         │ '2261 ± 84'            │ 15360   │
│ 3       │ 'High IO, Low CPU: POST /api/io-bound'        │ '28463766 ± 0.24%'  │ '28616958 ± 88042'   │ '35 ± 0.23%'           │ '35 ± 0'               │ 352     │
│ 4       │ 'Large Payload: GET /api/small (100KB)'       │ '1219685 ± 29.80%'  │ '428750 ± 14208'     │ '2295 ± 0.25%'         │ '2332 ± 78'            │ 8199    │
│ 5       │ 'Large Payload: POST /api/small-post (100KB)' │ '2703030 ± 33.99%'  │ '1316583 ± 43792'    │ '742 ± 0.44%'          │ '760 ± 25'             │ 3700    │
│ 6       │ 'Large Payload: GET /api/medium (1MB)'        │ '9751246 ± 75.54%'  │ '3253291 ± 63791'    │ '286 ± 0.92%'          │ '307 ± 6'              │ 1114    │
│ 7       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '22243020 ± 54.49%' │ '10789875 ± 214667'  │ '88 ± 1.11%'           │ '93 ± 2'               │ 523     │
│ 8       │ 'Large Payload: GET /api/large (2MB)'         │ '17715111 ± 83.52%' │ '6409604 ± 189125'   │ '145 ± 1.20%'          │ '156 ± 5'              │ 570     │
│ 9       │ 'Large Payload: POST /api/large-post (2MB)'   │ '41876755 ± 54.40%' │ '21171813 ± 1338354' │ '46 ± 1.60%'           │ '47 ± 3'               │ 280     │
│ 10      │ 'Transform endpoints'                         │ '218676 ± 10.19%'   │ '105417 ± 4833.0'    │ '9389 ± 0.10%'         │ '9486 ± 436'           │ 45730   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴──────────────────────┴────────────────────────┴────────────────────────┴─────────┘

================================================================================
CPU UTILIZATION PER TASK
================================================================================
CPU Cores: 14

High Throughput: GET /api/simple
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   81.89%
    Average System: 24.43%
    Average Total:  106.32%
    Max User:       112.93%
    Max System:     28.40%
    Max Total:      139.99%

High Throughput: POST /api/simple-post
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   87.65%
    Average System: 9.39%
    Average Total:  97.04%
    Max User:       119.53%
    Max System:     24.47%
    Max Total:      124.82%

High CPU: POST /api/compute-hash
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   2.17%
    Average System: 0.37%
    Average Total:  2.54%
    Max User:       44.24%
    Max System:     5.28%
    Max Total:      45.72%

High IO, Low CPU: POST /api/io-bound
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   77.13%
    Average System: 26.50%
    Average Total:  103.63%
    Max User:       98.04%
    Max System:     48.72%
    Max Total:      132.05%

Large Payload: GET /api/small (100KB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   82.14%
    Average System: 27.34%
    Average Total:  109.49%
    Max User:       107.43%
    Max System:     43.41%
    Max Total:      134.15%

Large Payload: POST /api/small-post (100KB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   135.85%
    Average System: 19.18%
    Average Total:  155.04%
    Max User:       158.63%
    Max System:     42.18%
    Max Total:      177.68%

Large Payload: GET /api/medium (1MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   130.83%
    Average System: 15.28%
    Average Total:  146.11%
    Max User:       144.01%
    Max System:     36.30%
    Max Total:      158.27%

Large Payload: POST /api/medium-post (1MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   138.83%
    Average System: 16.77%
    Average Total:  155.61%
    Max User:       159.76%
    Max System:     36.99%
    Max Total:      176.57%

Large Payload: GET /api/large (2MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   131.76%
    Average System: 13.23%
    Average Total:  144.98%
    Max User:       143.09%
    Max System:     35.39%
    Max Total:      155.59%

Large Payload: POST /api/large-post (2MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   78.64%
    Average System: 22.53%
    Average Total:  101.16%
    Max User:       115.15%
    Max System:     33.23%
    Max Total:      148.39%

Transform endpoints
--------------------------------------------------------------------------------
  No CPU data collected

================================================================================

High Throughput: GET /api/simple
--------------------------------------------------------------------------------
       0ns - 3ns        │  57683
       3ns - 6ns        │      1
       6ns - 9ns        │      0
       9ns - 12ns       │      0
      12ns - 15ns       │      1
      15ns - 18ns       │      0
      18ns - 21ns       │      0
      21ns - 24ns       │      0
      24ns - 27ns       │      0
      27ns - 30ns       │      0
      30ns - 33ns       │      0
      33ns - 36ns       │     10
      36ns - 39ns       │     20
      39ns - 42ns       │     18
      42ns - 45ns       │     12
      45ns - 48ns       │     29
      48ns - 51ns       │     18
      51ns - 54ns       │      3
      54ns - 57ns       │      0
      57ns - 60ns       │      2

High Throughput: POST /api/simple-post
--------------------------------------------------------------------------------
       0ns - 4ns        │  46558
       4ns - 7ns        │      1
       7ns - 11ns       │      0
      11ns - 15ns       │      0
      15ns - 19ns       │      0
      19ns - 22ns       │      0
      22ns - 26ns       │      0
      26ns - 30ns       │      0
      30ns - 33ns       │      0
      33ns - 37ns       │      0
      37ns - 41ns       │      0
      41ns - 45ns       │     12
      45ns - 48ns       │     14
      48ns - 52ns       │     23
      52ns - 56ns       │     31
      56ns - 59ns       │      6
      59ns - 63ns       │      1
      63ns - 67ns       │      2
      67ns - 70ns       │      2
      70ns - 74ns       │      1

High CPU: POST /api/compute-hash
--------------------------------------------------------------------------------
       0ns - 6ns        │  15231
       6ns - 11ns       │     15
      11ns - 16ns       │     83
      16ns - 21ns       │      1
      21ns - 26ns       │      0
      26ns - 32ns       │      0
      32ns - 37ns       │      1
      37ns - 42ns       │      2
      42ns - 47ns       │      2
      47ns - 52ns       │      4
      52ns - 58ns       │      0
      58ns - 63ns       │      2
      63ns - 68ns       │      1
      68ns - 73ns       │      4
      73ns - 79ns       │      6
      79ns - 84ns       │      2
      84ns - 89ns       │      2
      89ns - 94ns       │      2
      94ns - 99ns       │      1
      99ns - 105ns      │      1

High IO, Low CPU: POST /api/io-bound
--------------------------------------------------------------------------------
      26ns - 27ns       │      2
      27ns - 27ns       │      6
      27ns - 28ns       │     48
      28ns - 28ns       │     12
      28ns - 29ns       │     78
      29ns - 29ns       │    201
      29ns - 29ns       │      0
      29ns - 30ns       │      0
      30ns - 30ns       │      1
      30ns - 31ns       │      1
      31ns - 31ns       │      0
      31ns - 32ns       │      0
      32ns - 32ns       │      1
      32ns - 32ns       │      1
      32ns - 33ns       │      0
      33ns - 33ns       │      0
      33ns - 34ns       │      0
      34ns - 34ns       │      0
      34ns - 35ns       │      0
      35ns - 35ns       │      1

Large Payload: GET /api/small (100KB)
--------------------------------------------------------------------------------
       0ns - 21ns       │   8177
      21ns - 42ns       │      6
      42ns - 63ns       │      0
      63ns - 84ns       │      0
      84ns - 105ns      │      0
     105ns - 126ns      │      0
     126ns - 147ns      │      0
     147ns - 168ns      │      0
     168ns - 189ns      │      1
     189ns - 210ns      │      0
     210ns - 230ns      │      0
     230ns - 251ns      │      0
     251ns - 272ns      │      0
     272ns - 293ns      │      0
     293ns - 314ns      │      0
     314ns - 335ns      │      0
     335ns - 356ns      │      0
     356ns - 377ns      │      3
     377ns - 398ns      │      8
     398ns - 419ns      │      4

Large Payload: POST /api/small-post (100KB)
--------------------------------------------------------------------------------
       1ns - 37ns       │   3693
      37ns - 72ns       │      0
      72ns - 108ns      │      0
     108ns - 143ns      │      0
     143ns - 179ns      │      0
     179ns - 214ns      │      0
     214ns - 250ns      │      0
     250ns - 286ns      │      0
     286ns - 321ns      │      0
     321ns - 357ns      │      0
     357ns - 392ns      │      0
     392ns - 428ns      │      0
     428ns - 463ns      │      0
     463ns - 499ns      │      0
     499ns - 535ns      │      1
     535ns - 570ns      │      0
     570ns - 606ns      │      0
     606ns - 641ns      │      0
     641ns - 677ns      │      3
     677ns - 712ns      │      3

Large Payload: GET /api/medium (1MB)
--------------------------------------------------------------------------------
       3ns - 146ns      │   1111
     146ns - 290ns      │      0
     290ns - 433ns      │      0
     433ns - 577ns      │      0
     577ns - 720ns      │      0
     720ns - 864ns      │      0
     864ns - 1.01μs     │      0
    1.01μs - 1.15μs     │      1
    1.15μs - 1.29μs     │      0
    1.29μs - 1.44μs     │      0
    1.44μs - 1.58μs     │      0
    1.58μs - 1.72μs     │      0
    1.72μs - 1.87μs     │      0
    1.87μs - 2.01μs     │      0
    2.01μs - 2.15μs     │      0
    2.15μs - 2.30μs     │      0
    2.30μs - 2.44μs     │      0
    2.44μs - 2.58μs     │      0
    2.58μs - 2.73μs     │      0
    2.73μs - 2.87μs     │      2

Large Payload: POST /api/medium-post (1MB)
--------------------------------------------------------------------------------
      10ns - 105ns      │    520
     105ns - 199ns      │      0
     199ns - 293ns      │      0
     293ns - 387ns      │      0
     387ns - 481ns      │      0
     481ns - 575ns      │      0
     575ns - 669ns      │      0
     669ns - 764ns      │      0
     764ns - 858ns      │      0
     858ns - 952ns      │      0
     952ns - 1.05μs     │      0
    1.05μs - 1.14μs     │      0
    1.14μs - 1.23μs     │      0
    1.23μs - 1.33μs     │      0
    1.33μs - 1.42μs     │      0
    1.42μs - 1.52μs     │      0
    1.52μs - 1.61μs     │      0
    1.61μs - 1.71μs     │      0
    1.71μs - 1.80μs     │      0
    1.80μs - 1.89μs     │      3

Large Payload: GET /api/large (2MB)
--------------------------------------------------------------------------------
       6ns - 160ns      │    568
     160ns - 314ns      │      0
     314ns - 468ns      │      0
     468ns - 622ns      │      0
     622ns - 776ns      │      0
     776ns - 930ns      │      0
     930ns - 1.08μs     │      0
    1.08μs - 1.24μs     │      0
    1.24μs - 1.39μs     │      0
    1.39μs - 1.55μs     │      0
    1.55μs - 1.70μs     │      0
    1.70μs - 1.86μs     │      0
    1.86μs - 2.01μs     │      0
    2.01μs - 2.16μs     │      0
    2.16μs - 2.32μs     │      0
    2.32μs - 2.47μs     │      0
    2.47μs - 2.63μs     │      0
    2.63μs - 2.78μs     │      0
    2.78μs - 2.93μs     │      0
    2.93μs - 3.09μs     │      2

Large Payload: POST /api/large-post (2MB)
--------------------------------------------------------------------------------
      19ns - 116ns      │    277
     116ns - 212ns      │      0
     212ns - 309ns      │      0
     309ns - 406ns      │      0
     406ns - 502ns      │      0
     502ns - 599ns      │      0
     599ns - 695ns      │      0
     695ns - 792ns      │      0
     792ns - 888ns      │      0
     888ns - 985ns      │      0
     985ns - 1.08μs     │      0
    1.08μs - 1.18μs     │      0
    1.18μs - 1.27μs     │      0
    1.27μs - 1.37μs     │      0
    1.37μs - 1.47μs     │      0
    1.47μs - 1.56μs     │      0
    1.56μs - 1.66μs     │      0
    1.66μs - 1.76μs     │      0
    1.76μs - 1.85μs     │      1
    1.85μs - 1.95μs     │      2

Transform endpoints
--------------------------------------------------------------------------------
       0ns - 4ns        │  45636
       4ns - 8ns        │      4
       8ns - 12ns       │      0
      12ns - 16ns       │      0
      16ns - 20ns       │      1
      20ns - 24ns       │      0
      24ns - 28ns       │      0
      28ns - 33ns       │      0
      33ns - 37ns       │      0
      37ns - 41ns       │      0
      41ns - 45ns       │      0
      45ns - 49ns       │     12
      49ns - 53ns       │     36
      53ns - 57ns       │     13
      57ns - 61ns       │     12
      61ns - 65ns       │     10
      65ns - 69ns       │      2
      69ns - 73ns       │      2
      73ns - 77ns       │      1
      77ns - 81ns       │      1
  ✔ SDK Active (2m 14.8s)
Test server stopped
Test server stopped

  ─

  1 test passed

> @use-tusk/drift-node-sdk@0.1.4 test
> ava --workerThreads false benchmarks/bench/sdk-active-with-transforms.bench.ts


2025-10-15T02:57:54.931Z [TuskDrift] SDK initialized successfully
2025-10-15T02:57:54.931Z [TuskDrift] Record mode active - capturing requests and responses
Test server started at http://127.0.0.1:55288

Test server started at http://127.0.0.1:55288
┌─────────┬───────────────────────────────────────────────┬─────────────────────┬─────────────────────┬────────────────────────┬────────────────────────┬─────────┐
│ (index) │ Task name                                     │ Latency avg (ns)    │ Latency med (ns)    │ Throughput avg (ops/s) │ Throughput med (ops/s) │ Samples │
├─────────┼───────────────────────────────────────────────┼─────────────────────┼─────────────────────┼────────────────────────┼────────────────────────┼─────────┤
│ 0       │ 'High Throughput: GET /api/simple'            │ '173096 ± 9.04%'    │ '83958 ± 5459.0'    │ '12030 ± 0.10%'        │ '11911 ± 748'          │ 57856   │
│ 1       │ 'High Throughput: POST /api/simple-post'      │ '210141 ± 9.45%'    │ '106250 ± 3250.0'   │ '9318 ± 0.09%'         │ '9412 ± 286'           │ 47616   │
│ 2       │ 'High CPU: POST /api/compute-hash'            │ '635751 ± 7.39%'    │ '437416 ± 15124'    │ '2272 ± 0.17%'         │ '2286 ± 78'            │ 15730   │
│ 3       │ 'High IO, Low CPU: POST /api/io-bound'        │ '28526969 ± 0.63%'  │ '28596666 ± 73375'  │ '35 ± 0.38%'           │ '35 ± 0'               │ 351     │
│ 4       │ 'Large Payload: GET /api/small (100KB)'       │ '1258328 ± 29.81%'  │ '437083 ± 16542'    │ '2252 ± 0.26%'         │ '2288 ± 87'            │ 8187    │
│ 5       │ 'Large Payload: POST /api/small-post (100KB)' │ '2936455 ± 35.26%'  │ '1363416 ± 38126'   │ '714 ± 0.45%'          │ '733 ± 21'             │ 3584    │
│ 6       │ 'Large Payload: GET /api/medium (1MB)'        │ '8600230 ± 79.40%'  │ '3261250 ± 60250'   │ '285 ± 0.90%'          │ '307 ± 6'              │ 1163    │
│ 7       │ 'Large Payload: POST /api/medium-post (1MB)'  │ '23975541 ± 59.04%' │ '10819958 ± 271041' │ '88 ± 1.22%'           │ '92 ± 2'               │ 478     │
│ 8       │ 'Large Payload: GET /api/large (2MB)'         │ '17169070 ± 82.15%' │ '6425125 ± 525583'  │ '147 ± 1.26%'          │ '156 ± 14'             │ 583     │
│ 9       │ 'Large Payload: POST /api/large-post (2MB)'   │ '41177643 ± 55.23%' │ '20204666 ± 627374' │ '47 ± 1.48%'           │ '49 ± 2'               │ 285     │
│ 10      │ 'Transform endpoints'                         │ '217260 ± 10.05%'   │ '105500 ± 4750.0'   │ '9384 ± 0.10%'         │ '9479 ± 429'           │ 46080   │
└─────────┴───────────────────────────────────────────────┴─────────────────────┴─────────────────────┴────────────────────────┴────────────────────────┴─────────┘

================================================================================
CPU UTILIZATION PER TASK
================================================================================
CPU Cores: 14

High Throughput: GET /api/simple
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   83.25%
    Average System: 23.65%
    Average Total:  106.90%
    Max User:       114.32%
    Max System:     26.28%
    Max Total:      138.83%

High Throughput: POST /api/simple-post
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   88.66%
    Average System: 9.68%
    Average Total:  98.35%
    Max User:       132.64%
    Max System:     25.41%
    Max Total:      137.13%

High CPU: POST /api/compute-hash
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   2.83%
    Average System: 0.57%
    Average Total:  3.40%
    Max User:       97.83%
    Max System:     14.01%
    Max Total:      101.99%

High IO, Low CPU: POST /api/io-bound
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   75.37%
    Average System: 29.01%
    Average Total:  104.38%
    Max User:       101.50%
    Max System:     48.78%
    Max Total:      137.11%

Large Payload: GET /api/small (100KB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   79.85%
    Average System: 29.66%
    Average Total:  109.52%
    Max User:       104.39%
    Max System:     47.12%
    Max Total:      131.98%

Large Payload: POST /api/small-post (100KB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   138.11%
    Average System: 20.33%
    Average Total:  158.44%
    Max User:       162.53%
    Max System:     42.14%
    Max Total:      182.15%

Large Payload: GET /api/medium (1MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   130.39%
    Average System: 15.65%
    Average Total:  146.04%
    Max User:       142.77%
    Max System:     33.31%
    Max Total:      158.12%

Large Payload: POST /api/medium-post (1MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   137.17%
    Average System: 17.04%
    Average Total:  154.21%
    Max User:       158.53%
    Max System:     41.48%
    Max Total:      180.80%

Large Payload: GET /api/large (2MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   132.43%
    Average System: 13.10%
    Average Total:  145.53%
    Max User:       142.14%
    Max System:     33.96%
    Max Total:      162.57%

Large Payload: POST /api/large-post (2MB)
--------------------------------------------------------------------------------
  Process CPU Usage:
    Average User:   80.57%
    Average System: 22.66%
    Average Total:  103.23%
    Max User:       112.22%
    Max System:     31.50%
    Max Total:      133.92%

Transform endpoints
--------------------------------------------------------------------------------
  No CPU data collected

================================================================================

High Throughput: GET /api/simple
--------------------------------------------------------------------------------
       0ns - 3ns        │  57742
       3ns - 6ns        │      1
       6ns - 9ns        │      0
       9ns - 12ns       │      0
      12ns - 15ns       │      0
      15ns - 18ns       │      0
      18ns - 21ns       │      0
      21ns - 24ns       │      0
      24ns - 27ns       │      0
      27ns - 29ns       │      0
      29ns - 32ns       │      0
      32ns - 35ns       │      9
      35ns - 38ns       │     22
      38ns - 41ns       │     12
      41ns - 44ns       │     14
      44ns - 47ns       │     30
      47ns - 50ns       │     14
      50ns - 53ns       │      7
      53ns - 56ns       │      4
      56ns - 59ns       │      1

High Throughput: POST /api/simple-post
--------------------------------------------------------------------------------
       0ns - 4ns        │  47523
       4ns - 8ns        │      0
       8ns - 12ns       │      0
      12ns - 16ns       │      0
      16ns - 20ns       │      0
      20ns - 24ns       │      0
      24ns - 29ns       │      0
      29ns - 33ns       │      0
      33ns - 37ns       │      0
      37ns - 41ns       │      3
      41ns - 45ns       │     14
      45ns - 49ns       │     17
      49ns - 53ns       │     39
      53ns - 57ns       │     17
      57ns - 61ns       │      1
      61ns - 65ns       │      1
      65ns - 69ns       │      0
      69ns - 73ns       │      0
      73ns - 77ns       │      0
      77ns - 81ns       │      1

High CPU: POST /api/compute-hash
--------------------------------------------------------------------------------
       0ns - 5ns        │  15597
       5ns - 10ns       │     16
      10ns - 15ns       │     87
      15ns - 20ns       │      0
      20ns - 25ns       │      0
      25ns - 30ns       │      0
      30ns - 35ns       │      0
      35ns - 40ns       │      1
      40ns - 44ns       │      0
      44ns - 49ns       │      5
      49ns - 54ns       │      3
      54ns - 59ns       │      4
      59ns - 64ns       │      4
      64ns - 69ns       │      3
      69ns - 74ns       │      4
      74ns - 79ns       │      1
      79ns - 84ns       │      0
      84ns - 89ns       │      1
      89ns - 93ns       │      3
      93ns - 98ns       │      1

High IO, Low CPU: POST /api/io-bound
--------------------------------------------------------------------------------
      26ns - 28ns       │     64
      28ns - 29ns       │    269
      29ns - 31ns       │     14
      31ns - 33ns       │      3
      33ns - 34ns       │      0
      34ns - 36ns       │      0
      36ns - 37ns       │      0
      37ns - 39ns       │      0
      39ns - 40ns       │      0
      40ns - 42ns       │      0
      42ns - 44ns       │      0
      44ns - 45ns       │      0
      45ns - 47ns       │      0
      47ns - 48ns       │      0
      48ns - 50ns       │      0
      50ns - 51ns       │      0
      51ns - 53ns       │      0
      53ns - 55ns       │      0
      55ns - 56ns       │      0
      56ns - 58ns       │      1

Large Payload: GET /api/small (100KB)
--------------------------------------------------------------------------------
       0ns - 22ns       │   8166
      22ns - 44ns       │      5
      44ns - 66ns       │      0
      66ns - 88ns       │      0
      88ns - 110ns      │      0
     110ns - 132ns      │      0
     132ns - 154ns      │      0
     154ns - 176ns      │      0
     176ns - 197ns      │      0
     197ns - 219ns      │      0
     219ns - 241ns      │      0
     241ns - 263ns      │      0
     263ns - 285ns      │      0
     285ns - 307ns      │      0
     307ns - 329ns      │      0
     329ns - 351ns      │      0
     351ns - 373ns      │      2
     373ns - 395ns      │      7
     395ns - 416ns      │      6
     416ns - 438ns      │      1

Large Payload: POST /api/small-post (100KB)
--------------------------------------------------------------------------------
       1ns - 40ns       │   3577
      40ns - 78ns       │      0
      78ns - 116ns      │      0
     116ns - 155ns      │      0
     155ns - 193ns      │      0
     193ns - 231ns      │      0
     231ns - 270ns      │      0
     270ns - 308ns      │      0
     308ns - 346ns      │      0
     346ns - 385ns      │      0
     385ns - 423ns      │      0
     423ns - 461ns      │      0
     461ns - 500ns      │      0
     500ns - 538ns      │      0
     538ns - 576ns      │      0
     576ns - 615ns      │      0
     615ns - 653ns      │      0
     653ns - 691ns      │      0
     691ns - 730ns      │      6
     730ns - 768ns      │      1

Large Payload: GET /api/medium (1MB)
--------------------------------------------------------------------------------
       3ns - 147ns      │   1161
     147ns - 291ns      │      0
     291ns - 435ns      │      0
     435ns - 580ns      │      0
     580ns - 724ns      │      0
     724ns - 868ns      │      0
     868ns - 1.01μs     │      0
    1.01μs - 1.16μs     │      0
    1.16μs - 1.30μs     │      0
    1.30μs - 1.44μs     │      0
    1.44μs - 1.59μs     │      0
    1.59μs - 1.73μs     │      0
    1.73μs - 1.88μs     │      0
    1.88μs - 2.02μs     │      0
    2.02μs - 2.17μs     │      0
    2.17μs - 2.31μs     │      0
    2.31μs - 2.45μs     │      0
    2.45μs - 2.60μs     │      0
    2.60μs - 2.74μs     │      0
    2.74μs - 2.89μs     │      2

Large Payload: POST /api/medium-post (1MB)
--------------------------------------------------------------------------------
      10ns - 119ns      │    475
     119ns - 228ns      │      0
     228ns - 338ns      │      0
     338ns - 447ns      │      0
     447ns - 556ns      │      0
     556ns - 665ns      │      0
     665ns - 775ns      │      0
     775ns - 884ns      │      0
     884ns - 993ns      │      0
     993ns - 1.10μs     │      0
    1.10μs - 1.21μs     │      0
    1.21μs - 1.32μs     │      0
    1.32μs - 1.43μs     │      0
    1.43μs - 1.54μs     │      0
    1.54μs - 1.65μs     │      0
    1.65μs - 1.76μs     │      0
    1.76μs - 1.87μs     │      0
    1.87μs - 1.98μs     │      2
    1.98μs - 2.09μs     │      0
    2.09μs - 2.20μs     │      1

Large Payload: GET /api/large (2MB)
--------------------------------------------------------------------------------
       6ns - 158ns      │    581
     158ns - 310ns      │      0
     310ns - 462ns      │      0
     462ns - 614ns      │      0
     614ns - 766ns      │      0
     766ns - 918ns      │      0
     918ns - 1.07μs     │      0
    1.07μs - 1.22μs     │      0
    1.22μs - 1.37μs     │      0
    1.37μs - 1.53μs     │      0
    1.53μs - 1.68μs     │      0
    1.68μs - 1.83μs     │      0
    1.83μs - 1.98μs     │      0
    1.98μs - 2.13μs     │      0
    2.13μs - 2.29μs     │      0
    2.29μs - 2.44μs     │      0
    2.44μs - 2.59μs     │      0
    2.59μs - 2.74μs     │      0
    2.74μs - 2.89μs     │      1
    2.89μs - 3.05μs     │      1

Large Payload: POST /api/large-post (2MB)
--------------------------------------------------------------------------------
      19ns - 115ns      │    282
     115ns - 211ns      │      0
     211ns - 308ns      │      0
     308ns - 404ns      │      0
     404ns - 500ns      │      0
     500ns - 596ns      │      0
     596ns - 692ns      │      0
     692ns - 788ns      │      0
     788ns - 884ns      │      0
     884ns - 980ns      │      0
     980ns - 1.08μs     │      0
    1.08μs - 1.17μs     │      0
    1.17μs - 1.27μs     │      0
    1.27μs - 1.36μs     │      0
    1.36μs - 1.46μs     │      0
    1.46μs - 1.56μs     │      0
    1.56μs - 1.65μs     │      0
    1.65μs - 1.75μs     │      0
    1.75μs - 1.85μs     │      0
    1.85μs - 1.94μs     │      3

Transform endpoints
--------------------------------------------------------------------------------
       0ns - 4ns        │  45987
       4ns - 8ns        │      2
       8ns - 11ns       │      0
      11ns - 15ns       │      0
      15ns - 19ns       │      0
      19ns - 23ns       │      1
      23ns - 26ns       │      0
      26ns - 30ns       │      0
      30ns - 34ns       │      0
      34ns - 38ns       │      0
      38ns - 41ns       │      0
      41ns - 45ns       │      0
      45ns - 49ns       │      9
      49ns - 53ns       │     44
      53ns - 56ns       │     10
      56ns - 60ns       │     14
      60ns - 64ns       │     10
      64ns - 68ns       │      1
      68ns - 71ns       │      1
      71ns - 75ns       │      1
  ✔ SDK Active (2m 14.3s)
Test server stopped
Test server stopped
```

### Results 

| Workload Type              | Latency Impact   | Throughput Impact   |
|----------------------------|------------------|---------------------|
| High Throughput (simple)   | +145%            | -20%                |
| High CPU (compute-hash)    | +44%             | -15%                |
| High IO, Low CPU           | -2%              | +3%                 |
| Large Payload (100KB POST) | +455%            | -65%                |
| Large Payload (1MB POST)   | +490%            | -62%                |
| Large Payload (2MB POST)   | +375%            | -59%                |

- Seems like all performance impacts comes from CPU contention when CPU reaches
  100%.
  - High IO, Low CPU endpoint:
    - Without SDK: 114% avg total CPU (104% user + 10% system)
    - With SDK: 104% avg total CPU (75% user + 27% system)
  - High Throughput GET /api/simple:
    - Without SDK: 123% avg total CPU (111% user + 12% system)
    - With SDK: 106% avg total CPU (82% user + 24% system)
  - CPU remains stable, but system CPU time increases. This makes sense because
    of the filesystem export.
- Are we blocking the event loop with exports? The bimodal latency distribution
  + large variance, good to double check.
- Performance degrades exponentially with payload size (100KB = +455%, 1MB =
  +490%, 2MB = +375%). This points to base64 encoding + JSON serialization +
  file writes as the bottleneck.
- Transforms overhead is surprisingly low, but expected to grow linearly with
  config size.
