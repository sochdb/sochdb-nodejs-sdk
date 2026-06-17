/**
 * Run the full Node SDK benchmark suite and write a JSON report.
 *
 *   node benchmarks/run-all.mjs            # default sizes
 *   node benchmarks/run-all.mjs --quick    # small sizes (fast CI sanity)
 *   node benchmarks/run-all.mjs --full     # large sizes
 *
 * Mirrors sochdb-python-sdk/benchmarks/run_benchmarks_with_graphs.py (minus the
 * matplotlib graphs and paid embedding API).
 */
import { runKvBenchmark } from './kv-benchmark.mjs';
import { runVectorBenchmark } from './vector-benchmark.mjs';
import { runQueueBenchmark } from './queue-benchmark.mjs';
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv.includes('--full')
  ? 'full'
  : process.argv.includes('--quick')
    ? 'quick'
    : 'default';

// Queue iters are kept modest: each enqueue/dequeue performs several durable
// auto-committed ops (~tens of ms each), so it dominates wall-clock.
const PROFILES = {
  quick: { kv: 5_000, vec: { n: 2_000, dim: 128, queries: 50 }, queue: 200 },
  default: { kv: 100_000, vec: { n: 10_000, dim: 384, queries: 100 }, queue: 500 },
  full: { kv: 500_000, vec: { n: 50_000, dim: 768, queries: 200 }, queue: 1_500 },
};

async function main() {
  const cfg = PROFILES[mode];
  console.log(`SochDB Node SDK — benchmark suite (profile: ${mode})`);

  const kv = await runKvBenchmark({ n: cfg.kv });
  const vector = await runVectorBenchmark(cfg.vec);
  const queue = await runQueueBenchmark({ iterations: cfg.queue });

  const report = {
    profile: mode,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    results: { kv, vector, queue },
  };

  const outDir = path.join(import.meta.dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `benchmark-${mode}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
