import { SochDBClient } from '../dist/esm/index.js';

const grpcAddress = process.env.SOCHDB_GRPC_ADDRESS || 'studio.agentslab.host:50053';
const namespace = process.env.SOCHDB_NAMESPACE || 'default';
const runId = `node-live-${Date.now()}`;
const collection = `sdk_live_node_${runId}`;

const client = new SochDBClient({ address: grpcAddress });

try {
  await client.createCollection(collection, {
    dimension: 4,
    namespace,
    metric: 'cosine',
  });

  const inserted = await client.addDocuments(
    collection,
    [
      {
        id: `${runId}-doc-1`,
        content: 'node live parity doc',
        embedding: [1, 0, 0, 0],
        metadata: { sdk: 'node', run_id: runId },
      },
      {
        id: `${runId}-doc-2`,
        content: 'node live parity second doc',
        embedding: [0, 1, 0, 0],
        metadata: { sdk: 'node', run_id: runId },
      },
    ],
    namespace,
  );

  const results = await client.searchCollection(collection, [1, 0, 0, 0], 2, namespace);
  console.log(
    JSON.stringify({
      sdk: 'node',
      collection,
      insertedCount: inserted.length,
      resultCount: results.length,
      topId: results[0]?.id ?? null,
    }),
  );
} finally {
  client.close();
}
