import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import * as fs from 'fs';
import * as path from 'path';
import { getSessionDbPath } from '../sessions/store';

type CachedConn = {
  at: number;
  dbPath: string;
  instance: DuckDBInstance;
  conn: DuckDBConnection;
};

const MAX_OPEN = Math.max(1, Number(process.env.SESSION_DB_MAX_OPEN ?? 2));
const IDLE_CLOSE_MS = Math.max(5_000, Number(process.env.SESSION_DB_IDLE_CLOSE_MS ?? 60_000));

const cache = new Map<string, CachedConn>();

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

async function evictIfNeeded(): Promise<void> {
  // Close idle first
  const now = Date.now();
  for (const [sessionId, entry] of cache.entries()) {
    if (now - entry.at > IDLE_CLOSE_MS) {
      try {
        entry.conn.closeSync();
        entry.instance.closeSync();
      } catch {
        // ignore
      }
      cache.delete(sessionId);
    }
  }

  if (cache.size <= MAX_OPEN) return;

  // LRU eviction
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at);
  while (cache.size > MAX_OPEN && entries.length > 0) {
    const [sessionId, entry] = entries.shift()!;
    try {
      entry.conn.closeSync();
      entry.instance.closeSync();
    } catch {
      // ignore
    }
    cache.delete(sessionId);
  }
}

export async function getSessionConnection(sessionId: string): Promise<DuckDBConnection> {
  await evictIfNeeded();
  const existing = cache.get(sessionId);
  if (existing) {
    existing.at = Date.now();
    return existing.conn;
  }

  const dbPath = getSessionDbPath(sessionId);
  ensureDir(path.dirname(dbPath));
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();

  cache.set(sessionId, { at: Date.now(), dbPath, instance, conn });
  await evictIfNeeded();
  return conn;
}

export function closeAllSessionDbs(): void {
  for (const entry of cache.values()) {
    try {
      entry.conn.closeSync();
      entry.instance.closeSync();
    } catch {
      // ignore
    }
  }
  cache.clear();
}

function makeJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const abs = value < 0n ? -value : value;
    if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    return value.toString();
  }
  if (Array.isArray(value)) return value.map((v) => makeJsonSafe(v));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = makeJsonSafe(v);
    return out;
  }
  return value;
}

export async function sessionQuery<T = Record<string, unknown>>(
  sessionId: string,
  sql: string
): Promise<T[]> {
  const conn = await getSessionConnection(sessionId);
  const reader = await conn.runAndReadAll(sql);
  const rows = reader.getRowObjectsJS() as unknown[];
  return rows.map((row) => makeJsonSafe(row)) as T[];
}

export async function sessionExecute(sessionId: string, sql: string): Promise<void> {
  const conn = await getSessionConnection(sessionId);
  await conn.run(sql);
}

