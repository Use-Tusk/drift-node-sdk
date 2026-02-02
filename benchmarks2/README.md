# SDK Benchmarks (Node)

Simple Go-style benchmarks for measuring SDK overhead.

## Quick Start

```bash
./run_benchmark.sh [duration_seconds]
```

This automatically:
1. Starts the delay server (from Python benchmarks)
2. Runs baseline benchmark (SDK disabled)
3. Runs benchmark with SDK enabled
4. Prints comparison

## Requirements

- Python benchmarks must be available at `../../drift-python-sdk/benchmarks2/`
- Node dependencies installed (`npm install` in drift-node-sdk root)
