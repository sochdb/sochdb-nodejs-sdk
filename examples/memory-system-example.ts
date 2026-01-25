/**
 * Memory System Example
 * 
 * Demonstrates LLM-native memory with extraction, consolidation, and retrieval.
 */

import {
  EmbeddedDatabase,
  ExtractionPipeline,
  Consolidator,
  HybridRetriever,
  AllowedSet,
} from '../src';
import * as path from 'path';

// Mock LLM extractor (replace with actual LLM API in production)
async function mockExtractor(text: string) {
  // In production, call your LLM API (OpenAI, Anthropic, etc.)
  // This is a simple pattern-based extractor for demo
  
  const entities = [];
  const relations = [];
  const assertions = [];

  // Extract entities (simple pattern matching)
  const personMatches = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:is|works)/g);
  if (personMatches) {
    for (const match of personMatches) {
      const name = match.replace(/\s+(is|works)/, '');
      entities.push({
        name,
        entity_type: 'person',
        confidence: 0.9,
      });
    }
  }

  // Extract companies
  const companyMatches = text.match(/(?:at|for)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/g);
  if (companyMatches) {
    for (const match of companyMatches) {
      const name = match.replace(/^(at|for)\s+/, '');
      entities.push({
        name,
        entity_type: 'organization',
        confidence: 0.85,
      });
    }
  }

  // Extract work relations
  const workMatches = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+works\s+(?:at|for)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/g);
  if (workMatches) {
    for (const match of workMatches) {
      const parts = match.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+works\s+(?:at|for)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/);
      if (parts) {
        relations.push({
          from_entity: parts[1],
          relation_type: 'works_at',
          to_entity: parts[2],
          confidence: 0.9,
        });
      }
    }
  }

  // Extract role assertions
  const roleMatches = text.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+is\s+(?:an?\s+)?([a-z]+(?:\s[a-z]+)*)/g);
  if (roleMatches) {
    for (const match of roleMatches) {
      const parts = match.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+is\s+(?:an?\s+)?([a-z]+(?:\s[a-z]+)*)/);
      if (parts) {
        assertions.push({
          subject: parts[1],
          predicate: 'role',
          object: parts[2],
          confidence: 0.85,
        });
      }
    }
  }

  return { entities, relations, assertions };
}

// Mock embedding function (use real embeddings in production)
function mockEmbed(text: string): number[] {
  // In production, use actual embedding models
  const embedding = new Array(384).fill(0);
  for (let i = 0; i < Math.min(text.length, 384); i++) {
    embedding[i] = text.charCodeAt(i) / 255;
  }
  return embedding;
}

async function main() {
  const dbPath = path.join(__dirname, '../test-data/memory-example-db');
  
  // Open database
  const db = await EmbeddedDatabase.open(dbPath);
  console.log('✓ Database opened\n');

  // ============================================
  // Example 1: Extraction Pipeline
  // ============================================
  console.log('=== Example 1: Extraction Pipeline ===');
  
  const pipeline = ExtractionPipeline.fromDatabase(db, 'user_123', {
    entityTypes: ['person', 'organization', 'location'],
    relationTypes: ['works_at', 'knows', 'located_in'],
    minConfidence: 0.7,
  });

  const text1 = 'Alice works at Acme Corp. Bob is an engineer at Tech Inc.';
  const result1 = await pipeline.extractAndCommit(text1, mockExtractor);
  
  console.log(`Extracted ${result1.entities.length} entities:`);
  for (const entity of result1.entities) {
    console.log(`  - ${entity.name} (${entity.entityType}) [confidence: ${entity.confidence?.toFixed(2)}]`);
  }
  
  console.log(`Extracted ${result1.relations.length} relations:`);
  for (const relation of result1.relations) {
    console.log(`  - ${relation.fromEntity} --${relation.relationType}--> ${relation.toEntity}`);
  }

  console.log(`Extracted ${result1.assertions.length} assertions:`);
  for (const assertion of result1.assertions) {
    console.log(`  - ${assertion.subject} ${assertion.predicate} ${assertion.object}`);
  }
  console.log();

  // ============================================
  // Example 2: Retrieve Stored Facts
  // ============================================
  console.log('=== Example 2: Retrieve Stored Facts ===');
  
  const allEntities = await pipeline.getEntities();
  console.log(`Total entities stored: ${allEntities.length}`);
  
  const allRelations = await pipeline.getRelations();
  console.log(`Total relations stored: ${allRelations.length}`);
  console.log();

  // ============================================
  // Example 3: Consolidation
  // ============================================
  console.log('=== Example 3: Consolidation ===');
  
  const consolidator = Consolidator.fromDatabase(db, 'user_123', {
    similarityThreshold: 0.85,
    useTemporalUpdates: true,
  });

  // Add some assertions
  await consolidator.add({
    fact: { subject: 'Alice', predicate: 'lives_in', object: 'San Francisco' },
    source: 'conversation_1',
    confidence: 0.9,
  });

  await consolidator.add({
    fact: { subject: 'Alice', predicate: 'lives_in', object: 'San Francisco' },
    source: 'conversation_2',
    confidence: 0.95,
  });

  // Add contradicting assertion
  await consolidator.addWithContradiction(
    {
      fact: { subject: 'Alice', predicate: 'lives_in', object: 'New York' },
      source: 'conversation_3',
      confidence: 0.92,
    },
    [] // IDs of contradicted assertions (empty for demo)
  );

  // Run consolidation
  const updated = await consolidator.consolidate();
  console.log(`✓ Consolidated ${updated} facts`);

  // Get canonical facts
  const canonicalFacts = await consolidator.getCanonicalFacts();
  console.log(`Canonical facts: ${canonicalFacts.length}`);
  for (const fact of canonicalFacts) {
    console.log(`  - Fact: ${JSON.stringify(fact.mergedFact)}`);
    console.log(`    Confidence: ${fact.confidence.toFixed(3)}, Sources: ${fact.sources.length}`);
  }
  console.log();

  // ============================================
  // Example 4: Hybrid Retrieval
  // ============================================
  console.log('=== Example 4: Hybrid Retrieval ===');
  
  const retriever = HybridRetriever.fromDatabase(db, 'user_123', 'documents', {
    k: 5,
    alpha: 0.5, // Balanced vector + keyword
  });

  // Index some documents
  const documents = [
    {
      id: 'doc1',
      content: 'Machine learning is a subset of artificial intelligence focused on data-driven algorithms.',
      embedding: mockEmbed('machine learning AI algorithms'),
      metadata: { category: 'AI', author: 'Alice' },
    },
    {
      id: 'doc2',
      content: 'Deep learning uses neural networks with multiple layers to learn hierarchical representations.',
      embedding: mockEmbed('deep learning neural networks'),
      metadata: { category: 'AI', author: 'Bob' },
    },
    {
      id: 'doc3',
      content: 'Natural language processing enables computers to understand and generate human language.',
      embedding: mockEmbed('NLP language processing'),
      metadata: { category: 'NLP', author: 'Alice' },
    },
    {
      id: 'doc4',
      content: 'Computer vision allows machines to interpret and understand visual information from images.',
      embedding: mockEmbed('computer vision images'),
      metadata: { category: 'Vision', author: 'Carol' },
    },
  ];

  await retriever.indexDocuments(documents);
  console.log(`✓ Indexed ${documents.length} documents`);

  // Search with namespace isolation
  const query = 'neural networks and AI';
  const queryEmbedding = mockEmbed(query);
  const allowed = AllowedSet.fromNamespace('user_123');

  const searchResults = await retriever.retrieve(query, queryEmbedding, allowed, 3);
  console.log(`\nQuery: "${query}"`);
  console.log(`Found ${searchResults.results.length} results (${searchResults.queryTime}ms):`);
  
  for (const result of searchResults.results) {
    console.log(`\n  ${result.id} (score: ${result.score.toFixed(4)})`);
    console.log(`  Content: ${result.content.substring(0, 80)}...`);
    console.log(`  Vector rank: ${result.vectorRank}, Keyword rank: ${result.keywordRank}`);
  }
  console.log();

  // ============================================
  // Example 5: Pre-Filtering with AllowedSet
  // ============================================
  console.log('=== Example 5: Pre-Filtering with AllowedSet ===');
  
  // Only Alice's documents
  const aliceAllowed = AllowedSet.fromFilter(
    (id, metadata) => metadata?.author === 'Alice'
  );

  const aliceResults = await retriever.retrieve(query, queryEmbedding, aliceAllowed, 5);
  console.log(`Alice-only results: ${aliceResults.results.length}`);
  for (const result of aliceResults.results) {
    console.log(`  - ${result.id} by ${result.metadata?.author}`);
  }
  console.log();

  // ============================================
  // Example 6: Multiple Extractions
  // ============================================
  console.log('=== Example 6: Multiple Extractions ===');
  
  const texts = [
    'Carol is a data scientist at Research Labs',
    'Dave works at Startup Inc as a software developer',
    'Eve is the CEO of Innovation Corp',
  ];

  for (const text of texts) {
    const result = await pipeline.extractAndCommit(text, mockExtractor);
    console.log(`✓ Processed: "${text}"`);
    console.log(`  Entities: ${result.entities.length}, Relations: ${result.relations.length}`);
  }

  const finalCount = await pipeline.getEntities();
  console.log(`\nTotal entities in database: ${finalCount.length}`);
  console.log();

  // Clean up
  await db.close();
  console.log('✓ Database closed');
}

main().catch(console.error);
