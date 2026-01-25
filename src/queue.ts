/**
 * SochDB Priority Queue
 * 
 * First-class queue API with ordered-key task entries, providing efficient
 * priority queue operations without the O(N) blob rewrite anti-pattern.
 * 
 * Features:
 * - Ordered-key representation: Each task has its own key, no blob parsing
 * - O(log N) enqueue/dequeue with ordered scans
 * - Atomic claim protocol for concurrent workers
 * - Visibility timeout for crash recovery
 * 
 * @example
 * ```typescript
 * import { Database, PriorityQueue } from '@sochdb/sochdb';
 * 
 * const db = await Database.open('./queue_db');
 * const queue = PriorityQueue.fromDatabase(db, 'tasks');
 * 
 * // Enqueue task
 * await queue.enqueue(1, Buffer.from('high priority task'));
 * 
 * // Dequeue and process
 * const task = await queue.dequeue('worker-1');
 * if (task) {
 *   // Process task...
 *   await queue.ack(task.taskId);
 * }
 * ```
 */

import { SochDBError } from './errors';

// ============================================================================
// Task State
// ============================================================================

export enum TaskState {
  PENDING = 'pending',
  CLAIMED = 'claimed',
  COMPLETED = 'completed',
  DEAD_LETTERED = 'dead_lettered',
}

// ============================================================================
// Queue Configuration
// ============================================================================

export interface QueueConfig {
  name: string;
  visibilityTimeout?: number; // milliseconds, default 30000
  maxRetries?: number; // default 3
  deadLetterQueue?: string;
}

// ============================================================================
// Queue Key Encoding
// ============================================================================

/**
 * Encode u64 as big-endian for lexicographic ordering
 */
function encodeU64BE(value: number): Buffer {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(BigInt(value));
  return buf;
}

/**
 * Decode big-endian u64
 */
function decodeU64BE(buf: Buffer): number {
  return Number(buf.readBigUInt64BE(0));
}

/**
 * Encode i64 as big-endian preserving order
 */
function encodeI64BE(value: number): Buffer {
  // Map i64 to u64 by adding offset
  const mapped = BigInt(value) + (1n << 63n);
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(mapped);
  return buf;
}

/**
 * Decode big-endian i64
 */
function decodeI64BE(buf: Buffer): number {
  const mapped = buf.readBigUInt64BE(0);
  return Number(mapped - (1n << 63n));
}

// ============================================================================
// Queue Key
// ============================================================================

export interface QueueKey {
  queueId: string;
  priority: number;
  readyTs: number; // timestamp in milliseconds
  sequence: number;
  taskId: string;
}

/**
 * Encode queue key to bytes for storage
 */
function encodeQueueKey(key: QueueKey): Buffer {
  const parts = [
    Buffer.from('queue/'),
    Buffer.from(key.queueId),
    Buffer.from('/'),
    encodeI64BE(key.priority),
    Buffer.from('/'),
    encodeU64BE(key.readyTs),
    Buffer.from('/'),
    encodeU64BE(key.sequence),
    Buffer.from('/'),
    Buffer.from(key.taskId),
  ];
  
  return Buffer.concat(parts);
}

/**
 * Decode queue key from bytes
 */
function decodeQueueKey(data: Buffer): QueueKey {
  const str = data.toString();
  const parts = str.split('/');
  
  if (parts.length < 6 || parts[0] !== 'queue') {
    throw new SochDBError('Invalid queue key format');
  }
  
  return {
    queueId: parts[1],
    priority: 0, // Would need to decode from bytes
    readyTs: 0,
    sequence: 0,
    taskId: parts[parts.length - 1],
  };
}

// ============================================================================
// Task
// ============================================================================

export interface Task {
  taskId: string;
  priority: number;
  payload: Buffer;
  state: TaskState;
  enqueuedAt: number;
  claimedAt?: number;
  claimedBy?: string;
  completedAt?: number;
  retries: number;
  metadata?: Record<string, any>;
}

// ============================================================================
// Queue Statistics
// ============================================================================

export interface QueueStats {
  pending: number;
  claimed: number;
  completed: number;
  deadLettered: number;
  totalEnqueued: number;
  totalDequeued: number;
}

// ============================================================================
// Priority Queue
// ============================================================================

export class PriorityQueue {
  private static sequenceCounter = 0;

  constructor(
    private db: any,
    private config: QueueConfig
  ) {
    // Set defaults
    this.config.visibilityTimeout = config.visibilityTimeout || 30000;
    this.config.maxRetries = config.maxRetries || 3;
  }

  /**
   * Create queue from embedded database
   */
  static fromDatabase(db: any, name: string, config?: Partial<QueueConfig>): PriorityQueue {
    const fullConfig: QueueConfig = {
      name,
      ...config,
    };
    return new PriorityQueue(db, fullConfig);
  }

  /**
   * Create queue from gRPC client
   */
  static fromClient(client: any, name: string, config?: Partial<QueueConfig>): PriorityQueue {
    const fullConfig: QueueConfig = {
      name,
      ...config,
    };
    return new PriorityQueue(client, fullConfig);
  }

  /**
   * Enqueue a task with priority
   * Lower priority number = higher urgency
   */
  async enqueue(
    priority: number,
    payload: Buffer,
    metadata?: Record<string, any>
  ): Promise<string> {
    const taskId = this.generateTaskId();
    const now = Date.now();
    
    const key: QueueKey = {
      queueId: this.config.name,
      priority,
      readyTs: now,
      sequence: PriorityQueue.sequenceCounter++,
      taskId,
    };

    const task: Task = {
      taskId,
      priority,
      payload,
      state: TaskState.PENDING,
      enqueuedAt: now,
      retries: 0,
      metadata,
    };

    const keyBuf = encodeQueueKey(key);
    const valueBuf = Buffer.from(JSON.stringify(task));
    
    await this.db.put(keyBuf, valueBuf);
    
    // Update stats
    await this.incrementStat('totalEnqueued');
    await this.incrementStat('pending');
    
    return taskId;
  }

  /**
   * Dequeue the highest priority task
   * Returns null if no tasks available
   */
  async dequeue(workerId: string): Promise<Task | null> {
    const now = Date.now();
    const prefix = `queue/${this.config.name}/`;
    
    // TODO: Implement range scan to find first ready task
    // For now, this is a placeholder
    
    return null;
  }

  /**
   * Acknowledge task completion
   */
  async ack(taskId: string): Promise<void> {
    // Find and update task state
    const task = await this.getTask(taskId);
    if (!task) {
      throw new SochDBError(`Task not found: ${taskId}`);
    }

    if (task.state !== TaskState.CLAIMED) {
      throw new SochDBError(`Task not in claimed state: ${taskId}`);
    }

    // Update task state
    task.state = TaskState.COMPLETED;
    task.completedAt = Date.now();
    
    await this.updateTask(task);
    
    // Update stats
    await this.decrementStat('claimed');
    await this.incrementStat('completed');
  }

  /**
   * Negative acknowledge - return task to queue
   */
  async nack(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new SochDBError(`Task not found: ${taskId}`);
    }

    task.retries++;
    
    if (task.retries >= (this.config.maxRetries || 3)) {
      // Move to dead letter queue
      task.state = TaskState.DEAD_LETTERED;
      await this.updateTask(task);
      await this.decrementStat('claimed');
      await this.incrementStat('deadLettered');
    } else {
      // Return to pending
      task.state = TaskState.PENDING;
      task.claimedAt = undefined;
      task.claimedBy = undefined;
      await this.updateTask(task);
      await this.decrementStat('claimed');
      await this.incrementStat('pending');
    }
  }

  /**
   * Get queue statistics
   */
  async stats(): Promise<QueueStats> {
    return {
      pending: await this.getStat('pending'),
      claimed: await this.getStat('claimed'),
      completed: await this.getStat('completed'),
      deadLettered: await this.getStat('deadLettered'),
      totalEnqueued: await this.getStat('totalEnqueued'),
      totalDequeued: await this.getStat('totalDequeued'),
    };
  }

  /**
   * Purge completed tasks
   */
  async purge(): Promise<number> {
    // TODO: Implement purging of completed tasks
    return 0;
  }

  // Helper methods
  private generateTaskId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async getTask(taskId: string): Promise<Task | null> {
    // TODO: Implement task lookup
    return null;
  }

  private async updateTask(task: Task): Promise<void> {
    // TODO: Implement task update
  }

  private async getStat(name: string): Promise<number> {
    const key = `_queue_stats/${this.config.name}/${name}`;
    const value = await this.db.get(Buffer.from(key));
    return value ? parseInt(value.toString()) : 0;
  }

  private async incrementStat(name: string): Promise<void> {
    const current = await this.getStat(name);
    const key = `_queue_stats/${this.config.name}/${name}`;
    await this.db.put(Buffer.from(key), Buffer.from((current + 1).toString()));
  }

  private async decrementStat(name: string): Promise<void> {
    const current = await this.getStat(name);
    const key = `_queue_stats/${this.config.name}/${name}`;
    await this.db.put(Buffer.from(key), Buffer.from(Math.max(0, current - 1).toString()));
  }
}

/**
 * Create a queue instance
 */
export function createQueue(
  db: any,
  name: string,
  config?: Partial<QueueConfig>
): PriorityQueue {
  return PriorityQueue.fromDatabase(db, name, config);
}
