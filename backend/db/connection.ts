import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import * as path from 'path';
import * as fs from 'fs';

// ─────────────────────────────────────────────
// DuckDB singleton
// Single persistent connection per process
// ─────────────────────────────────────────────

const DB_PATH = path.resolve(process.env.DB_PATH ?? './data/forensics.duckdb');

let _instancePromise: Promise<DuckDBInstance> | null = null;
let _connPromise: Promise<DuckDBConnection> | null = null;

export function getDb(): Promise<DuckDBInstance> {
  if (!_instancePromise) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    _instancePromise = DuckDBInstance.create(DB_PATH);
  }
  return _instancePromise;
}

export function getConnection(): Promise<DuckDBConnection> {
  if (!_connPromise) {
    _connPromise = getDb().then((db) => db.connect());
  }
  return _connPromise;
}

/**
 * Run a query and return all rows as plain objects.
 * Wraps the callback-based DuckDB API in a Promise.
 */
export function query<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  return getConnection().then(async (conn) => {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRows() as T[];
  });
}

/**
 * Run a statement that returns no rows (CREATE, INSERT, etc.)
 */
export function execute(sql: string): Promise<void> {
  return getConnection().then(async (conn) => {
    await conn.run(sql);
  });
}

export async function closeDb(): Promise<void> {
  try {
    if (_connPromise) {
      const conn = await _connPromise;
      conn.closeSync();
    }
  } finally {
    _connPromise = null;
    _instancePromise = null;
  }
}
