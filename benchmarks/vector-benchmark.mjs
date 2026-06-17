/**
 * Vector benchmark — Node mirror of Python's benchmarks/rag_benchmark.py /
 * competitive_benchmark.py, minus the paid embedding API. Uses deterministic
 * pseudo-random vectors so it runs offline with no keys.
 *
 * Measures: native HNSW batch-insert throughput, query latency (p50/p95/p99),
 * and recall@k against a brute-force ground truth.
 *
 *   node benchmarks/vector-benchmark.mjs [--n 10000] [--dim 384] [--queries 100] [--k 10]
 */
import { EmbeddedDatabase } from '../dist/esm/index.js';
import { percentile, fmtInt } from './lib/stats.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}

// Mulberry32 — small deterministic PRNG so runs are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randVec(rand, dim) {
  const v = new Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = rand() * 2 - 1;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are unit-normalised
}

function bruteTopK(vectors, query, k) {
  const scored = vectors.map((v, i) => [i, cosine(v, query)]);
  scored.sort((x, y) => y[1] - x[1]);
  return scored.slice(0, k).map(([i]) => i);
}

export async function runVectorBenchmark({ n = 10_000, dim = 384, queries = 100, k = 10 } = {}) {
  const dbPath = path.join(os.tmpdir(), `soch-bench-vec-${process.pid}`);
  fs.rmSync(dbPath, { recursive: true, force: true });
  const rand = rng(42);

  const vectors = new Array(n);
  for (let i = 0; i < n; i++) vectors[i] = randVec(rand, dim);
  const ids = vectors.map((_, i) => `v${i}`);
  const metas = vectors.map((_, i) => ({ idx: i }));

  const db = await EmbeddedDatabase.open(dbPath);
  const ns = await db.createNamespace('bench');
  const col = await ns.createCollection('vectors', { dimension: dim });

  // --- Insert (native HNSW batch path) ---
  let t = performance.now();
  await col.insertMany(vectors, metas, ids);
  const insertSec = (performance.now() - t) / 1000;

  // --- Query latency + recall ---
  const queryVecs = new Array(queries);
  for (let q = 0; q < queries; q++) queryVecs[q] = randVec(rand, dim);

  const latUs = [];
  let hits = 0;
  let totalTruth = 0;
  for (let q = 0; q < queries; q++) {
    const truth = new Set(bruteTopK(vectors, queryVecs[q], k));
    const s = performance.now();
    const res = await col.search(queryVecs[q], k);
    latUs.push((performance.now() - s) * 1000);
    for (const r of res) {
      const idx = typeof r.metadata?.idx === 'number' ? r.metadata.idx : Number(String(r.id).replace(/^v/, ''));
      if (truth.has(idx)) hits++;
    }
    totalTruth += truth.size;
  }
  await db.close();
  fs.rmSync(dbPath, { recursive: true, force: true });

  const recall = totalTruth ? hits / totalTruth : 0;
  const result = {
    benchmark: 'vector',
    n,
    dim,
    queries,
    k,
    insert_seconds: insertSec,
    insert_vec_sec: n / insertSec,
    query_latency_us: {
      p50: percentile(latUs, 50),
      p95: percentile(latUs, 95),
      p99: percentile(latUs, 99),
    },
    recall_at_k: recall,
  };

  console.log(`\n=== Vector benchmark (n=${fmtInt(n)}, dim=${dim}, q=${queries}, k=${k}) ===`);
  console.log(`Insert: ${fmtInt(result.insert_vec_sec)} vec/s (${insertSec.toFixed(2)}s)`);
  console.log(
    `Query latency (us): p50=${result.query_latency_us.p50.toFixed(1)} ` +
      `p95=${result.query_latency_us.p95.toFixed(1)} p99=${result.query_latency_us.p99.toFixed(1)}`
  );
  console.log(`Recall@${k}: ${(recall * 100).toFixed(2)}%`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVectorBenchmark({
    n: arg('--n', 10_000),
    dim: arg('--dim', 384),
    queries: arg('--queries', 100),
    k: arg('--k', 10),
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
