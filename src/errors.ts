/**
 * SochDB Error Classes
 *
 * @packageDocumentation
 */

// Copyright 2025 Sushanth (https://github.com/sushanthpy)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0

/**
 * Error codes matching Rust error codes.
 */
export enum ErrorCode {
  // Connection errors (1xxx)
  CONNECTION_FAILED = 1001,
  CONNECTION_TIMEOUT = 1002,
  CONNECTION_CLOSED = 1003,
  PROTOCOL_ERROR = 1004,
  
  // Transaction errors (2xxx)
  TRANSACTION_ABORTED = 2001,
  TRANSACTION_CONFLICT = 2002,
  
  // Internal errors (9xxx)
  INTERNAL_ERROR = 9001,
  STORAGE_ERROR = 9003,
  
  // Lock/Concurrency errors (10xxx) - v0.4.1
  DATABASE_LOCKED = 10001,
  LOCK_TIMEOUT = 10002,
  EPOCH_MISMATCH = 10003,
  SPLIT_BRAIN = 10004,
  STALE_LOCK = 10005,
}

/**
 * Base error class for all SochDB errors.
 */
export class SochDBError extends Error {
  public readonly code: ErrorCode;
  public readonly remediation?: string;
  
  constructor(message: string, code: ErrorCode = ErrorCode.INTERNAL_ERROR, remediation?: string) {
    super(message);
    this.name = 'SochDBError';
    this.code = code;
    this.remediation = remediation;
    Object.setPrototypeOf(this, SochDBError.prototype);
  }
}

/**
 * Error thrown when connection to the database fails.
 */
export class ConnectionError extends SochDBError {
  constructor(message: string) {
    super(message, ErrorCode.CONNECTION_FAILED);
    this.name = 'ConnectionError';
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Error thrown when a transaction operation fails.
 */
export class TransactionError extends SochDBError {
  constructor(message: string) {
    super(message, ErrorCode.TRANSACTION_ABORTED);
    this.name = 'TransactionError';
    Object.setPrototypeOf(this, TransactionError.prototype);
  }
}

/**
 * Error thrown when there's a protocol error in IPC communication.
 */
export class ProtocolError extends SochDBError {
  constructor(message: string) {
    super(message, ErrorCode.PROTOCOL_ERROR);
    this.name = 'ProtocolError';
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}

/**
 * Error thrown when a database operation fails.
 */
export class DatabaseError extends SochDBError {
  constructor(message: string) {
    super(message, ErrorCode.STORAGE_ERROR);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

// ============================================================================
// Lock/Concurrency Errors (v0.4.1)
// ============================================================================

/**
 * Base class for lock-related errors.
 */
export class LockError extends SochDBError {
  constructor(message: string, code: ErrorCode = ErrorCode.DATABASE_LOCKED, remediation?: string) {
    super(message, code, remediation);
    this.name = 'LockError';
    Object.setPrototypeOf(this, LockError.prototype);
  }
}

/**
 * Error thrown when database is locked by another process.
 */
export class DatabaseLockedError extends LockError {
  public readonly path: string;
  public readonly holderPid?: number;
  
  constructor(path: string, holderPid?: number) {
    const msg = holderPid 
      ? `Database at '${path}' is locked by process ${holderPid}`
      : `Database at '${path}' is locked`;
    super(msg, ErrorCode.DATABASE_LOCKED, 'Close the other process or wait for the lock to be released');
    this.name = 'DatabaseLockedError';
    this.path = path;
    this.holderPid = holderPid;
    Object.setPrototypeOf(this, DatabaseLockedError.prototype);
  }
}

/**
 * Error thrown when timed out waiting for database lock.
 */
export class LockTimeoutError extends LockError {
  public readonly path: string;
  public readonly timeoutSecs: number;
  
  constructor(path: string, timeoutSecs: number) {
    super(
      `Timed out after ${timeoutSecs}s waiting for lock on '${path}'`,
      ErrorCode.LOCK_TIMEOUT,
      'Increase timeout or check for deadlocks'
    );
    this.name = 'LockTimeoutError';
    this.path = path;
    this.timeoutSecs = timeoutSecs;
    Object.setPrototypeOf(this, LockTimeoutError.prototype);
  }
}

/**
 * Error thrown when WAL epoch mismatch detected (stale writer).
 */
export class EpochMismatchError extends LockError {
  public readonly expected: number;
  public readonly actual: number;
  
  constructor(expected: number, actual: number) {
    super(
      `Epoch mismatch: expected ${expected}, found ${actual}`,
      ErrorCode.EPOCH_MISMATCH,
      'Another writer has taken over. Re-open the database.'
    );
    this.name = 'EpochMismatchError';
    this.expected = expected;
    this.actual = actual;
    Object.setPrototypeOf(this, EpochMismatchError.prototype);
  }
}

/**
 * Error thrown when split-brain condition detected (multiple writers).
 */
export class SplitBrainError extends LockError {
  constructor(message: string = 'Split-brain detected: multiple active writers') {
    super(
      message,
      ErrorCode.SPLIT_BRAIN,
      'Stop all writers, verify data integrity, then restart with single writer'
    );
    this.name = 'SplitBrainError';
    Object.setPrototypeOf(this, SplitBrainError.prototype);
  }
}
