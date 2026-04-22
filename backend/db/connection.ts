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

export function createConnection(): Promise<DuckDBConnection> {
  return getDb().then((db) => db.connect());
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
    const rows = reader.getRowObjectsJS() as unknown[];
    return rows.map((row) => makeJsonSafe(row)) as T[];
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

function makeJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const abs = value < 0n ? -value : value;
    if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => makeJsonSafe(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(obj)) {
      out[key] = makeJsonSafe(item);
    }
    return out;
  }

  return value;
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
