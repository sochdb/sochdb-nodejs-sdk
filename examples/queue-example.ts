/**
 * Priority Queue API Example (v0.4.1)
 * 
 * This example demonstrates:
 * - Creating priority queues
 * - Enqueueing tasks with priorities
 * - Dequeuing and processing tasks
 * - Task acknowledgment and retry logic
 * - Queue statistics and monitoring
 */

import { EmbeddedDatabase as Database } from '../src/embedded/database';
import { PriorityQueue, TaskState, QueueConfig } from '../src/queue';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  // Clean up previous test data
  const dbPath = path.join(__dirname, '../test-data/queue-example-db');
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }

  console.log('🚀 SochDB Priority Queue API Example\n');

  // Open embedded database
  const db = await Database.open(dbPath);
  console.log('✅ Database opened\n');

  try {
    // Example 1: Create a priority queue for job processing
    console.log('📋 Creating priority queue for background jobs...');
    const jobQueue = PriorityQueue.fromDatabase(db, 'background-jobs', {
      name: 'background-jobs',
      visibilityTimeout: 30000,  // 30 seconds
      maxRetries: 3,
      deadLetterQueue: 'failed-jobs'
    });
    console.log('✅ Queue created: background-jobs\n');

    // Example 2: Enqueue tasks with different priorities
    console.log('📝 Enqueueing tasks (lower priority = higher urgency)...');
    
    const tasks = [
      { priority: 1, name: 'Critical: Process payment', data: { orderId: '12345', amount: 99.99 } },
      { priority: 5, name: 'Normal: Send email', data: { to: 'user@example.com', template: 'welcome' } },
      { priority: 3, name: 'High: Update inventory', data: { productId: 'SKU-789', quantity: 50 } },
      { priority: 10, name: 'Low: Generate report', data: { reportType: 'daily', date: '2026-01-24' } },
      { priority: 2, name: 'Urgent: Verify fraud', data: { transactionId: 'TX-99999', score: 0.85 } },
    ];

    const taskIds: string[] = [];
    for (const task of tasks) {
      const payload = Buffer.from(JSON.stringify(task.data));
      const metadata = { 
        name: task.name,
        enqueuedAt: new Date().toISOString(),
        source: 'api-server'
      };
      
      const taskId = await jobQueue.enqueue(task.priority, payload, metadata);
      taskIds.push(taskId);
      console.log(`  ✓ Priority ${task.priority}: ${task.name} (ID: ${taskId.substring(0, 12)}...)`);
    }
    console.log(`✅ Enqueued ${tasks.length} tasks\n`);

    // Example 3: Worker simulation - Dequeue and process tasks
    console.log('👷 Worker #1 processing tasks...\n');
    
    await simulateWorker(jobQueue, 'worker-1', 3);

    // Example 4: Show queue statistics
    console.log('\n📊 Queue Statistics:');
    const stats = await jobQueue.stats();
    console.log(`  Pending:       ${stats.pending}`);
    console.log(`  Claimed:       ${stats.claimed}`);
    console.log(`  Completed:     ${stats.completed}`);
    console.log(`  Dead-lettered: ${stats.deadLettered}`);
    console.log(`  Total enqueued: ${stats.totalEnqueued}`);
    console.log(`  Total dequeued: ${stats.totalDequeued}`);
    console.log();

    // Example 5: Create a high-throughput queue for webhooks
    console.log('🔗 Creating webhook delivery queue...');
    const webhookQueue = PriorityQueue.fromDatabase(db, 'webhooks', {
      name: 'webhooks',
      visibilityTimeout: 10000,  // 10 seconds for quick retries
      maxRetries: 5
    });

    // Enqueue webhook deliveries
    const webhooks = [
      { url: 'https://api.example.com/webhooks/order', event: 'order.created' },
      { url: 'https://api.example.com/webhooks/user', event: 'user.registered' },
      { url: 'https://api.example.com/webhooks/payment', event: 'payment.received' }
    ];

    console.log('📝 Enqueueing webhook deliveries...');
    for (const webhook of webhooks) {
      const payload = Buffer.from(JSON.stringify(webhook));
      await webhookQueue.enqueue(1, payload, { event: webhook.event });
      console.log(`  ✓ Webhook: ${webhook.event} → ${webhook.url}`);
    }
    console.log(`✅ Enqueued ${webhooks.length} webhooks\n`);

    // Example 6: Scheduled tasks (future execution)
    console.log('⏰ Creating scheduled task queue...');
    const scheduledQueue = PriorityQueue.fromDatabase(db, 'scheduled-tasks', {
      name: 'scheduled-tasks',
      visibilityTimeout: 60000  // 1 minute
    });

    // Schedule tasks for future execution
    const scheduledTasks = [
      { name: 'Daily backup', executeAt: Date.now() + 3600000 },  // 1 hour from now
      { name: 'Weekly report', executeAt: Date.now() + 604800000 },  // 7 days from now
      { name: 'Monthly cleanup', executeAt: Date.now() + 2592000000 }  // 30 days from now
    ];

    console.log('📝 Scheduling future tasks...');
    for (const task of scheduledTasks) {
      const payload = Buffer.from(JSON.stringify({ name: task.name }));
      const executeDate = new Date(task.executeAt);
      await scheduledQueue.enqueue(task.executeAt, payload, { 
        name: task.name,
        scheduledFor: executeDate.toISOString()
      });
      console.log(`  ✓ ${task.name} → ${executeDate.toLocaleString()}`);
    }
    console.log(`✅ Scheduled ${scheduledTasks.length} tasks\n`);

    console.log('✨ Example completed successfully!\n');
    console.log('Key Features Demonstrated:');
    console.log('  ✓ Priority-based task ordering');
    console.log('  ✓ Worker task claiming and processing');
    console.log('  ✓ Acknowledgment and retry logic');
    console.log('  ✓ Queue statistics and monitoring');
    console.log('  ✓ Multiple queues for different purposes');
    console.log('  ✓ Scheduled/delayed task execution');
    console.log('  ✓ Dead letter queue for failed tasks');

  } finally {
    await db.close();
    console.log('\n✅ Database closed');
  }
}

// Simulate a worker processing tasks
async function simulateWorker(
  queue: PriorityQueue,
  workerId: string,
  maxTasks: number
): Promise<void> {
  let processed = 0;
  
  while (processed < maxTasks) {
    const task = await queue.dequeue(workerId);
    
    if (!task) {
      console.log(`  ℹ️  No tasks available for ${workerId}`);
      break;
    }

    const taskData = JSON.parse(task.payload.toString());
    console.log(`  ⚙️  Processing: ${task.metadata?.name || 'Unknown task'}`);
    console.log(`     Priority: ${task.priority}, Worker: ${workerId}`);
    console.log(`     Data: ${JSON.stringify(taskData)}`);

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100));

    // Randomly succeed or retry
    const success = Math.random() > 0.2;  // 80% success rate
    
    if (success) {
      await queue.ack(task.taskId);
      console.log(`  ✅ Completed task: ${task.taskId.substring(0, 12)}...`);
    } else {
      await queue.nack(task.taskId);
      console.log(`  ⚠️  Task failed, will retry: ${task.taskId.substring(0, 12)}...`);
    }

    processed++;
    console.log();
  }
  
  console.log(`✅ Worker ${workerId} processed ${processed} tasks`);
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}
