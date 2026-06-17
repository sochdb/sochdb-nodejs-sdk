/**
 * KV / FFI benchmark — Node mirror of Python's examples/benchmark_ffi.py.
 *
 * Measures embedded (FFI) insert + full-scan throughput and compares against
 * Node's built-in node:sqlite (WAL) on the same workload.
 *
 *   node benchmarks/kv-benchmark.mjs [--n 100000]
 */
import { EmbeddedDatabase } from '../dist/esm/index.js';
import { fmtInt } from './lib/stats.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}

export async function runKvBenchmark({ n = 100_000 } = {}) {
  const dbPath = path.join(os.tmpdir(), `soch-bench-kv-${process.pid}`);
  fs.rmSync(dbPath, { recursive: true, force: true });

  // Pre-generate data so we measure the DB, not string building.
  const keys = new Array(n);
  const values = new Array(n);
  for (let i = 0; i < n; i++) {
    keys[i] = Buffer.from(`users/${i}`);
    values[i] = Buffer.from(
      `{"id":${i},"name":"User ${i}","email":"user${i}@example.com","score":${i % 100}}`
    );
  }

  // --- SochDB FFI ---
  const db = await EmbeddedDatabase.open(dbPath);

  let t = performance.now();
  const txn = db.transaction();
  for (let i = 0; i < n; i++) await txn.put(keys[i], values[i]);
  await txn.commit();
  const sochInsert = (performance.now() - t) / 1000;

  t = performance.now();
  let count = 0;
  for await (const _ of db.scanPrefix(Buffer.from('users/'))) count++;
  const sochScan = (performance.now() - t) / 1000;
  await db.close();
  fs.rmSync(dbPath, { recursive: true, force: true });

  // --- node:sqlite (WAL) comparison, best-effort ---
  let sqlite = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const sqlitePath = path.join(os.tmpdir(), `soch-bench-sqlite-${process.pid}.db`);
    fs.rmSync(sqlitePath, { force: true });
    const sdb = new DatabaseSync(sqlitePath);
    sdb.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    sdb.exec('CREATE TABLE users (key TEXT PRIMARY KEY, value TEXT)');
    const ins = sdb.prepare('INSERT INTO users (key, value) VALUES (?, ?)');

    t = performance.now();
    sdb.exec('BEGIN');
    for (let i = 0; i < n; i++) ins.run(`users/${i}`, values[i].toString());
    sdb.exec('COMMIT');
    const sqInsert = (performance.now() - t) / 1000;

    t = performance.now();
    let c = 0;
    for (const _ of sdb.prepare('SELECT key, value FROM users').iterate()) c++;
    const sqScan = (performance.now() - t) / 1000;
    sdb.close();
    fs.rmSync(sqlitePath, { force: true });
    fs.rmSync(sqlitePath + '-wal', { force: true });
    fs.rmSync(sqlitePath + '-shm', { force: true });
    sqlite = {
      insert_ops_sec: n / sqInsert,
      scan_ops_sec: c / sqScan,
      insert_seconds: sqInsert,
      scan_seconds: sqScan,
    };
  } catch (e) {
    sqlite = { skipped: String(e.message || e) };
  }

  const result = {
    benchmark: 'kv',
    n,
    sochdb: {
      insert_ops_sec: n / sochInsert,
      scan_ops_sec: count / sochScan,
      insert_seconds: sochInsert,
      scan_seconds: sochScan,
      rows_scanned: count,
    },
    sqlite,
  };

  console.log(`\n=== KV / FFI benchmark (n=${fmtInt(n)}) ===`);
  console.log(
    `SochDB  insert: ${fmtInt(result.sochdb.insert_ops_sec)} ops/s  ` +
      `scan: ${fmtInt(result.sochdb.scan_ops_sec)} ops/s (${fmtInt(count)} rows)`
  );
  if (sqlite && !sqlite.skipped) {
    console.log(
      `sqlite  insert: ${fmtInt(sqlite.insert_ops_sec)} ops/s  ` +
        `scan: ${fmtInt(sqlite.scan_ops_sec)} ops/s`
    );
  } else if (sqlite?.skipped) {
    console.log(`sqlite  comparison skipped: ${sqlite.skipped}`);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runKvBenchmark({ n: arg('--n', 100_000) }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
