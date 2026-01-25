/**
 * Context Query Builder Example
 * 
 * Demonstrates building token-aware LLM contexts with priority-based sections.
 */

import { ContextQueryBuilder, ContextOutputFormat, TruncationStrategy } from '../src';

async function main() {
  console.log('=== Context Query Builder Examples ===\n');

  // Example 1: Basic context with literals
  console.log('=== Example 1: Basic Context ===');
  const builder1 = new ContextQueryBuilder()
    .withBudget(200)
    .setFormat(ContextOutputFormat.TOON);

  builder1
    .literal('SYSTEM', 0, 'You are a helpful AI assistant.')
    .literal('USER', 1, 'User: Hello, how can I analyze data?');

  const result1 = builder1.execute();
  console.log(`Token count: ${result1.tokenCount}`);
  console.log(`Context:\n${result1.text}\n`);

  // Example 2: Multiple sections with priorities
  console.log('=== Example 2: Priority-Based Sections ===');
  const builder2 = new ContextQueryBuilder()
    .withBudget(500)
    .setFormat(ContextOutputFormat.MARKDOWN);

  builder2
    .literal('SYSTEM', 0, '# System Instructions\nYou are an expert data scientist.')
    .literal('USER_PROFILE', 1, '## User Profile\n- Name: Alice\n- Role: Data Analyst\n- Experience: 3 years')
    .literal('HISTORY', 2, '## Recent Conversation\nUser asked about pandas DataFrame operations.')
    .literal('KNOWLEDGE', 3, '## Reference\nPandas is a powerful data manipulation library...');

  const result2 = builder2.execute();
  console.log(`Token count: ${result2.tokenCount}`);
  console.log(`Sections: ${result2.sections.length}`);
  console.log(`Context:\n${result2.text}\n`);

  // Example 3: Truncation - proportional
  console.log('=== Example 3: Proportional Truncation ===');
  const builder3 = new ContextQueryBuilder()
    .withBudget(100)  // Very small budget
    .setFormat(ContextOutputFormat.TOON)
    .setTruncation(TruncationStrategy.PROPORTIONAL);

  builder3
    .literal('SYSTEM', 0, 'You are a helpful assistant with expertise in programming and data analysis.')
    .literal('CONTEXT', 1, 'The user is working on a Python project involving data processing with pandas. They need help with DataFrame operations.')
    .literal('QUERY', 2, 'How do I filter rows in a DataFrame?');

  const result3 = builder3.execute();
  console.log(`Token count: ${result3.tokenCount}`);
  console.log(`Context:\n${result3.text}\n`);

  // Example 4: Truncation - tail drop (keep beginning)
  console.log('=== Example 4: Tail Drop Truncation ===');
  const builder4 = new ContextQueryBuilder()
    .withBudget(80)
    .setFormat(ContextOutputFormat.JSON)
    .setTruncation(TruncationStrategy.TAIL_DROP);

  builder4
    .literal('IMPORTANT', 0, 'This is critical information that must be preserved.')
    .literal('DETAILS', 1, 'Additional context and background information goes here.')
    .literal('EXTRA', 2, 'More supplementary information that can be dropped if needed.');

  const result4 = builder4.execute();
  console.log(`Token count: ${result4.tokenCount}`);
  console.log(`Sections kept: ${result4.sections.length}`);
  console.log(`Context:\n${result4.text}\n`);

  // Example 5: Truncation - head drop (keep end)
  console.log('=== Example 5: Head Drop Truncation ===');
  const builder5 = new ContextQueryBuilder()
    .withBudget(60)
    .setFormat(ContextOutputFormat.TOON)
    .setTruncation(TruncationStrategy.HEAD_DROP);

  builder5
    .literal('OLD', 0, 'This is old context from earlier in the conversation.')
    .literal('RECENT', 1, 'More recent information about the current topic.')
    .literal('CURRENT', 2, 'The most current and relevant information.');

  const result5 = builder5.execute();
  console.log(`Token count: ${result5.tokenCount}`);
  console.log(`Context:\n${result5.text}\n`);

  // Example 6: JSON format output
  console.log('=== Example 6: JSON Format ===');
  const builder6 = new ContextQueryBuilder()
    .withBudget(300)
    .setFormat(ContextOutputFormat.JSON);

  builder6
    .literal('system', 0, 'You are a helpful assistant.')
    .literal('user_message', 1, 'What is TypeScript?')
    .literal('context', 2, 'User is a beginner programmer learning web development.');

  const result6 = builder6.execute();
  console.log(`Token count: ${result6.tokenCount}`);
  console.log(`Context (JSON):`);
  const jsonData = JSON.parse(result6.text);
  console.log(JSON.stringify(jsonData, null, 2), '\n');

  // Example 7: Complex context for RAG pattern
  console.log('=== Example 7: RAG Pattern Context ===');
  const builder7 = new ContextQueryBuilder()
    .withBudget(800)
    .setFormat(ContextOutputFormat.MARKDOWN);

  builder7
    .literal('SYSTEM', 0, '# AI Assistant\nYou answer questions using the provided context.')
    .literal('QUERY', 1, '## User Query\nWhat are the benefits of using TypeScript?')
    .literal('DOC1', 2, '### Document 1: TypeScript Benefits\nTypeScript adds static typing to JavaScript, catching errors at compile time.')
    .literal('DOC2', 2, '### Document 2: Type Safety\nType safety reduces runtime errors and improves code maintainability.')
    .literal('DOC3', 2, '### Document 3: Developer Experience\nTypeScript provides better IDE support with autocomplete and refactoring.')
    .literal('INSTRUCTIONS', 3, '## Instructions\nSynthesize the information from the documents to answer the query.');

  const result7 = builder7.execute();
  console.log(`Token count: ${result7.tokenCount}`);
  console.log(`Sections: ${result7.sections.length}`);
  console.log(`Context preview (first 200 chars):`);
  console.log(result7.text.substring(0, 200) + '...\n');

  // Example 8: Demonstrate statistics
  console.log('=== Example 8: Context Statistics ===');
  const builder8 = new ContextQueryBuilder()
    .withBudget(1000)
    .setFormat(ContextOutputFormat.TOON);

  builder8
    .literal('A', 0, 'Priority 0 section')
    .literal('B', 1, 'Priority 1 section with more content here')
    .literal('C', 2, 'Priority 2 section with even more detailed content here')
    .literal('D', 3, 'Priority 3 section that is the lowest priority and might be truncated');

  const result8 = builder8.execute();
  console.log(`Total tokens: ${result8.tokenCount}`);
  console.log(`Total sections: ${result8.sections.length}`);
  console.log(`Sections:`);
  result8.sections.forEach(s => {
    console.log(`  - ${s.name}: ${s.tokenCount} tokens${s.truncated ? ' (truncated)' : ''}`);
  });
  console.log();
}

main().catch(console.error);
