/**
 * Semantic Cache for LLM responses
 * 
 * Cache LLM responses with similarity-based retrieval for cost savings.
 * Uses database prefix scanning to store and retrieve cached responses.
 */

import { EmbeddedDatabase } from './embedded';

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface CacheEntry {
  key: string;
  value: string;
  embedding: number[];
  timestamp: number;
  ttl?: number;
  metadata?: Record<string, any>;
}

export interface CacheHit extends CacheEntry {
  score: number;
}

export interface CacheStats {
  count: number;
  hits: number;
  misses: number;
  hitRate: number;
  memoryUsage: number;
}

/**
 * Semantic Cache with vector similarity matching
 * 
 * @example
 * ```typescript
 * const cache = new SemanticCache(db, 'llm_responses');
 * 
 * // Store response
 * await cache.put(
 *   'What is Python?',
 *   'Python is a high-level programming language...',
 *   embedding,
 *   3600  // TTL in seconds
 * );
 * 
 * // Check cache
 * const hit = await cache.get(queryEmbedding, 0.85);
 * if (hit) {
 *   console.log(`Cache HIT: ${hit.value} (similarity: ${hit.score})`);
 * }
 * ```
 */
export class SemanticCache {
  private db: EmbeddedDatabase;
  private cacheName: string;
  private prefix: Buffer;
  private hits = 0;
  private misses = 0;

  constructor(db: EmbeddedDatabase, cacheName: string) {
    this.db = db;
    this.cacheName = cacheName;
    this.prefix = Buffer.from(`cache:${cacheName}:`);
  }

  /**
   * Store a cached response
   */
  async put(
    key: string,
    value: string,
    embedding: number[],
    ttlSeconds = 0,
    metadata?: Record<string, any>
  ): Promise<void> {
    const entry: CacheEntry = {
      key,
      value,
      embedding,
      timestamp: Date.now(),
      ttl: ttlSeconds > 0 ? ttlSeconds : undefined,
      metadata,
    };

    const entryKey = Buffer.concat([
      this.prefix,
      Buffer.from(key),
    ]);

    await this.db.put(entryKey, Buffer.from(JSON.stringify(entry)));
  }

  /**
   * Retrieve cached response by similarity
   * 
   * @param queryEmbedding - Query embedding vector
   * @param threshold - Minimum cosine similarity (0-1)
   * @returns Best matching cache entry or null
   */
  async get(
    queryEmbedding: number[],
    threshold = 0.85
  ): Promise<CacheHit | null> {
    const now = Date.now();
    let bestMatch: CacheHit | null = null;
    let bestScore = threshold;

    // Scan all cache entries with this prefix
    try {
      for await (const [_, valueBuffer] of this.db.scanPrefix(this.prefix)) {
        const entry: CacheEntry = JSON.parse(valueBuffer.toString());

        // Check TTL expiration
        if (entry.ttl && entry.timestamp) {
          const expiresAt = entry.timestamp + entry.ttl * 1000;
          if (now > expiresAt) {
            continue; // Skip expired entries
          }
        }

        // Calculate similarity
        const score = cosineSimilarity(queryEmbedding, entry.embedding);

        // Update best match
        if (score > bestScore) {
          bestScore = score;
          bestMatch = { ...entry, score };
        }
      }
    } catch (error) {
      // If scan fails, return null
      this.misses++;
      return null;
    }

    if (bestMatch) {
      this.hits++;
    } else {
      this.misses++;
    }

    return bestMatch;
  }

  /**
   * Delete a specific cache entry
   */
  async delete(key: string): Promise<void> {
    const entryKey = Buffer.concat([
      this.prefix,
      Buffer.from(key),
    ]);
    await this.db.delete(entryKey);
  }

  /**
   * Clear all entries in this cache
   */
  async clear(): Promise<number> {
    let deleted = 0;

    try {
      const toDelete: Buffer[] = [];
      for await (const [key] of this.db.scanPrefix(this.prefix)) {
        toDelete.push(key);
      }

      for (const key of toDelete) {
        await this.db.delete(key);
        deleted++;
      }
    } catch (error) {
      // If operation fails, return count so far
      return deleted;
    }

    // Reset stats
    this.hits = 0;
    this.misses = 0;

    return deleted;
  }

  /**
   * Get cache statistics
   */
  async stats(): Promise<CacheStats> {
    const now = Date.now();
    let count = 0;
    let memoryUsage = 0;

    try {
      for await (const [key, value] of this.db.scanPrefix(this.prefix)) {
        const entry: CacheEntry = JSON.parse(value.toString());
        
        // Skip expired entries
        if (entry.ttl && entry.timestamp) {
          const expiresAt = entry.timestamp + entry.ttl * 1000;
          if (now > expiresAt) {
            continue;
          }
        }

        count++;
        memoryUsage += key.length + value.length;
      }
    } catch (error) {
      // Return partial stats if operation fails
    }

    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      count,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      memoryUsage,
    };
  }

  /**
   * Purge expired entries
   */
  async purgeExpired(): Promise<number> {
    const now = Date.now();
    let purged = 0;

    try {
      const toDelete: Buffer[] = [];

      for await (const [key, value] of this.db.scanPrefix(this.prefix)) {
        const entry: CacheEntry = JSON.parse(value.toString());
        
        if (entry.ttl && entry.timestamp) {
          const expiresAt = entry.timestamp + entry.ttl * 1000;
          if (now > expiresAt) {
            toDelete.push(key);
          }
        }
      }

      for (const key of toDelete) {
        await this.db.delete(key);
        purged++;
      }
    } catch (error) {
      // Return count so far
      return purged;
    }

    return purged;
  }
}
