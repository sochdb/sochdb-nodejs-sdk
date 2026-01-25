/**
 * Hybrid Retriever for Memory System
 * 
 * Combines vector and keyword search with RRF (Reciprocal Rank Fusion).
 */

import { EmbeddedDatabase } from '../embedded';
import {
  AllowedSet,
  RetrievalConfig,
  RetrievalResponse,
  RetrievalResult,
} from './types';

/**
 * Simple BM25 scorer for keyword matching
 */
class BM25Scorer {
  private k1 = 1.5;
  private b = 0.75;
  private avgDocLength: number;
  private docLengths: Map<string, number>;
  private termFreqs: Map<string, Map<string, number>>;
  private docFreqs: Map<string, number>;
  private numDocs: number;

  constructor() {
    this.avgDocLength = 0;
    this.docLengths = new Map();
    this.termFreqs = new Map();
    this.docFreqs = new Map();
    this.numDocs = 0;
  }

  /**
   * Index a document
   */
  indexDocument(docId: string, text: string): void {
    const terms = this.tokenize(text);
    const termCounts = new Map<string, number>();

    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) || 0) + 1);
    }

    this.docLengths.set(docId, terms.length);
    this.termFreqs.set(docId, termCounts);

    for (const term of termCounts.keys()) {
      this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1);
    }

    this.numDocs++;
    this.updateAvgDocLength();
  }

  /**
   * Score a query against a document
   */
  score(docId: string, queryTerms: string[]): number {
    const termCounts = this.termFreqs.get(docId);
    if (!termCounts) return 0;

    const docLength = this.docLengths.get(docId) || 0;
    let score = 0;

    for (const term of queryTerms) {
      const tf = termCounts.get(term) || 0;
      const df = this.docFreqs.get(term) || 0;
      
      if (tf === 0) continue;

      const idf = Math.log((this.numDocs - df + 0.5) / (df + 0.5) + 1);
      const norm = tf / (tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength)));
      
      score += idf * norm;
    }

    return score;
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  /**
   * Update average document length
   */
  private updateAvgDocLength(): void {
    const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
    this.avgDocLength = totalLength / this.numDocs;
  }
}

/**
 * Cosine similarity for vector search
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Hybrid Retriever with RRF fusion
 */
export class HybridRetriever {
  private db: EmbeddedDatabase;
  private namespace: string;
  private collection: string;
  private config: RetrievalConfig;
  private prefix: Buffer;
  private bm25: BM25Scorer;
  private indexed: boolean = false;

  constructor(
    db: EmbeddedDatabase,
    namespace: string,
    collection: string,
    config?: RetrievalConfig
  ) {
    this.db = db;
    this.namespace = namespace;
    this.collection = collection;
    this.config = {
      k: config?.k || 10,
      alpha: config?.alpha !== undefined ? config.alpha : 0.5,
      enableRerank: config?.enableRerank || false,
      rerankK: config?.rerankK || 100,
    };
    this.prefix = Buffer.from(`retrieval:${namespace}:${collection}:`);
    this.bm25 = new BM25Scorer();
  }

  /**
   * Create retriever from database
   */
  static fromDatabase(
    db: EmbeddedDatabase,
    namespace: string,
    collection: string,
    config?: RetrievalConfig
  ): HybridRetriever {
    return new HybridRetriever(db, namespace, collection, config);
  }

  /**
   * Index documents for retrieval
   */
  async indexDocuments(documents: Array<{ id: string; content: string; embedding: number[]; metadata?: Record<string, any> }>): Promise<void> {
    for (const doc of documents) {
      const key = Buffer.concat([this.prefix, Buffer.from(doc.id)]);
      await this.db.put(key, Buffer.from(JSON.stringify({
        id: doc.id,
        content: doc.content,
        embedding: doc.embedding,
        metadata: doc.metadata,
      })));

      // Index for BM25
      this.bm25.indexDocument(doc.id, doc.content);
    }

    this.indexed = true;
  }

  /**
   * Retrieve documents with hybrid search
   */
  async retrieve(
    queryText: string,
    queryVector: number[],
    allowed: AllowedSet,
    k?: number
  ): Promise<RetrievalResponse> {
    const startTime = Date.now();
    const targetK = k || this.config.k!;

    // Get all documents
    const documents: Array<{
      id: string;
      content: string;
      embedding: number[];
      metadata?: Record<string, any>;
    }> = [];

    for await (const [_, value] of this.db.scanPrefix(this.prefix)) {
      const doc = JSON.parse(value.toString());
      
      // Apply pre-filtering with AllowedSet
      if (allowed.contains(doc.id, doc.metadata)) {
        documents.push(doc);
      }
    }

    // Vector search scores
    const vectorScores = new Map<string, { score: number; rank: number }>();
    documents
      .map(doc => ({
        id: doc.id,
        score: cosineSimilarity(queryVector, doc.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .forEach((item, rank) => {
        vectorScores.set(item.id, { score: item.score, rank });
      });

    // Keyword search scores (BM25)
    const queryTerms = queryText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);

    const keywordScores = new Map<string, { score: number; rank: number }>();
    documents
      .map(doc => ({
        id: doc.id,
        score: this.bm25.score(doc.id, queryTerms),
      }))
      .sort((a, b) => b.score - a.score)
      .forEach((item, rank) => {
        keywordScores.set(item.id, { score: item.score, rank });
      });

    // RRF (Reciprocal Rank Fusion)
    const k_rrf = 60; // RRF constant
    const alpha = this.config.alpha!;
    
    const fusedScores = documents.map(doc => {
      const vectorData = vectorScores.get(doc.id);
      const keywordData = keywordScores.get(doc.id);
      
      const vectorScore = vectorData ? 1 / (k_rrf + vectorData.rank) : 0;
      const keywordScore = keywordData ? 1 / (k_rrf + keywordData.rank) : 0;
      
      // Weighted combination
      const finalScore = alpha * vectorScore + (1 - alpha) * keywordScore;

      return {
        id: doc.id,
        score: finalScore,
        content: doc.content,
        metadata: doc.metadata,
        vectorRank: vectorData?.rank,
        keywordRank: keywordData?.rank,
      };
    });

    // Sort by fused score and take top k
    fusedScores.sort((a, b) => b.score - a.score);
    const results = fusedScores.slice(0, targetK);

    return {
      results,
      queryTime: Date.now() - startTime,
      totalResults: documents.length,
    };
  }

  /**
   * Explain ranking for a specific document
   */
  async explain(
    queryText: string,
    queryVector: number[],
    docId: string
  ): Promise<{ vectorRank?: number; keywordRank?: number; expectedRrfScore?: number }> {
    // Simplified version - full implementation would require re-running retrieval
    const key = Buffer.concat([this.prefix, Buffer.from(docId)]);
    const value = await this.db.get(key);
    
    if (!value) {
      return {};
    }

    const doc = JSON.parse(value.toString());
    
    const vectorScore = cosineSimilarity(queryVector, doc.embedding);
    const queryTerms = queryText
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
    const keywordScore = this.bm25.score(docId, queryTerms);

    return {
      vectorRank: undefined, // Would need full ranking
      keywordRank: undefined,
      expectedRrfScore: vectorScore + keywordScore, // Simplified
    };
  }
}
