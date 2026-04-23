import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export type SessionMeta = {
  id: string;
  name: string;
  created_at: string;
  last_ingest_at: string | null;
  last_ingest_files: number;
  last_ingest_rows: number;
};

const SESSIONS_DIR = path.resolve(process.env.SESSIONS_DIR ?? './data/sessions');

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function getSessionsDir(): string {
  ensureDir(SESSIONS_DIR);
  return SESSIONS_DIR;
}

export function getSessionDir(sessionId: string): string {
  const dir = path.join(getSessionsDir(), sessionId);
  ensureDir(dir);
  return dir;
}

export function getSessionParquetDir(sessionId: string): string {
  const dir = path.join(getSessionDir(sessionId), 'parquet');
  ensureDir(dir);
  return dir;
}

export function getSessionDbPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'forensics.duckdb');
}

export function getSessionMetaPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'meta.json');
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function loadSessionMeta(sessionId: string): SessionMeta | null {
  return readJsonFile<SessionMeta>(getSessionMetaPath(sessionId));
}

export function saveSessionMeta(meta: SessionMeta): void {
  writeJsonFileAtomic(getSessionMetaPath(meta.id), meta);
}

export function listSessions(): SessionMeta[] {
  const sessionsDir = getSessionsDir();
  const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const out: SessionMeta[] = [];
  for (const id of dirs) {
    const meta = loadSessionMeta(id);
    if (meta) out.push(meta);
  }

  // Most-recent first
  out.sort((a, b) => {
    const at = a.last_ingest_at ?? a.created_at;
    const bt = b.last_ingest_at ?? b.created_at;
    return bt.localeCompare(at);
  });
  return out;
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function ensureDefaultSession(): SessionMeta {
  const existing = listSessions().find((s) => s.name.toLowerCase() === 'default');
  if (existing) return existing;
  return createSession('Default');
}

export function createSession(requestedName: string): SessionMeta {
  const baseName = normalizeName(requestedName || 'Untitled Session');

  const existingNames = new Set(listSessions().map((s) => s.name.toLowerCase()));
  let name = baseName;
  if (existingNames.has(name.toLowerCase())) {
    let suffix = 2;
    while (existingNames.has(`${baseName} (${suffix})`.toLowerCase())) suffix++;
    name = `${baseName} (${suffix})`;
  }

  const id = `${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
  const meta: SessionMeta = {
    id,
    name,
    created_at: new Date().toISOString(),
    last_ingest_at: null,
    last_ingest_files: 0,
    last_ingest_rows: 0,
  };

  // Ensure folder structure exists up front
  getSessionParquetDir(id);
  saveSessionMeta(meta);
  return meta;
}

export function touchIngestMeta(sessionId: string, files: number, rows: number): void {
  const meta = loadSessionMeta(sessionId);
  if (!meta) return;
  meta.last_ingest_at = new Date().toISOString();
  meta.last_ingest_files = files;
  meta.last_ingest_rows = rows;
  saveSessionMeta(meta);
}

export function getSessionSummary(sessionId: string): {
  meta: SessionMeta | null;
  parquet_files: number;
} {
  const meta = loadSessionMeta(sessionId);
  const parquetDir = getSessionParquetDir(sessionId);
  const parquet_files = fs.readdirSync(parquetDir).filter((f) => f.endsWith('.parquet')).length;
  return { meta, parquet_files };
}

