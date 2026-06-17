/**
 * Benchmark statistics helpers.
 *
 * Mirrors the Python SDK's benchmarks/queue_benchmark.py (BenchmarkResult +
 * percentile) so Node and Python report the same shape of numbers.
 */

/** Nearest-rank percentile over an unsorted array of numbers. */
export function percentile(data, p) {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Time `fn` over `iterations` calls and return a result object with latency
 * percentiles (microseconds) and throughput (ops/sec).
 *
 * @param {string} name
 * @param {number} iterations
 * @param {() => any | Promise<any>} fn
 */
export async function bench(name, iterations, fn) {
  // Warmup (not measured) — JIT + native lib warm.
  const warmup = Math.min(50, Math.max(1, Math.floor(iterations / 20)));
  for (let i = 0; i < warmup; i++) await fn();

  const latenciesUs = [];
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    const s = performance.now();
    await fn();
    latenciesUs.push((performance.now() - s) * 1000); // ms -> us
  }
  const totalSec = (performance.now() - t0) / 1000;

  return {
    name,
    iterations,
    min_latency_us: Math.min(...latenciesUs),
    max_latency_us: Math.max(...latenciesUs),
    mean_latency_us: mean(latenciesUs),
    median_latency_us: percentile(latenciesUs, 50),
    p95_latency_us: percentile(latenciesUs, 95),
    p99_latency_us: percentile(latenciesUs, 99),
    throughput_ops: iterations / totalSec,
  };
}

/** Round a benchmark result for JSON output. */
export function toJson(r) {
  const round = (x) => Math.round(x * 100) / 100;
  return {
    ...r,
    min_latency_us: round(r.min_latency_us),
    max_latency_us: round(r.max_latency_us),
    mean_latency_us: round(r.mean_latency_us),
    median_latency_us: round(r.median_latency_us),
    p95_latency_us: round(r.p95_latency_us),
    p99_latency_us: round(r.p99_latency_us),
    throughput_ops: round(r.throughput_ops),
  };
}

/** Human-readable one-liner, matching the Python __str__ layout. */
export function formatResult(r) {
  const f = (x) => x.toFixed(1);
  return (
    `${r.name} (${r.iterations.toLocaleString()} iters)\n` +
    `  Latency (us): min=${f(r.min_latency_us)}, mean=${f(r.mean_latency_us)}, ` +
    `median=${f(r.median_latency_us)}, p95=${f(r.p95_latency_us)}, p99=${f(r.p99_latency_us)}\n` +
    `  Throughput:   ${r.throughput_ops.toLocaleString(undefined, { maximumFractionDigits: 1 })} ops/s`
  );
}

export const fmtInt = (n) => Math.round(n).toLocaleString();
