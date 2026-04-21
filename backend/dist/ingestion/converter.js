"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIngestStatus = getIngestStatus;
exports.ingestFiles = ingestFiles;
exports.registerUnifiedView = registerUnifiedView;
exports.parquetExistsFor = parquetExistsFor;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const parser_1 = require("./parser");
const connection_1 = require("../db/connection");
// ─────────────────────────────────────────────
// Ingestion Pipeline
// Raw .log → Parquet + DuckDB view
// ─────────────────────────────────────────────
const PARQUET_DIR = path.resolve(process.env.PARQUET_DIR ?? './data/parquet');
/** Global ingestion state — one job at a time */
const status = {
    running: false,
    total_files: 0,
    processed_files: 0,
    total_rows: 0,
    current_file: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    errors: [],
};
function getIngestStatus() {
    return { ...status };
}
/**
 * Ingest a list of .log file paths.
 * Parses each file, writes to Parquet, registers a unified DuckDB view.
 * Non-blocking — returns immediately, progress via getIngestStatus().
 */
async function ingestFiles(filePaths, options) {
    if (status.running) {
        throw new Error('Ingestion already in progress');
    }
    // Reset status
    status.running = true;
    status.total_files = filePaths.length;
    status.processed_files = 0;
    status.total_rows = 0;
    status.current_file = null;
    status.started_at = new Date().toISOString();
    status.finished_at = null;
    status.duration_ms = null;
    status.errors = [];
    const startTime = Date.now();
    fs.mkdirSync(PARQUET_DIR, { recursive: true });
    // Run ingestion async — don't await so the route returns immediately
    (async () => {
        const parquetFiles = [];
        for (const filePath of filePaths) {
            status.current_file = path.basename(filePath);
            const parseStart = Date.now();
            try {
                console.log(`[ingest] Parsing ${filePath}`);
                const result = await (0, parser_1.parseLogFile)(filePath, (lines) => {
                    console.log(`[ingest]   ${status.current_file}: ${lines.toLocaleString()} lines read...`);
                });
                const parseMs = Date.now() - parseStart;
                if (result.errors.length > 0) {
                    status.errors.push(...result.errors.map(e => `${status.current_file}: ${e}`));
                }
                if (result.rows.length === 0) {
                    console.warn(`[ingest] No rows parsed from ${filePath}`);
                    status.processed_files++;
                    continue;
                }
                // Write rows to a temp JSON-lines staging table, then export to Parquet
                const parquetPath = path.join(PARQUET_DIR, path.basename(filePath, '.log') + '.parquet');
                const writeStart = Date.now();
                await writeRowsToParquet(result.rows, parquetPath);
                const writeMs = Date.now() - writeStart;
                parquetFiles.push(parquetPath);
                status.total_rows += result.rows.length;
                status.processed_files++;
                console.log(`[ingest] ✓ ${status.current_file} → ${result.rows.length.toLocaleString()} rows `
                    + `(parse=${parseMs}ms, write=${writeMs}ms) → ${parquetPath}`);
            }
            catch (err) {
                const msg = `Failed to ingest ${path.basename(filePath)}: ${String(err)}`;
                status.errors.push(msg);
                console.error(`[ingest] ✗ ${msg}`);
                status.processed_files++;
            }
            finally {
                if (options?.deleteSourcesAfter) {
                    try {
                        fs.unlinkSync(filePath);
                    }
                    catch {
                        // ignore
                    }
                }
            }
        }
        // Register a unified view across ALL parquet files in the dir
        const registerStart = Date.now();
        await registerUnifiedView();
        const registerMs = Date.now() - registerStart;
        status.running = false;
        status.current_file = null;
        status.finished_at = new Date().toISOString();
        status.duration_ms = Date.now() - startTime;
        console.log(`[ingest] Complete. ${status.total_rows.toLocaleString()} total rows `
            + `in ${status.duration_ms}ms (register_view=${registerMs}ms)`);
    })().catch(err => {
        status.running = false;
        status.errors.push(`Fatal ingestion error: ${String(err)}`);
        console.error('[ingest] Fatal:', err);
    });
}
/**
 * Write LogRow array to a Parquet file via DuckDB.
 * Uses DuckDB's COPY ... TO ... (FORMAT PARQUET) for maximum speed.
 */
async function writeRowsToParquet(rows, parquetPath) {
    // Stage rows into a DuckDB in-memory temp table
    const stagingTable = `staging_${Date.now()}`;
    await (0, connection_1.execute)(`
    CREATE TEMP TABLE ${stagingTable} (
      date          VARCHAR,
      time          VARCHAR,
      datetime      TIMESTAMP,
      s_ip          VARCHAR,
      c_ip          VARCHAR,
      method        VARCHAR,
      uri_stem      VARCHAR,
      uri_query     VARCHAR,
      port          INTEGER,
      username      VARCHAR,
      user_agent    VARCHAR,
      referer       VARCHAR,
      status        INTEGER,
      substatus     INTEGER,
      win32_status  INTEGER,
      time_taken_ms INTEGER,
      source_file   VARCHAR
    )
  `);
    // Batch insert in chunks of 10k rows for memory efficiency
    const CHUNK = 10_000;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const values = chunk.map(r => `(
      '${esc(r.date)}', '${esc(r.time)}',
      ${r.datetime ? `'${r.datetime}'` : 'NULL'},
      '${esc(r.s_ip)}', '${esc(r.c_ip)}',
      '${esc(r.method)}', '${esc(r.uri_stem)}',
      ${r.uri_query ? `'${esc(r.uri_query)}'` : 'NULL'},
      ${r.port ?? 0},
      ${r.username ? `'${esc(r.username)}'` : 'NULL'},
      ${r.user_agent ? `'${esc(r.user_agent)}'` : 'NULL'},
      ${r.referer ? `'${esc(r.referer)}'` : 'NULL'},
      ${r.status ?? 0}, ${r.substatus ?? 0},
      ${r.win32_status ?? 0}, ${r.time_taken_ms ?? 0},
      '${esc(r.source_file)}'
    )`).join(',');
        await (0, connection_1.execute)(`INSERT INTO ${stagingTable} VALUES ${values}`);
    }
    // Export to Parquet — DuckDB handles compression automatically
    await (0, connection_1.execute)(`
    COPY ${stagingTable} TO '${parquetPath}' (FORMAT PARQUET, COMPRESSION SNAPPY)
  `);
    await (0, connection_1.execute)(`DROP TABLE ${stagingTable}`);
}
/**
 * Register a unified DuckDB view over ALL parquet files.
 * This is the view all forensic queries run against.
 */
async function registerUnifiedView() {
    const files = fs.readdirSync(PARQUET_DIR)
        .filter(f => f.endsWith('.parquet'))
        .map(f => path.join(PARQUET_DIR, f));
    if (files.length === 0) {
        console.warn('[ingest] No parquet files to register');
        return;
    }
    const glob = path.join(PARQUET_DIR, '*.parquet');
    await (0, connection_1.execute)(`CREATE OR REPLACE VIEW logs AS SELECT * FROM read_parquet('${glob}')`);
    console.log(`[db] Unified view 'logs' registered across ${files.length} parquet file(s)`);
}
/** Escape single quotes for SQL string literals */
function esc(val) {
    return String(val ?? '').replace(/'/g, "''");
}
/** Check if parquet data already exists (for /files endpoint) */
function parquetExistsFor(logFileName) {
    const parquetName = logFileName.replace(/\.log$/i, '.parquet');
    return fs.existsSync(path.join(PARQUET_DIR, parquetName));
}
//# sourceMappingURL=converter.js.map