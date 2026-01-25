/**
 * SochDB Namespace API
 * 
 * Provides type-safe namespace isolation with first-class namespace handles.
 * 
 * @example
 * ```typescript
 * import { Database } from '@sochdb/sochdb';
 * 
 * const db = await Database.open('./mydb');
 * const ns = await db.createNamespace('tenant_123');
 * const collection = await ns.createCollection('documents', { dimension: 384 });
 * await collection.insert([1.0, 2.0, ...], { source: 'web' });
 * const results = await collection.search(queryVector, 10);
 * ```
 */

import { SochDBError, DatabaseError } from './errors';

// ============================================================================
// Namespace Configuration
// ============================================================================

export interface NamespaceConfig {
  name: string;
  displayName?: string;
  labels?: Record<string, string>;
  readOnly?: boolean;
}

export class NamespaceNotFoundError extends SochDBError {
  constructor(namespace: string) {
    super(`Namespace not found: ${namespace}`);
    this.name = 'NamespaceNotFoundError';
  }
}

export class NamespaceExistsError extends SochDBError {
  constructor(namespace: string) {
    super(`Namespace already exists: ${namespace}`);
    this.name = 'NamespaceExistsError';
  }
}

export class CollectionNotFoundError extends SochDBError {
  constructor(collection: string) {
    super(`Collection not found: ${collection}`);
    this.name = 'CollectionNotFoundError';
  }
}

export class CollectionExistsError extends SochDBError {
  constructor(collection: string) {
    super(`Collection already exists: ${collection}`);
    this.name = 'CollectionExistsError';
  }
}

// ============================================================================
// Collection Configuration
// ============================================================================

export enum DistanceMetric {
  Cosine = 'cosine',
  Euclidean = 'euclidean',
  DotProduct = 'dot',
}

export interface CollectionConfig {
  name: string;
  dimension?: number;
  metric?: DistanceMetric;
  indexed?: boolean;
  hnswM?: number;
  hnswEfConstruction?: number;
  metadata?: Record<string, any>;
}

export interface SearchRequest {
  queryVector: number[];
  k: number;
  filter?: Record<string, any>;
  includeMetadata?: boolean;
}

export interface SearchResult {
  id: string;
  score: number;
  vector?: number[];
  metadata?: Record<string, any>;
}

// ============================================================================
// Collection Handle
// ============================================================================

export class Collection {
  constructor(
    private db: any,
    private namespace: string,
    private name: string,
    private config: CollectionConfig
  ) {}

  /**
   * Insert a vector with optional metadata
   */
  async insert(
    vector: number[],
    metadata?: Record<string, any>,
    id?: string
  ): Promise<string> {
    if (this.config.dimension && vector.length !== this.config.dimension) {
      throw new DatabaseError(
        `Vector dimension mismatch: expected ${this.config.dimension}, got ${vector.length}`
      );
    }

    const vectorId = id || this.generateId();
    const key = this.vectorKey(vectorId);
    
    const data = {
      vector,
      metadata: metadata || {},
      timestamp: Date.now(),
    };

    await this.db.put(Buffer.from(key), Buffer.from(JSON.stringify(data)));
    return vectorId;
  }

  /**
   * Insert multiple vectors
   */
  async insertMany(
    vectors: number[][],
    metadatas?: Record<string, any>[],
    ids?: string[]
  ): Promise<string[]> {
    const resultIds: string[] = [];
    
    for (let i = 0; i < vectors.length; i++) {
      const id = ids ? ids[i] : undefined;
      const metadata = metadatas ? metadatas[i] : undefined;
      const resultId = await this.insert(vectors[i], metadata, id);
      resultIds.push(resultId);
    }
    
    return resultIds;
  }

  /**
   * Search for similar vectors
   */
  async search(request: SearchRequest): Promise<SearchResult[]> {
    // For now, implement basic linear search
    // In production, this would use HNSW index
    const results: SearchResult[] = [];
    const prefix = this.vectorKeyPrefix();
    
    // Scan all vectors in collection
    const allVectors: Array<{ id: string; vector: number[]; metadata?: any; score: number }> = [];
    
    // TODO: Implement efficient scanning with range queries
    // For now, this is a placeholder that shows the API structure
    
    // Sort by similarity score
    allVectors.sort((a, b) => b.score - a.score);
    
    // Return top-k results
    return allVectors.slice(0, request.k).map(v => ({
      id: v.id,
      score: v.score,
      vector: request.includeMetadata ? v.vector : undefined,
      metadata: request.includeMetadata ? v.metadata : undefined,
    }));
  }

  /**
   * Get a vector by ID
   */
  async get(id: string): Promise<{ vector: number[]; metadata?: Record<string, any> } | null> {
    const key = this.vectorKey(id);
    const value = await this.db.get(Buffer.from(key));
    
    if (!value) {
      return null;
    }
    
    const data = JSON.parse(value.toString());
    return {
      vector: data.vector,
      metadata: data.metadata,
    };
  }

  /**
   * Delete a vector by ID
   */
  async delete(id: string): Promise<boolean> {
    const key = this.vectorKey(id);
    await this.db.delete(Buffer.from(key));
    return true;
  }

  /**
   * Count vectors in collection
   */
  async count(): Promise<number> {
    // TODO: Implement efficient counting
    return 0;
  }

  // Helper methods
  private vectorKey(id: string): string {
    return `_collection/${this.namespace}/${this.name}/vectors/${id}`;
  }

  private vectorKeyPrefix(): string {
    return `_collection/${this.namespace}/${this.name}/vectors/`;
  }

  private metadataKey(): string {
    return `_collection/${this.namespace}/${this.name}/metadata`;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Calculate cosine similarity
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// ============================================================================
// Namespace Handle
// ============================================================================

export class Namespace {
  constructor(
    private db: any,
    private name: string,
    private config: NamespaceConfig
  ) {}

  /**
   * Create a new collection in this namespace
   */
  async createCollection(config: CollectionConfig): Promise<Collection> {
    const metadataKey = `_collection/${this.name}/${config.name}/metadata`;
    
    // Check if collection already exists
    const existing = await this.db.get(Buffer.from(metadataKey));
    if (existing) {
      throw new CollectionExistsError(config.name);
    }

    // Store collection metadata
    const metadata = {
      ...config,
      createdAt: Date.now(),
    };
    
    await this.db.put(
      Buffer.from(metadataKey),
      Buffer.from(JSON.stringify(metadata))
    );

    return new Collection(this.db, this.name, config.name, config);
  }

  /**
   * Get an existing collection
   */
  async collection(name: string): Promise<Collection> {
    const metadataKey = `_collection/${this.name}/${name}/metadata`;
    const metadata = await this.db.get(Buffer.from(metadataKey));
    
    if (!metadata) {
      throw new CollectionNotFoundError(name);
    }

    const config = JSON.parse(metadata.toString());
    return new Collection(this.db, this.name, name, config);
  }

  /**
   * Get or create a collection
   */
  async getOrCreateCollection(config: CollectionConfig): Promise<Collection> {
    try {
      return await this.collection(config.name);
    } catch (error) {
      if (error instanceof CollectionNotFoundError) {
        return await this.createCollection(config);
      }
      throw error;
    }
  }

  /**
   * Delete a collection
   */
  async deleteCollection(name: string): Promise<boolean> {
    const metadataKey = `_collection/${this.name}/${name}/metadata`;
    const prefix = `_collection/${this.name}/${name}/`;
    
    // TODO: Delete all keys with prefix
    await this.db.delete(Buffer.from(metadataKey));
    
    return true;
  }

  /**
   * List all collections in this namespace
   */
  async listCollections(): Promise<string[]> {
    // TODO: Implement efficient listing with range queries
    return [];
  }

  getName(): string {
    return this.name;
  }

  getConfig(): NamespaceConfig {
    return { ...this.config };
  }
}
