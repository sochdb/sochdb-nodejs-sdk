/**
 * Tests for Semantic Cache and Context Builder
 */

import { EmbeddedDatabase as Database } from '../src/embedded/database';
import { SemanticCache } from '../src/semantic-cache';
import { ContextQueryBuilder, ContextOutputFormat, TruncationStrategy } from '../src/context-builder';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(__dirname, '../test-data/features-test-db');

// Clean up test database
function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }
}

describe('Semantic Cache (v0.4.1)', () => {
  let db: Database;
  let cache: SemanticCache;

  beforeEach(async () => {
    cleanup();
    db = await Database.open(TEST_DB_PATH);
    cache = new SemanticCache(db, 'llm_responses');
  });

  afterEach(async () => {
    await db.close();
    cleanup();
  });

  test('should store and retrieve cached response', async () => {
    const query = 'What is Python?';
    const response = 'Python is a high-level programming language...';
    const embedding = generateRandomVector(384);

    await cache.put(query, response, embedding, 3600);

    // Query with same embedding
    const hit = await cache.get(embedding, 0.99);

    expect(hit).not.toBeNull();
    expect(hit?.key).toBe(query);
    expect(hit?.value).toBe(response);
    expect(hit?.score).toBeGreaterThan(0.99);
  });

  test('should find similar queries', async () => {
    const query = 'What is Python?';
    const response = 'Python is a high-level programming language...';
    const embedding = generateRandomVector(384);

    await cache.put(query, response, embedding, 3600);

    // Query with similar embedding (add small noise)
    const similarEmbedding = embedding.map(v => v + (Math.random() - 0.5) * 0.01);
    const hit = await cache.get(similarEmbedding, 0.85);

    expect(hit).not.toBeNull();
    expect(hit?.score).toBeGreaterThan(0.85);
  });

  test('should miss on dissimilar queries', async () => {
    const query = 'What is Python?';
    const response = 'Python is a high-level programming language...';
    const embedding = generateRandomVector(384);

    await cache.put(query, response, embedding, 3600);

    // Query with completely different embedding
    const differentEmbedding = generateRandomVector(384);
    const hit = await cache.get(differentEmbedding, 0.85);

    expect(hit).toBeNull();
  });

  test('should delete cached entry', async () => {
    const query = 'What is Python?';
    const response = 'Python is...';
    const embedding = generateRandomVector(384);

    await cache.put(query, response, embedding);
    await cache.delete(query);

    const hit = await cache.get(embedding, 0.99);
    expect(hit).toBeNull();
  });

  test('should track hit/miss statistics', async () => {
    const query1 = 'Query 1';
    const embedding1 = generateRandomVector(384);
    await cache.put(query1, 'Response 1', embedding1);

    // Hit
    await cache.get(embedding1, 0.99);

    // Miss
    const randomEmbedding = generateRandomVector(384);
    await cache.get(randomEmbedding, 0.99);

    const stats = await cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  test('should clear entire cache', async () => {
    await cache.put('Q1', 'R1', generateRandomVector(384));
    await cache.put('Q2', 'R2', generateRandomVector(384));
    await cache.put('Q3', 'R3', generateRandomVector(384));

    const deleted = await cache.clear();
    expect(deleted).toBeGreaterThan(0);

    const stats = await cache.stats();
    expect(stats.count).toBe(0);
  });
});

describe('Context Query Builder (v0.4.1)', () => {
  test('should build basic context with literal sections', () => {
    const builder = new ContextQueryBuilder();
    
    const result = builder
      .forSession('session_123')
      .withBudget(1000)
      .setFormat(ContextOutputFormat.TOON)
      .literal('SYSTEM', 0, 'You are a helpful assistant.')
      .literal('USER', 1, 'Hello, how are you?')
      .execute();

    expect(result.text).toContain('[SYSTEM]');
    expect(result.text).toContain('You are a helpful assistant');
    expect(result.text).toContain('[USER]');
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  test('should build context with sections', () => {
    const builder = new ContextQueryBuilder();
    
    const result = builder
      .withBudget(2000)
      .section('PROFILE', 1)
        .get('user.profile.{name, email}')
        .done()
      .section('HISTORY', 2)
        .last(5, 'messages')
        .whereEq('session_id', 'session_123')
        .done()
      .execute();

    expect(result.text).toContain('[PROFILE]');
    expect(result.text).toContain('GET user.profile');
    expect(result.text).toContain('[HISTORY]');
    expect(result.text).toContain('LAST 5 FROM messages');
  });

  test('should respect priority ordering', () => {
    const builder = new ContextQueryBuilder();
    
    const result = builder
      .literal('LOW', 10, 'Low priority')
      .literal('HIGH', 1, 'High priority')
      .literal('MEDIUM', 5, 'Medium priority')
      .execute();

    const highIndex = result.text.indexOf('High priority');
    const mediumIndex = result.text.indexOf('Medium priority');
    const lowIndex = result.text.indexOf('Low priority');

    expect(highIndex).toBeLessThan(mediumIndex);
    expect(mediumIndex).toBeLessThan(lowIndex);
  });

  test('should truncate with tail drop strategy', () => {
    const builder = new ContextQueryBuilder();
    
    const longText = 'A'.repeat(1000);
    
    const result = builder
      .withBudget(100) // Very small budget
      .setTruncation(TruncationStrategy.TAIL_DROP)
      .literal('SECTION1', 1, 'High priority short')
      .literal('SECTION2', 2, longText)
      .execute();

    expect(result.tokenCount).toBeLessThanOrEqual(100);
    expect(result.text).toContain('High priority short');
    // SECTION2 should be dropped
    expect(result.sections.find(s => s.name === 'SECTION2')?.truncated).toBe(true);
  });

  test('should format as JSON', () => {
    const builder = new ContextQueryBuilder();
    
    const result = builder
      .setFormat(ContextOutputFormat.JSON)
      .literal('SYSTEM', 0, 'You are helpful')
      .literal('USER', 1, 'Hello')
      .execute();

    const parsed = JSON.parse(result.text);
    expect(parsed.SYSTEM).toBe('You are helpful');
    expect(parsed.USER).toBe('Hello');
  });

  test('should format as Markdown', () => {
    const builder = new ContextQueryBuilder();
    
    const result = builder
      .setFormat(ContextOutputFormat.MARKDOWN)
      .literal('SYSTEM', 0, 'You are helpful')
      .literal('USER', 1, 'Hello')
      .execute();

    expect(result.text).toContain('## SYSTEM');
    expect(result.text).toContain('## USER');
  });

  test('should handle section builder pattern', () => {
    const builder = new ContextQueryBuilder();
    
    const result = builder
      .section('SEARCH', 3)
        .search('documents', '$query_embedding', 5)
        .done()
      .section('SQL', 4)
        .sql('SELECT * FROM users WHERE active = true')
        .done()
      .execute();

    expect(result.text).toContain('SEARCH documents');
    expect(result.text).toContain('SQL: SELECT');
  });
});

// Helper function
function generateRandomVector(dimension: number): number[] {
  const vector: number[] = [];
  let norm = 0;
  
  for (let i = 0; i < dimension; i++) {
    const value = Math.random() * 2 - 1;
    vector.push(value);
    norm += value * value;
  }
  
  // Normalize
  norm = Math.sqrt(norm);
  return vector.map(v => v / norm);
}
