/**
 * Namespace and Collection API Example (v0.4.1)
 * 
 * This example demonstrates:
 * - Creating and managing namespaces
 * - Creating vector collections
 * - Inserting and searching vectors
 * - Multi-tenant isolation
 */

import { EmbeddedDatabase as Database } from '../src/embedded/database';
import { Namespace, Collection, DistanceMetric } from '../src/namespace';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  // Clean up previous test data
  const dbPath = path.join(__dirname, '../test-data/namespace-example-db');
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }

  console.log('🚀 SochDB Namespace & Collection API Example\n');

  // Open embedded database
  const db = await Database.open(dbPath);
  console.log('✅ Database opened\n');

  try {
    // Example 1: Create namespace for a tenant
    console.log('📁 Creating namespace for tenant...');
    const namespace = new Namespace(
      db,
      'tenant_acme',
      {
        name: 'tenant_acme',
        displayName: 'ACME Corporation',
        labels: { 'plan': 'enterprise', 'region': 'us-west' },
        readOnly: false
      }
    );
    console.log('✅ Namespace created: tenant_acme\n');

    // Example 2: Create a vector collection for document embeddings
    console.log('📊 Creating vector collection...');
    const docsCollection = await namespace.createCollection({
      name: 'documents',
      dimension: 384,  // Common for all-MiniLM-L6-v2 embeddings
      metric: DistanceMetric.Cosine,
      indexed: true,
      hnswM: 16,
      hnswEfConstruction: 200
    });
    console.log('✅ Collection created: documents (dim=384, metric=cosine)\n');

    // Example 3: Insert sample document embeddings
    console.log('📝 Inserting document vectors...');
    
    // Simulate document embeddings (in real app, use actual embeddings from a model)
    const docs = [
      {
        vector: generateRandomVector(384),
        metadata: { title: 'Product Manual', type: 'documentation', page: 1 }
      },
      {
        vector: generateRandomVector(384),
        metadata: { title: 'API Reference', type: 'documentation', page: 5 }
      },
      {
        vector: generateRandomVector(384),
        metadata: { title: 'Setup Guide', type: 'tutorial', page: 1 }
      },
      {
        vector: generateRandomVector(384),
        metadata: { title: 'Best Practices', type: 'guide', page: 10 }
      },
      {
        vector: generateRandomVector(384),
        metadata: { title: 'Troubleshooting', type: 'support', page: 3 }
      }
    ];

    const insertedIds: string[] = [];
    for (const doc of docs) {
      const id = await docsCollection.insert(doc.vector, doc.metadata);
      insertedIds.push(id);
      console.log(`  ✓ Inserted: ${doc.metadata.title} (ID: ${id.substring(0, 12)}...)`);
    }
    console.log(`✅ Inserted ${docs.length} documents\n`);

    // Example 4: Search for similar documents
    console.log('🔍 Searching for similar documents...');
    const queryVector = generateRandomVector(384);
    
    const searchResults = await docsCollection.search({
      queryVector: queryVector,
      k: 3,
      includeMetadata: true
    });

    console.log(`Found ${searchResults.length} similar documents:`);
    searchResults.forEach((result: any, idx: number) => {
      console.log(`  ${idx + 1}. ${result.metadata?.title || 'Unknown'}`);
      console.log(`     Type: ${result.metadata?.type}, Page: ${result.metadata?.page}`);
      console.log(`     Score: ${result.score.toFixed(4)}`);
    });
    console.log();

    // Example 5: Get specific document
    console.log('📖 Retrieving specific document...');
    const docId = insertedIds[0];
    const retrievedDoc = await docsCollection.get(docId);
    if (retrievedDoc) {
      console.log(`✅ Retrieved: ${retrievedDoc.metadata?.title}`);
      console.log(`   Vector dimension: ${retrievedDoc.vector.length}`);
    }
    console.log();

    // Example 6: Delete a document
    console.log('🗑️  Deleting a document...');
    await docsCollection.delete(insertedIds[insertedIds.length - 1]);
    console.log('✅ Document deleted\n');

    // Example 7: Create another collection for product embeddings
    console.log('📊 Creating product catalog collection...');
    const productsCollection = await namespace.createCollection({
      name: 'products',
      dimension: 512,  // Different dimension for product embeddings
      metric: DistanceMetric.DotProduct
    });
    console.log('✅ Collection created: products (dim=512, metric=dot-product)\n');

    // Insert product embeddings
    console.log('📝 Inserting product vectors...');
    const products = [
      { name: 'Laptop Pro', category: 'electronics', price: 1299 },
      { name: 'Wireless Mouse', category: 'accessories', price: 29 },
      { name: 'USB-C Cable', category: 'accessories', price: 15 }
    ];

    for (const product of products) {
      const vector = generateRandomVector(512);
      const id = await productsCollection.insert(vector, product);
      console.log(`  ✓ Inserted: ${product.name} ($${product.price})`);
    }
    console.log(`✅ Inserted ${products.length} products\n`);

    // Example 8: Multi-tenant isolation - Create another namespace
    console.log('🏢 Creating namespace for another tenant...');
    const namespace2 = new Namespace(
      db,
      'tenant_widgets',
      {
        name: 'tenant_widgets',
        displayName: 'Widgets Inc.',
        labels: { 'plan': 'professional', 'region': 'eu-west' },
        readOnly: false
      }
    );
    
    const widgets_docs = await namespace2.createCollection({
      name: 'documents',
      dimension: 384,
      metric: DistanceMetric.Cosine
    });
    console.log('✅ Created isolated namespace: tenant_widgets');
    console.log('   Each tenant has their own isolated data\n');

    console.log('✨ Example completed successfully!\n');
    console.log('Key Features Demonstrated:');
    console.log('  ✓ Multi-tenant namespace isolation');
    console.log('  ✓ Vector collections with configurable dimensions');
    console.log('  ✓ Multiple distance metrics (cosine, dot-product)');
    console.log('  ✓ Insert, search, and retrieve operations');
    console.log('  ✓ Metadata storage and filtering');
    console.log('  ✓ HNSW index configuration');

  } finally {
    await db.close();
    console.log('\n✅ Database closed');
  }
}

// Helper function to generate random normalized vectors
function generateRandomVector(dimension: number): number[] {
  const vector: number[] = [];
  let norm = 0;
  
  // Generate random values
  for (let i = 0; i < dimension; i++) {
    const value = Math.random() * 2 - 1;
    vector.push(value);
    norm += value * value;
  }
  
  // Normalize for cosine similarity
  norm = Math.sqrt(norm);
  return vector.map(v => v / norm);
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}
