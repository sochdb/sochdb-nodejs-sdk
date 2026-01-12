import { Database } from '../src/index';
import * as fs from 'fs';
import * as path from 'path';

describe('Embedded Database (FFI)', () => {
    const dbPath = path.join(__dirname, 'test_embedded_db_jest');

    // Cleanup helper
    const cleanup = () => {
        if (fs.existsSync(dbPath)) {
            fs.rmSync(dbPath, { recursive: true, force: true });
        }
    };

    beforeEach(() => {
        cleanup();
    });

    afterEach(() => {
        cleanup();
    });

    test('should perform basic KV operations', async () => {
        const db = Database.open(dbPath);

        await db.put(Buffer.from('test_key'), Buffer.from('test_value'));
        const value = await db.get(Buffer.from('test_key'));

        expect(value?.toString()).toBe('test_value');

        db.close();
    });

    test('should perform path operations', async () => {
        const db = Database.open(dbPath);

        await db.putPath('users/alice', Buffer.from('Alice'));
        const alice = await db.getPath('users/alice');

        expect(alice?.toString()).toBe('Alice');

        db.close();
    });

    test('should support ACID transactions', async () => {
        const db = Database.open(dbPath);

        await db.withTransaction(async (txn) => {
            await txn.put(Buffer.from('txn_key1'), Buffer.from('value1'));
            await txn.put(Buffer.from('txn_key2'), Buffer.from('value2'));
        });

        const val1 = await db.get(Buffer.from('txn_key1'));
        expect(val1?.toString()).toBe('value1');

        db.close();
    });

    test('should modify data via manual transaction commit', async () => {
        const db = Database.open(dbPath);
        const txn = db.transaction();

        await txn.put(Buffer.from('manual_txn'), Buffer.from('manual_val'));
        await txn.commit();

        const val = await db.get(Buffer.from('manual_txn'));
        expect(val?.toString()).toBe('manual_val');

        db.close();
    });

    test('should support scan operations', async () => {
        const db = Database.open(dbPath);

        await db.put(Buffer.from('scan_1'), Buffer.from('val1'));
        await db.put(Buffer.from('scan_2'), Buffer.from('val2'));
        await db.put(Buffer.from('scan_3'), Buffer.from('val3'));

        let count = 0;
        const keys: string[] = [];

        for await (const [key, value] of db.scanPrefix(Buffer.from('scan_'))) {
            count++;
            keys.push(key.toString());
        }

        expect(count).toBe(3);
        expect(keys).toContain('scan_1');
        expect(keys).toContain('scan_2');
        expect(keys).toContain('scan_3');

        db.close();
    });

    test('should retrieve stats', async () => {
        const db = Database.open(dbPath);
        const stats = await db.stats();

        expect(stats).toBeDefined();
        expect(typeof stats.activeTransactions).toBe('number');
        expect(typeof stats.memtableSizeBytes).toBe('bigint');

        db.close();
    });

    test('should perform checkpoint', async () => {
        const db = Database.open(dbPath);
        const lsn = await db.checkpoint();

        expect(typeof lsn).toBe('bigint');

        db.close();
    });
});
