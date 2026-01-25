/**
 * Semantic Cache Example
 * 
 * Demonstrates LLM response caching with semantic similarity matching.
 */

import { EmbeddedDatabase, SemanticCache } from '../src';
import * as path from 'path';

// Simple embedding function (mock - use real embeddings in production)
function mockEmbed(text: string): number[] {
  // In production, use actual embedding models like OpenAI, Cohere, etc.
  const embedding = new Array(384).fill(0);
  for (let i = 0; i < text.length && i < 384; i++) {
    embedding[i] = text.charCodeAt(i) / 255;
  }
  return embedding;
}

// Mock LLM call (replace with actual LLM API)
async function callLLM(query: string): Promise<string> {
  // In production, call OpenAI, Anthropic, etc.
  return `Response to: "${query}"`;
}

async function main() {
  const dbPath = path.join(__dirname, '../test-data/cache-example-db');
  
  // Open database
  const db = await EmbeddedDatabase.open(dbPath);
  console.log('✓ Database opened');

  // Create semantic cache
  const cache = new SemanticCache(db, 'llm_responses');
  console.log('✓ Semantic cache initialized\n');

  // Example 1: Cache miss and store
  console.log('=== Example 1: Cache Miss and Store ===');
  const query1 = 'What is machine learning?';
  const embedding1 = mockEmbed(query1);

  let cached = await cache.get(embedding1, 0.85);
  if (!cached) {
    console.log('Cache MISS - calling LLM...');
    const response = await callLLM(query1);
    
    // Store in cache with 1 hour TTL
    await cache.put(query1, response, embedding1, 3600, {
      model: 'gpt-4',
      tokens: 150,
    });
    console.log(`Response: ${response}`);
    console.log('Cached for future use\n');
  }

  // Example 2: Cache hit (exact match)
  console.log('=== Example 2: Cache Hit (Exact Match) ===');
  cached = await cache.get(embedding1, 0.99);
  if (cached) {
    console.log('Cache HIT!');
    console.log(`Original query: ${cached.key}`);
    console.log(`Response: ${cached.value}`);
    console.log(`Similarity: ${cached.score.toFixed(4)}`);
    console.log(`Metadata:`, cached.metadata, '\n');
  }

  // Example 3: Similar query (semantic match)
  console.log('=== Example 3: Similar Query (Semantic Match) ===');
  const query2 = 'Explain machine learning';  // Similar to query1
  const embedding2 = mockEmbed(query2);

  cached = await cache.get(embedding2, 0.75);  // Lower threshold for fuzzy match
  if (cached) {
    console.log('Cache HIT (similar query)!');
    console.log(`Original query: ${cached.key}`);
    console.log(`New query: ${query2}`);
    console.log(`Response: ${cached.value}`);
    console.log(`Similarity: ${cached.score.toFixed(4)}\n`);
  }

  // Example 4: Multiple entries
  console.log('=== Example 4: Multiple Cached Entries ===');
  const queries = [
    'What is deep learning?',
    'Explain neural networks',
    'What are transformers in AI?',
  ];

  for (const q of queries) {
    const emb = mockEmbed(q);
    const resp = await callLLM(q);
    await cache.put(q, resp, emb, 3600);
    console.log(`✓ Cached: "${q}"`);
  }

  // Example 5: Cache statistics
  console.log('\n=== Example 5: Cache Statistics ===');
  const stats = await cache.stats();
  console.log(`Total entries: ${stats.count}`);
  console.log(`Cache hits: ${stats.hits}`);
  console.log(`Cache misses: ${stats.misses}`);
  console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`Memory usage: ${(stats.memoryUsage / 1024).toFixed(2)} KB\n`);

  // Example 6: Delete specific entry
  console.log('=== Example 6: Delete Entry ===');
  await cache.delete(query1);
  console.log(`✓ Deleted: "${query1}"`);

  const statsBefore = await cache.stats();
  console.log(`Entries before purge: ${statsBefore.count}`);

  // Example 7: Purge expired entries
  console.log('\n=== Example 7: Purge Expired Entries ===');
  const purged = await cache.purgeExpired();
  console.log(`✓ Purged ${purged} expired entries`);

  // Example 8: Clear cache
  console.log('\n=== Example 8: Clear Cache ===');
  const deleted = await cache.clear();
  console.log(`✓ Cleared ${deleted} entries`);

  const statsAfter = await cache.stats();
  console.log(`Entries remaining: ${statsAfter.count}\n`);

  // Clean up
  await db.close();
  console.log('✓ Database closed');
}

main().catch(console.error);
