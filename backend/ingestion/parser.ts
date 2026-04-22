import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import { LogRow } from '../shared/types';

// ─────────────────────────────────────────────
// IIS W3C Log Parser
// Handles variable #Fields: headers across files
// ─────────────────────────────────────────────

/** Maps raw IIS field names to our normalized schema keys */
const FIELD_MAP: Record<string, keyof LogRow | null> = {
  'date':            'date',
  'time':            'time',
  's-ip':            's_ip',
  'cs-method':       'method',
  'cs-uri-stem':     'uri_stem',
  'cs-uri-query':    'uri_query',
  's-port':          'port',
  'cs-username':     'username',
  'c-ip':            'c_ip',
  'cs(user-agent)':  'user_agent',
  'cs(referer)':     'referer',
  'sc-status':       'status',
  'sc-substatus':    'substatus',
  'sc-win32-status': 'win32_status',
  'time-taken':      'time_taken_ms',
};

const NUMBER_FIELDS = new Set<keyof LogRow>([
  'port', 'status', 'substatus', 'win32_status', 'time_taken_ms'
]);

const NULLABLE_FIELDS = new Set<keyof LogRow>([
  'uri_query', 'username', 'user_agent', 'referer'
]);

export interface ParseResult {
  rows: LogRow[];
  field_count: number;
  line_count: number;
  error_count: number;
  errors: string[];
}

/**
 * Parse a single IIS .log file into normalized LogRow array.
 * Streams line-by-line so large files never fully load into memory.
 * Optimized for speed: fast string splitting, minimal allocations.
 */
export async function parseLogFile(
  filePath: string,
  onProgress?: (progress: { linesRead: number; bytesRead: number; totalBytes: number }) => void
): Promise<ParseResult> {
  const sourceName = path.basename(filePath);
  const rows: LogRow[] = [];
  const errors: string[] = [];
  let fieldNames: (keyof LogRow | null)[] = [];
  let fieldCount = 0;
  let lineCount = 0;
  let errorCount = 0;
  let bytesRead = 0;
  const totalBytes = fs.statSync(filePath).size;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  fileStream.on('data', (chunk: string | Buffer) => {
    bytesRead += Buffer.byteLength(chunk);
    if (onProgress) {
      onProgress({ linesRead: lineCount, bytesRead, totalBytes });
    }
  });

  for await (const line of rl) {
    lineCount++;

    if (onProgress && lineCount % 100_000 === 0) {
      onProgress({ linesRead: lineCount, bytesRead, totalBytes });
    }

    // Fast path: skip blank lines without .trim()
    if (line.length === 0 || line[0] === ' ' || line[0] === '\t') {
      if (line.trim().length === 0) continue;
    }

    // Parse #Fields directive — this can appear multiple times in one file
    if (line[0] === '#') {
      if (line.startsWith('#Fields:')) {
        // Fast field parsing without regex
        const fieldsStr = line.slice(8).trim().toLowerCase();
        const rawFields = fieldsStr.split(/\s+/);
        fieldNames = rawFields.map(f => FIELD_MAP[f] ?? null);
        fieldCount = fieldNames.length;
        continue;
      }
      // Skip other comment lines
      continue;
    }

    // No fields header seen yet — skip data lines
    if (fieldCount === 0) continue;

    // Fast space-based split (IIS format uses space delimiter)
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i <= line.length; i++) {
      if (i === line.length || line[i] === ' ') {
        if (i > start) {
          parts.push(line.slice(start, i));
        }
        start = i + 1;
      }
    }

    if (parts.length !== fieldCount) {
      errorCount++;
      if (errors.length < 20) {
        errors.push(`Line ${lineCount}: expected ${fieldCount} fields, got ${parts.length}`);
      }
      continue;
    }

    try {
      const raw: Partial<Record<keyof LogRow, unknown>> = {};

      for (let i = 0; i < fieldCount; i++) {
        const key = fieldNames[i];
        if (!key) continue;

        let value: unknown = parts[i];

        // IIS uses '-' for null/empty
        if (value === '-') {
          value = NULLABLE_FIELDS.has(key) ? null : value;
        } else if (NUMBER_FIELDS.has(key)) {
          // Fast number conversion
          const n = +(value as string);
          value = n === n ? n : 0; // NaN check
        }

        raw[key] = value;
      }

      // Compute ISO datetime from date + time fields
      const datetime = (raw.date && raw.time)
        ? `${raw.date}T${raw.time}Z`
        : null;

      const row: LogRow = {
        date:         (raw.date as string)         ?? '',
        time:         (raw.time as string)         ?? '',
        datetime:     datetime                     ?? '',
        s_ip:         (raw.s_ip as string)         ?? '',
        c_ip:         (raw.c_ip as string)         ?? '',
        method:       (raw.method as string)       ?? '',
        uri_stem:     (raw.uri_stem as string)     ?? '',
        uri_query:    (raw.uri_query as string)    ?? null,
        port:         (raw.port as number)         ?? 0,
        username:     (raw.username as string)     ?? null,
        user_agent:   (raw.user_agent as string)   ?? null,
        referer:      (raw.referer as string)      ?? null,
        status:       (raw.status as number)       ?? 0,
        substatus:    (raw.substatus as number)    ?? 0,
        win32_status: (raw.win32_status as number) ?? 0,
        time_taken_ms:(raw.time_taken_ms as number)?? 0,
        source_file:  sourceName,
      };

      rows.push(row);
    } catch (err) {
      errorCount++;
      if (errors.length < 20) {
        errors.push(`Line ${lineCount}: ${String(err)}`);
      }
    }
  }

  return {
    rows,
    field_count: fieldCount,
    line_count: lineCount,
    error_count: errorCount,
    errors,
  };
}
