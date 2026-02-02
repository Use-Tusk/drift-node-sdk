#!/usr/bin/env python3
"""
Benchmark runner for SDK performance testing.
Works with any HTTP server implementing /api/sort and /api/downstream.

Usage:
    python benchmark.py --url=http://localhost:8080 [--duration=5] [--baseline=baseline.txt]
"""
import argparse
import random
import time
import requests

def benchmark(name, func, duration_sec):
    """Run func repeatedly for duration_sec, return stats."""
    start = time.perf_counter_ns()
    deadline = start + (duration_sec * 1_000_000_000)
    iterations = 0

    while time.perf_counter_ns() < deadline:
        func()
        iterations += 1

    elapsed_ns = time.perf_counter_ns() - start
    ns_per_op = elapsed_ns // iterations if iterations > 0 else 0
    ops_per_sec = iterations / (elapsed_ns / 1_000_000_000) if elapsed_ns > 0 else 0

    return iterations, ns_per_op, ops_per_sec

def print_result(name, iterations, ns_per_op, ops_per_sec):
    print(f"{name:<25} {iterations:>8} {ns_per_op:>15} ns/op {ops_per_sec:>12.2f} ops/s")

def parse_results(filepath):
    """Parse benchmark output file into dict of {name: ops_per_sec}."""
    results = {}
    with open(filepath) as f:
        for line in f:
            if line.startswith('Benchmark_'):
                parts = line.split()
                name = parts[0]
                # Format: Name  iters  ns_per_op ns/op  ops_per_sec ops/s
                ops_s = float(parts[4])
                results[name] = ops_s
    return results

def print_comparison(baseline, current):
    """Print comparison table with percentage diff."""
    print("\n" + "=" * 70)
    print("COMPARISON (negative = slower with SDK)")
    print("=" * 70)
    print(f"{'Benchmark':<25} {'Baseline':>12} {'Current':>12} {'Diff':>12}")
    print("-" * 70)
    for name in baseline:
        if name in current:
            base_ops = baseline[name]
            curr_ops = current[name]
            if base_ops > 0:
                diff_pct = ((curr_ops - base_ops) / base_ops) * 100
                print(f"{name:<25} {base_ops:>10.2f}/s {curr_ops:>10.2f}/s {diff_pct:>+10.1f}%")

def main():
    parser = argparse.ArgumentParser(description='Benchmark SDK overhead')
    parser.add_argument('--url', required=True, help='Base URL of test server')
    parser.add_argument('--duration', type=int, default=5, help='Seconds per benchmark')
    parser.add_argument('--baseline', help='Baseline results file to compare against')
    args = parser.parse_args()

    base_url = args.url.rstrip('/')
    session = requests.Session()

    # Wait for server ready
    print(f"Connecting to {base_url}...")
    for _ in range(50):
        try:
            session.get(f'{base_url}/health', timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)
    else:
        print("ERROR: Server not responding")
        return 1

    print(f"Running benchmarks (duration={args.duration}s per test)...\n")

    results = {}

    # Benchmark: Sort
    test_data = list(range(1000))
    random.shuffle(test_data)

    def sort_request():
        resp = session.post(f'{base_url}/api/sort', json={'data': test_data})
        resp.raise_for_status()

    iters, ns_op, ops_s = benchmark('Benchmark_Sort', sort_request, args.duration)
    print_result('Benchmark_Sort', iters, ns_op, ops_s)
    results['Benchmark_Sort'] = ops_s

    # Benchmark: Downstream
    def downstream_request():
        resp = session.post(f'{base_url}/api/downstream', json={'delay_ms': 10})
        resp.raise_for_status()

    iters, ns_op, ops_s = benchmark('Benchmark_Downstream', downstream_request, args.duration)
    print_result('Benchmark_Downstream', iters, ns_op, ops_s)
    results['Benchmark_Downstream'] = ops_s

    # Compare against baseline if provided
    if args.baseline:
        baseline = parse_results(args.baseline)
        print_comparison(baseline, results)

if __name__ == '__main__':
    main()
