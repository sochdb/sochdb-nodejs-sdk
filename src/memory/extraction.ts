/**
 * Extraction Pipeline for Memory System
 * 
 * Compiles LLM outputs into typed, validated facts (Entity, Relation, Assertion).
 */

import { EmbeddedDatabase } from '../embedded';
import {
  Entity,
  Relation,
  Assertion,
  ExtractionResult,
  ExtractionSchema,
} from './types';
import { createHash } from 'crypto';

/**
 * Extractor function type - user provides this to call their LLM
 */
export type ExtractorFunction = (text: string) => Promise<{
  entities?: Array<{ name: string; entity_type: string; properties?: Record<string, any>; confidence?: number }>;
  relations?: Array<{ from_entity: string; relation_type: string; to_entity: string; properties?: Record<string, any>; confidence?: number }>;
  assertions?: Array<{ subject: string; predicate: string; object: string; confidence?: number }>;
}>;

/**
 * Extraction Pipeline
 */
export class ExtractionPipeline {
  private db: EmbeddedDatabase;
  private namespace: string;
  private schema?: ExtractionSchema;
  private prefix: Buffer;

  constructor(db: EmbeddedDatabase, namespace: string, schema?: ExtractionSchema) {
    this.db = db;
    this.namespace = namespace;
    this.schema = schema;
    this.prefix = Buffer.from(`memory:${namespace}:`);
  }

  /**
   * Create pipeline from database
   */
  static fromDatabase(db: EmbeddedDatabase, namespace: string, schema?: ExtractionSchema): ExtractionPipeline {
    return new ExtractionPipeline(db, namespace, schema);
  }

  /**
   * Extract entities and relations from text
   */
  async extract(text: string, extractor: ExtractorFunction): Promise<ExtractionResult> {
    const rawResult = await extractor(text);
    const timestamp = Date.now();

    // Normalize entities
    const entities: Entity[] = (rawResult.entities || []).map(e => ({
      id: this.generateEntityId(e.name, e.entity_type),
      name: e.name,
      entityType: e.entity_type,
      properties: e.properties,
      confidence: e.confidence || 1.0,
      provenance: text.substring(0, 100),
      timestamp,
    }));

    // Validate entities
    if (this.schema?.entityTypes) {
      const validTypes = new Set(this.schema.entityTypes);
      const filteredEntities = entities.filter(e => validTypes.has(e.entityType));
      if (filteredEntities.length < entities.length) {
        console.warn(`Filtered ${entities.length - filteredEntities.length} entities with invalid types`);
      }
      entities.splice(0, entities.length, ...filteredEntities);
    }

    // Normalize relations
    const relations: Relation[] = (rawResult.relations || []).map(r => ({
      id: this.generateRelationId(r.from_entity, r.relation_type, r.to_entity),
      fromEntity: r.from_entity,
      relationType: r.relation_type,
      toEntity: r.to_entity,
      properties: r.properties,
      confidence: r.confidence || 1.0,
      provenance: text.substring(0, 100),
      timestamp,
    }));

    // Validate relations
    if (this.schema?.relationTypes) {
      const validTypes = new Set(this.schema.relationTypes);
      const filteredRelations = relations.filter(r => validTypes.has(r.relationType));
      if (filteredRelations.length < relations.length) {
        console.warn(`Filtered ${relations.length - filteredRelations.length} relations with invalid types`);
      }
      relations.splice(0, relations.length, ...filteredRelations);
    }

    // Normalize assertions
    const assertions: Assertion[] = (rawResult.assertions || []).map(a => ({
      id: this.generateAssertionId(a.subject, a.predicate, a.object),
      subject: a.subject,
      predicate: a.predicate,
      object: a.object,
      confidence: a.confidence || 1.0,
      provenance: text.substring(0, 100),
      timestamp,
    }));

    // Apply min confidence filter
    if (this.schema?.minConfidence) {
      const minConf = this.schema.minConfidence;
      const filterByConfidence = <T extends { confidence?: number }>(items: T[]): T[] =>
        items.filter(item => (item.confidence || 0) >= minConf);

      entities.splice(0, entities.length, ...filterByConfidence(entities));
      relations.splice(0, relations.length, ...filterByConfidence(relations));
      assertions.splice(0, assertions.length, ...filterByConfidence(assertions));
    }

    return { entities, relations, assertions };
  }

  /**
   * Extract and immediately commit to database
   */
  async extractAndCommit(text: string, extractor: ExtractorFunction): Promise<ExtractionResult> {
    const result = await this.extract(text, extractor);
    await this.commit(result);
    return result;
  }

  /**
   * Commit extraction result to database
   */
  async commit(result: ExtractionResult): Promise<void> {
    // Store entities
    for (const entity of result.entities) {
      const key = Buffer.concat([this.prefix, Buffer.from(`entity:${entity.id}`)]);
      await this.db.put(key, Buffer.from(JSON.stringify(entity)));
    }

    // Store relations
    for (const relation of result.relations) {
      const key = Buffer.concat([this.prefix, Buffer.from(`relation:${relation.id}`)]);
      await this.db.put(key, Buffer.from(JSON.stringify(relation)));
    }

    // Store assertions
    for (const assertion of result.assertions) {
      const key = Buffer.concat([this.prefix, Buffer.from(`assertion:${assertion.id}`)]);
      await this.db.put(key, Buffer.from(JSON.stringify(assertion)));
    }
  }

  /**
   * Get all entities
   */
  async getEntities(): Promise<Entity[]> {
    const entities: Entity[] = [];
    const entityPrefix = Buffer.concat([this.prefix, Buffer.from('entity:')]);

    for await (const [_, value] of this.db.scanPrefix(entityPrefix)) {
      entities.push(JSON.parse(value.toString()));
    }

    return entities;
  }

  /**
   * Get all relations
   */
  async getRelations(): Promise<Relation[]> {
    const relations: Relation[] = [];
    const relationPrefix = Buffer.concat([this.prefix, Buffer.from('relation:')]);

    for await (const [_, value] of this.db.scanPrefix(relationPrefix)) {
      relations.push(JSON.parse(value.toString()));
    }

    return relations;
  }

  /**
   * Get all assertions
   */
  async getAssertions(): Promise<Assertion[]> {
    const assertions: Assertion[] = [];
    const assertionPrefix = Buffer.concat([this.prefix, Buffer.from('assertion:')]);

    for await (const [_, value] of this.db.scanPrefix(assertionPrefix)) {
      assertions.push(JSON.parse(value.toString()));
    }

    return assertions;
  }

  /**
   * Generate deterministic entity ID
   */
  private generateEntityId(name: string, entityType: string): string {
    return createHash('sha256')
      .update(`${name}:${entityType}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Generate deterministic relation ID
   */
  private generateRelationId(from: string, relationType: string, to: string): string {
    return createHash('sha256')
      .update(`${from}:${relationType}:${to}`)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Generate deterministic assertion ID
   */
  private generateAssertionId(subject: string, predicate: string, object: string): string {
    return createHash('sha256')
      .update(`${subject}:${predicate}:${object}`)
      .digest('hex')
      .substring(0, 16);
  }
}
