# SochDB Node SDK — Benchmarks

Offline benchmark suite that mirrors the Python SDK's `benchmarks/`. Everything
runs against the bundled native library (embedded/FFI mode) with **no server and
no API keys** — vectors are deterministic pseudo-random, so runs are reproducible.

## Run

```bash
npm run benchmark          # default profile (writes results/benchmark-default.json)
npm run benchmark:quick    # small sizes, fast sanity check
npm run benchmark:full     # large sizes
```

Each script is also runnable on its own with flags:

```bash
node benchmarks/kv-benchmark.mjs       --n 100000
node benchmarks/vector-benchmark.mjs   --n 10000 --dim 384 --queries 100 --k 10
node benchmarks/queue-benchmark.mjs    --iterations 1000
```

(Run `npm run build` first so `dist/esm` exists — the npm scripts do this for you.)

## What each measures

| Script | Mirrors (Python) | Metrics |
|--------|------------------|---------|
| `kv-benchmark.mjs` | `examples/benchmark_ffi.py` | FFI insert + full-scan throughput (ops/s), with a `node:sqlite` (WAL) comparison |
| `vector-benchmark.mjs` | `benchmarks/rag_benchmark.py`, `competitive_benchmark.py` | HNSW batch-insert (vec/s), query latency p50/p95/p99, recall@k vs brute-force ground truth |
| `queue-benchmark.mjs` | `benchmarks/queue_benchmark.py` | enqueue/dequeue latency p50/p95/p99 + throughput at several queue sizes |
| `run-all.mjs` | `run_benchmarks_with_graphs.py` | runs all three, writes a JSON report to `results/` |

## Notes

- **KV insert** uses a single transaction (matching the Python FFI benchmark);
  per-operation auto-committed writes are far slower (~3–4 ms/op) because each
  carries its own transaction commit.
- **Queue** throughput is bound by that same per-op commit cost — each
  enqueue/dequeue performs several durable writes — so iteration counts are kept
  modest.
- Recall is measured against an in-process brute-force top-k, so it reflects the
  index quality of the bundled engine (default HNSW `m=32`, `efC=256`).
