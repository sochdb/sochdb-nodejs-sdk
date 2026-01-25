/**
 * Consolidator for Memory System
 * 
 * Event-sourced consolidation with append-only events and derived canonical facts.
 */

import { EmbeddedDatabase } from '../embedded';
import {
  RawAssertion,
  CanonicalFact,
  ConsolidationConfig,
} from './types';
import { createHash } from 'crypto';

/**
 * Consolidator for managing facts
 */
export class Consolidator {
  private db: EmbeddedDatabase;
  private namespace: string;
  private config: ConsolidationConfig;
  private prefix: Buffer;

  constructor(db: EmbeddedDatabase, namespace: string, config?: ConsolidationConfig) {
    this.db = db;
    this.namespace = namespace;
    this.config = {
      similarityThreshold: config?.similarityThreshold || 0.85,
      useTemporalUpdates: config?.useTemporalUpdates !== false,
      maxConflictAge: config?.maxConflictAge || 86400, // 24 hours default
    };
    this.prefix = Buffer.from(`consolidation:${namespace}:`);
  }

  /**
   * Create consolidator from database
   */
  static fromDatabase(db: EmbeddedDatabase, namespace: string, config?: ConsolidationConfig): Consolidator {
    return new Consolidator(db, namespace, config);
  }

  /**
   * Add a raw assertion (immutable event)
   */
  async add(assertion: RawAssertion): Promise<string> {
    const id = assertion.id || this.generateAssertionId(assertion);
    const timestamp = assertion.timestamp || Date.now();

    const storedAssertion: RawAssertion = {
      ...assertion,
      id,
      timestamp,
    };

    const key = Buffer.concat([this.prefix, Buffer.from(`assertion:${id}`)]);
    await this.db.put(key, Buffer.from(JSON.stringify(storedAssertion)));

    return id;
  }

  /**
   * Add assertion with contradiction handling
   */
  async addWithContradiction(newAssertion: RawAssertion, contradicts: string[]): Promise<string> {
    const id = await this.add(newAssertion);

    // Mark contradicted assertions
    for (const contradictedId of contradicts) {
      const contradictionKey = Buffer.concat([
        this.prefix,
        Buffer.from(`contradiction:${contradictedId}:${id}`),
      ]);
      await this.db.put(contradictionKey, Buffer.from(JSON.stringify({
        from: contradictedId,
        to: id,
        timestamp: Date.now(),
      })));
    }

    return id;
  }

  /**
   * Run consolidation to update canonical view
   */
  async consolidate(): Promise<number> {
    const assertions = await this.getAllAssertions();
    const contradictions = await this.getContradictions();
    
    // Group assertions by subject
    const groups = new Map<string, RawAssertion[]>();
    for (const assertion of assertions) {
      const subject = JSON.stringify(assertion.fact);
      const group = groups.get(subject) || [];
      group.push(assertion);
      groups.set(subject, group);
    }

    let updated = 0;

    // Create canonical facts
    for (const [subject, group] of groups) {
      // Sort by confidence and timestamp
      group.sort((a, b) => {
        if (b.confidence !== a.confidence) {
          return b.confidence - a.confidence;
        }
        return (b.timestamp || 0) - (a.timestamp || 0);
      });

      // Check for contradictions
      const validAssertions = group.filter(a => {
        const isContradicted = contradictions.some(c => c.from === a.id);
        if (isContradicted && this.config.useTemporalUpdates) {
          // Find the contradicting assertion
          const contradiction = contradictions.find(c => c.from === a.id);
          if (contradiction) {
            const age = Date.now() - (contradiction.timestamp || 0);
            return age > this.config.maxConflictAge!;
          }
        }
        return !isContradicted;
      });

      if (validAssertions.length > 0) {
        const canonical: CanonicalFact = {
          id: this.generateCanonicalId(validAssertions[0]),
          mergedFact: validAssertions[0].fact,
          confidence: this.mergeConfidence(validAssertions),
          sources: validAssertions.map(a => a.source),
          validFrom: Math.min(...validAssertions.map(a => a.timestamp || 0)),
          validUntil: undefined,
        };

        const key = Buffer.concat([this.prefix, Buffer.from(`canonical:${canonical.id}`)]);
        await this.db.put(key, Buffer.from(JSON.stringify(canonical)));
        updated++;
      }
    }

    return updated;
  }

  /**
   * Get canonical facts
   */
  async getCanonicalFacts(): Promise<CanonicalFact[]> {
    const facts: CanonicalFact[] = [];
    const canonicalPrefix = Buffer.concat([this.prefix, Buffer.from('canonical:')]);

    for await (const [_, value] of this.db.scanPrefix(canonicalPrefix)) {
      facts.push(JSON.parse(value.toString()));
    }

    return facts;
  }

  /**
   * Explain provenance of a fact
   */
  async explain(factId: string): Promise<{ evidenceCount: number; sources: string[]; confidence: number }> {
    const key = Buffer.concat([this.prefix, Buffer.from(`canonical:${factId}`)]);
    const value = await this.db.get(key);
    
    if (!value) {
      return { evidenceCount: 0, sources: [], confidence: 0 };
    }

    const fact: CanonicalFact = JSON.parse(value.toString());
    return {
      evidenceCount: fact.sources.length,
      sources: fact.sources,
      confidence: fact.confidence,
    };
  }

  /**
   * Get all raw assertions
   */
  private async getAllAssertions(): Promise<RawAssertion[]> {
    const assertions: RawAssertion[] = [];
    const assertionPrefix = Buffer.concat([this.prefix, Buffer.from('assertion:')]);

    for await (const [_, value] of this.db.scanPrefix(assertionPrefix)) {
      assertions.push(JSON.parse(value.toString()));
    }

    return assertions;
  }

  /**
   * Get all contradictions
   */
  private async getContradictions(): Promise<Array<{ from: string; to: string; timestamp: number }>> {
    const contradictions: Array<{ from: string; to: string; timestamp: number }> = [];
    const contradictionPrefix = Buffer.concat([this.prefix, Buffer.from('contradiction:')]);

    for await (const [_, value] of this.db.scanPrefix(contradictionPrefix)) {
      contradictions.push(JSON.parse(value.toString()));
    }

    return contradictions;
  }

  /**
   * Merge confidence from multiple assertions
   */
  private mergeConfidence(assertions: RawAssertion[]): number {
    if (assertions.length === 0) return 0;
    if (assertions.length === 1) return assertions[0].confidence;

    // Average with weight toward higher confidence
    const sorted = [...assertions].sort((a, b) => b.confidence - a.confidence);
    const weights = sorted.map((_, i) => 1 / (i + 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    
    return sorted.reduce((acc, assertion, i) => {
      return acc + (assertion.confidence * weights[i]) / totalWeight;
    }, 0);
  }

  /**
   * Generate deterministic assertion ID
   */
  private generateAssertionId(assertion: RawAssertion): string {
    return createHash('sha256')
      .update(JSON.stringify(assertion.fact) + assertion.source)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Generate deterministic canonical fact ID
   */
  private generateCanonicalId(assertion: RawAssertion): string {
    return createHash('sha256')
      .update(JSON.stringify(assertion.fact))
      .digest('hex')
      .substring(0, 16);
  }
}
