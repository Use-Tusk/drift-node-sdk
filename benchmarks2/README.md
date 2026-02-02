# SDK Benchmarks (Node)

Simple Go-style benchmarks for measuring SDK overhead.

## Quick Start

```bash
./run_benchmark.sh [duration_seconds]
```

This automatically:
1. Starts the delay server
2. Runs baseline benchmark (SDK disabled)
3. Runs benchmark with SDK enabled
4. Prints comparison with percentage diff

## Requirements

- Python 3 with Flask and requests (`pip install flask requests`)
- Node dependencies installed (`npm install` in drift-node-sdk root)
