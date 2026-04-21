import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { LogFileInfo } from '../shared/types';
import { parquetExistsFor } from './converter';

// ─────────────────────────────────────────────
// File Scanner
// Discovers .log files on local disk / NAS
// ─────────────────────────────────────────────

/**
 * Scan a directory (recursively) for IIS .log files.
 * Returns metadata for each file including ingestion status.
 */
export async function scanDirectory(dirPath: string): Promise<LogFileInfo[]> {
  const absDir = path.resolve(dirPath);

  if (!fs.existsSync(absDir)) {
    throw new Error(`Directory not found: ${absDir}`);
  }

  const pattern = path.join(absDir, '**', '*.log').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  const results: LogFileInfo[] = files.map(filePath => {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    return {
      name,
      path: filePath,
      size_bytes: stat.size,
      size_mb: Math.round((stat.size / 1024 / 1024) * 100) / 100,
      modified_at: stat.mtime.toISOString(),
      ingested: parquetExistsFor(name),
    };
  });

  // Sort by modified date descending (newest first)
  results.sort((a, b) => b.modified_at.localeCompare(a.modified_at));

  return results;
}

/**
 * Validate that a list of file paths are accessible .log files.
 * Returns { valid, invalid } lists.
 */
export function validateFilePaths(filePaths: string[]): {
  valid: string[];
  invalid: Array<{ path: string; reason: string }>;
} {
  const valid: string[] = [];
  const invalid: Array<{ path: string; reason: string }> = [];

  for (const filePath of filePaths) {
    if (!filePath.toLowerCase().endsWith('.log')) {
      invalid.push({ path: filePath, reason: 'Not a .log file' });
      continue;
    }
    if (!fs.existsSync(filePath)) {
      invalid.push({ path: filePath, reason: 'File not found' });
      continue;
    }
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      valid.push(filePath);
    } catch {
      invalid.push({ path: filePath, reason: 'File not readable' });
    }
  }

  return { valid, invalid };
}
