/**
 * Queue benchmark — Node mirror of Python's benchmarks/queue_benchmark.py.
 *
 * Measures enqueue / dequeue latency (p50/p95/p99) and throughput at a few
 * queue sizes.
 *
 *   node benchmarks/queue-benchmark.mjs [--iterations 2000]
 */
import { EmbeddedDatabase, createQueue } from '../dist/esm/index.js';
import { bench, formatResult, toJson } from './lib/stats.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}

export async function runQueueBenchmark({ iterations = 2000, sizes = [100, 1000] } = {}) {
  const dbPath = path.join(os.tmpdir(), `soch-bench-queue-${process.pid}`);
  fs.rmSync(dbPath, { recursive: true, force: true });
  const db = await EmbeddedDatabase.open(dbPath);

  const results = [];
  const payload = Buffer.from('x'.repeat(64));

  for (const size of sizes) {
    const q = createQueue(db, `bench_${size}`);
    // Pre-fill to `size` so enqueue/dequeue operate against a populated queue.
    for (let i = 0; i < size; i++) await q.enqueue(i % 10, payload);

    const enq = await bench(`enqueue @ size=${size}`, iterations, () =>
      q.enqueue(Math.floor(Math.random() * 10), payload)
    );
    const deq = await bench(`dequeue @ size=${size}`, iterations, () => q.dequeue('worker-1'));
    results.push(enq, deq);
  }

  await db.close();
  fs.rmSync(dbPath, { recursive: true, force: true });

  console.log(`\n=== Queue benchmark (iterations=${iterations}) ===`);
  for (const r of results) console.log(formatResult(r));
  return { benchmark: 'queue', iterations, sizes, results: results.map(toJson) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQueueBenchmark({ iterations: arg('--iterations', 2000) }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
