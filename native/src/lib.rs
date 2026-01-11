#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use toondb_storage as storage;

#[napi]
pub struct Database {
    inner: storage::Database,
}

#[napi]
impl Database {
    #[napi(factory)]
    pub fn open(path: String) -> Result<Self> {
        let inner = storage::Database::open(&path)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Self { inner })
    }
    
    #[napi]
    pub fn put(&self, key: Buffer, value: Buffer) -> Result<()> {
        self.inner.put(&key, &value)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn get(&self, key: Buffer) -> Result<Option<Buffer>> {
        let result = self.inner.get(&key)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(result.map(|v| v.into()))
    }
    
    #[napi]
    pub fn delete(&self, key: Buffer) -> Result<()> {
        self.inner.delete(&key)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn put_path(&self, path: String, value: Buffer) -> Result<()> {
        self.inner.put_path(&path, &value)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn get_path(&self, path: String) -> Result<Option<Buffer>> {
        let result = self.inner.get_path(&path)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(result.map(|v| v.into()))
    }
    
    #[napi]
    pub fn delete_path(&self, path: String) -> Result<()> {
        self.inner.delete_path(&path)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn begin_transaction(&self) -> Result<Transaction> {
        let txn = self.inner.begin_txn()
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Transaction { inner: Some(txn) })
    }
    
    #[napi]
    pub fn checkpoint(&self) -> Result<i64> {
        self.inner.checkpoint()
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn stats(&self) -> Result<Stats> {
        let stats = self.inner.stats()
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Stats {
            memtable_size_bytes: stats.memtable_size_bytes as i64,
            wal_size_bytes: stats.wal_size_bytes as i64,
            active_transactions: stats.active_transactions as i32,
            min_active_snapshot: stats.min_active_snapshot as i64,
            last_checkpoint_lsn: stats.last_checkpoint_lsn as i64,
        })
    }
    
    #[napi]
    pub fn close(&mut self) {
        // Rust Drop handles cleanup
    }
}

#[napi(object)]
pub struct Stats {
    pub memtable_size_bytes: i64,
    pub wal_size_bytes: i64,
    pub active_transactions: i32,
    pub min_active_snapshot: i64,
    pub last_checkpoint_lsn: i64,
}

#[napi]
pub struct Transaction {
    inner: Option<storage::Transaction>,
}

#[napi]
impl Transaction {
    #[napi]
    pub fn put(&mut self, key: Buffer, value: Buffer) -> Result<()> {
        self.inner.as_mut()
            .ok_or_else(|| Error::from_reason("Transaction already committed or aborted"))?
            .put(&key, &value)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn get(&self, key: Buffer) -> Result<Option<Buffer>> {
        let txn = self.inner.as_ref()
            .ok_or_else(|| Error::from_reason("Transaction already committed or aborted"))?;
        let result = txn.get(&key)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(result.map(|v| v.into()))
    }
    
    #[napi]
    pub fn delete(&mut self, key: Buffer) -> Result<()> {
        self.inner.as_mut()
            .ok_or_else(|| Error::from_reason("Transaction already committed or aborted"))?
            .delete(&key)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn put_path(&mut self, path: String, value: Buffer) -> Result<()> {
        self.inner.as_mut()
            .ok_or_else(|| Error::from_reason("Transaction already committed or aborted"))?
            .put_path(&path, &value)
            .map_err(|e| Error::from_reason(e.to_string()))
    }
    
    #[napi]
    pub fn get_path(&self, path: String) -> Result<Option<Buffer>> {
        let txn = self.inner.as_ref()
            .ok_or_else(|| Error::from_reason("Transaction already committed or aborted"))?;
        let result = txn.get_path(&path)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(result.map(|v| v.into()))
    }
    
    #[napi]
    pub fn commit(&mut self) -> Result<()> {
        let txn = self.inner.take()
            .ok_or_else(|| Error::from_reason("Transaction already committed or aborted"))?;
        txn.commit()
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(())
    }
    
    #[napi]
    pub fn abort(&mut self) {
        if let Some(txn) = self.inner.take() {
            txn.abort();
        }
    }
}
