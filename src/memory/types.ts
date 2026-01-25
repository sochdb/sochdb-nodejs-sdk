/**
 * Memory System Core Types
 * 
 * Type definitions for LLM-native memory system with extraction,
 * consolidation, and retrieval capabilities.
 */

/**
 * Entity extracted from text
 */
export interface Entity {
  id?: string;
  name: string;
  entityType: string;
  properties?: Record<string, any>;
  confidence?: number;
  provenance?: string;
  timestamp?: number;
}

/**
 * Relation between two entities
 */
export interface Relation {
  id?: string;
  fromEntity: string;
  relationType: string;
  toEntity: string;
  properties?: Record<string, any>;
  confidence?: number;
  provenance?: string;
  timestamp?: number;
}

/**
 * Assertion (subject-predicate-object triple)
 */
export interface Assertion {
  id?: string;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  provenance?: string;
  timestamp?: number;
}

/**
 * Raw assertion for consolidation
 */
export interface RawAssertion {
  id?: string;
  fact: Record<string, any>;
  source: string;
  confidence: number;
  timestamp?: number;
}

/**
 * Canonical fact after consolidation
 */
export interface CanonicalFact {
  id: string;
  mergedFact: Record<string, any>;
  confidence: number;
  sources: string[];
  validFrom: number;
  validUntil?: number;
}

/**
 * Extraction result from LLM
 */
export interface ExtractionResult {
  entities: Entity[];
  relations: Relation[];
  assertions: Assertion[];
}

/**
 * Extraction schema for validation
 */
export interface ExtractionSchema {
  entityTypes?: string[];
  relationTypes?: string[];
  minConfidence?: number;
  requireProvenance?: boolean;
}

/**
 * Consolidation configuration
 */
export interface ConsolidationConfig {
  similarityThreshold?: number;
  useTemporalUpdates?: boolean;
  maxConflictAge?: number; // seconds
}

/**
 * Retrieval configuration
 */
export interface RetrievalConfig {
  k?: number;
  alpha?: number; // 0=keyword only, 1=vector only, 0.5=balanced
  enableRerank?: boolean;
  rerankK?: number;
}

/**
 * Retrieval result
 */
export interface RetrievalResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, any>;
  vectorRank?: number;
  keywordRank?: number;
}

/**
 * Retrieval response
 */
export interface RetrievalResponse {
  results: RetrievalResult[];
  queryTime: number;
  totalResults: number;
}

/**
 * AllowedSet for pre-filtering
 */
export abstract class AllowedSet {
  abstract contains(id: string, metadata?: Record<string, any>): boolean;

  static fromIds(ids: string[]): AllowedSet {
    return new IdsAllowedSet(new Set(ids));
  }

  static fromNamespace(namespace: string): AllowedSet {
    return new NamespaceAllowedSet(namespace);
  }

  static fromFilter(filterFn: (id: string, metadata?: Record<string, any>) => boolean): AllowedSet {
    return new FilterAllowedSet(filterFn);
  }

  static allowAll(): AllowedSet {
    return new AllAllowedSet();
  }
}

class IdsAllowedSet extends AllowedSet {
  constructor(private ids: Set<string>) {
    super();
  }

  contains(id: string): boolean {
    return this.ids.has(id);
  }
}

class NamespaceAllowedSet extends AllowedSet {
  constructor(private namespace: string) {
    super();
  }

  contains(id: string): boolean {
    return id.startsWith(`${this.namespace}_`) || id.startsWith(`${this.namespace}:`);
  }
}

class FilterAllowedSet extends AllowedSet {
  constructor(private filterFn: (id: string, metadata?: Record<string, any>) => boolean) {
    super();
  }

  contains(id: string, metadata?: Record<string, any>): boolean {
    return this.filterFn(id, metadata);
  }
}

class AllAllowedSet extends AllowedSet {
  contains(): boolean {
    return true;
  }
}

/**
 * Namespace policy
 */
export enum NamespacePolicy {
  STRICT = 'strict',
  EXPLICIT = 'explicit',
  PERMISSIVE = 'permissive',
}

/**
 * Cross-namespace grant
 */
export interface NamespaceGrant {
  id: string;
  fromNamespace: string;
  toNamespace: string;
  operations: string[];
  expiresAt?: number;
  reason?: string;
}
