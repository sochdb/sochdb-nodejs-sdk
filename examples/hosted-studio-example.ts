/**
 * Minimal hosted SochDB + Studio example.
 *
 * This example:
 * 1. writes a few demo documents to a remote SochDB collection
 * 2. sends a matching event to the hosted Studio backend
 *
 * Environment variables:
 *   SOCHDB_GRPC_ADDRESS   default: studio.agentslab.host:50053
 *   STUDIO_BASE_URL       default: http://studio.agentslab.host:3000
 *   STUDIO_API_KEY        required for Studio event ingestion
 */

import { SochDBClient, StudioClient } from '../src/index';

const grpcAddress = process.env.SOCHDB_GRPC_ADDRESS || 'studio.agentslab.host:50053';
const studioBaseUrl = process.env.STUDIO_BASE_URL || 'http://studio.agentslab.host:3000';
const studioApiKey = process.env.STUDIO_API_KEY;
const collectionName = 'sdk_demo_docs';

async function main() {
  const runId = `node-sdk-demo-${Date.now()}`;
  const client = new SochDBClient({ address: grpcAddress });

  console.log(`Connecting to remote SochDB at ${grpcAddress}`);
  await client.createCollection(collectionName, {
    dimension: 4,
    namespace: 'default',
    metric: 'cosine',
  });

  const insertedIds = await client.addDocuments(
    collectionName,
    [
      {
        id: `${runId}-doc-1`,
        content: 'Node SDK can write to the hosted SochDB collection.',
        embedding: [1, 0, 0, 0],
        metadata: { source: 'nodejs-sdk', run_id: runId, topic: 'studio' },
      },
      {
        id: `${runId}-doc-2`,
        content: 'Studio event ingestion gives the hosted UI shared visibility.',
        embedding: [0, 1, 0, 0],
        metadata: { source: 'nodejs-sdk', run_id: runId, topic: 'events' },
      },
      {
        id: `${runId}-doc-3`,
        content: 'SDK parity should make remote writes and telemetry feel consistent.',
        embedding: [0, 0, 1, 0],
        metadata: { source: 'nodejs-sdk', run_id: runId, topic: 'sdk' },
      },
    ],
    'default',
  );

  console.log(`Inserted ${insertedIds.length} documents into ${collectionName}`);

  if (!studioApiKey) {
    console.log('STUDIO_API_KEY not set; skipping Studio event ingestion.');
    client.close();
    return;
  }

  const studio = new StudioClient({ baseUrl: studioBaseUrl, apiKey: studioApiKey });
  const ingestResult = await studio.ingestEvents(
    [
      {
        type: 'retrieval',
        name: 'nodejs-sdk-demo',
        status: 'ok',
        run_id: runId,
        metadata: {
          collection: collectionName,
          insertedIds,
          grpcAddress,
        },
      },
    ],
    { source: 'nodejs-sdk-example' },
  );

  console.log(`Ingested ${ingestResult.ingested} Studio event(s)`);
  client.close();
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
