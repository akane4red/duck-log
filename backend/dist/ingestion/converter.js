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
    active_files: 0,
    current_files: [],
    file_statuses: [],
    total_bytes: 0,
    processed_bytes: 0,
    total_rows: 0,
    current_file: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    errors: [],
};
function getIngestStatus() {
    return {
        ...status,
        current_files: [...status.current_files],
        file_statuses: status.file_statuses.map((fileStatus) => ({ ...fileStatus })),
    };
}
/**
 * Ingest a list of .log file paths in parallel.
 * Parses each file, writes to Parquet, registers a unified DuckDB view.
 * Non-blocking — returns immediately, progress via getIngestStatus().
 */
async function ingestFiles(filePaths, options) {
    if (status.running) {
        throw new Error('Ingestion already in progress');
    }
    const concurrency = options?.concurrency ?? 6;
    // Reset status
    status.running = true;
    status.total_files = filePaths.length;
    status.processed_files = 0;
    status.active_files = 0;
    status.current_files = [];
    status.file_statuses = filePaths.map((filePath) => ({
        name: path.basename(filePath),
        status: 'queued',
    }));
    status.total_bytes = filePaths.reduce((sum, filePath) => {
        try {
            return sum + fs.statSync(filePath).size;
        }
        catch {
            return sum;
        }
    }, 0);
    status.processed_bytes = 0;
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
        // Process files in parallel with concurrency limit
        let fileIndex = 0;
        const workers = [];
        const fileByteProgress = new Map();
        const activeFiles = new Set();
        const fileStatuses = new Map(status.file_statuses.map((fileStatus) => [fileStatus.name, fileStatus]));
        const syncProcessedBytes = () => {
            status.processed_bytes = Array.from(fileByteProgress.values()).reduce((sum, bytes) => sum + bytes, 0);
        };
        const syncActiveFiles = () => {
            status.current_files = Array.from(activeFiles);
            status.active_files = status.current_files.length;
            status.current_file = status.current_files[0] ?? null;
        };
        const updateFileStatus = (name, nextStatus, error) => {
            const fileStatus = fileStatuses.get(name);
            if (!fileStatus)
                return;
            fileStatus.status = nextStatus;
            if (error)
                fileStatus.error = error;
            else
                delete fileStatus.error;
            status.file_statuses = Array.from(fileStatuses.values()).map((entry) => ({ ...entry }));
        };
        const processFile = async (filePath) => {
            const fileName = path.basename(filePath);
            const parseStart = Date.now();
            fileByteProgress.set(filePath, 0);
            syncProcessedBytes();
            activeFiles.add(fileName);
            syncActiveFiles();
            updateFileStatus(fileName, 'processing');
            try {
                console.log(`[ingest] Parsing ${filePath}`);
                const result = await (0, parser_1.parseLogFile)(filePath, ({ linesRead, bytesRead }) => {
                    fileByteProgress.set(filePath, bytesRead);
                    syncProcessedBytes();
                    console.log(`[ingest]   ${fileName}: ${linesRead.toLocaleString()} lines read...`);
                });
                const parseMs = Date.now() - parseStart;
                if (result.errors.length > 0) {
                    status.errors.push(...result.errors.map(e => `${fileName}: ${e}`));
                }
                if (result.rows.length === 0) {
                    console.warn(`[ingest] No rows parsed from ${filePath}`);
                    fileByteProgress.set(filePath, fs.statSync(filePath).size);
                    syncProcessedBytes();
                    status.processed_files++;
                    return;
                }
                // Write rows to Parquet via JSONL staging (much faster than SQL concatenation)
                const parquetPath = path.join(PARQUET_DIR, path.basename(filePath, '.log') + '.parquet');
                const writeStart = Date.now();
                await writeRowsToParquet(result.rows, parquetPath, (rowsWritten) => {
                    status.total_rows = rowsWritten + (status.total_rows - result.rows.length);
                });
                const writeMs = Date.now() - writeStart;
                status.total_rows += result.rows.length;
                status.processed_files++;
                fileByteProgress.set(filePath, fs.statSync(filePath).size);
                syncProcessedBytes();
                updateFileStatus(fileName, 'done');
                console.log(`[ingest] ✓ ${fileName} → ${result.rows.length.toLocaleString()} rows `
                    + `(parse=${parseMs}ms, write=${writeMs}ms) → ${parquetPath}`);
            }
            catch (err) {
                const msg = `Failed to ingest ${fileName}: ${String(err)}`;
                status.errors.push(msg);
                console.error(`[ingest] ✗ ${msg}`);
                status.processed_files++;
                updateFileStatus(fileName, 'error', msg);
                try {
                    fileByteProgress.set(filePath, fs.statSync(filePath).size);
                    syncProcessedBytes();
                }
                catch {
                    // ignore missing temp files
                }
            }
            finally {
                activeFiles.delete(fileName);
                syncActiveFiles();
                if (options?.deleteSourcesAfter) {
                    try {
                        fs.unlinkSync(filePath);
                    }
                    catch {
                        // ignore
                    }
                }
            }
        };
        const processNextFile = async () => {
            while (fileIndex < filePaths.length) {
                const idx = fileIndex++;
                await processFile(filePaths[idx]);
            }
        };
        // Start concurrency workers
        for (let i = 0; i < concurrency; i++) {
            workers.push(processNextFile());
        }
        await Promise.all(workers);
        // Register a unified view across ALL parquet files in the dir
        const registerStart = Date.now();
        await registerUnifiedView();
        const registerMs = Date.now() - registerStart;
        status.running = false;
        status.current_file = null;
        status.active_files = 0;
        status.current_files = [];
        status.processed_bytes = status.total_bytes;
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
 * Bypasses intermediate JSONL file — directly creates Parquet.
 * ~2x faster than JSONL staging by eliminating extra disk I/O.
 */
async function writeRowsToParquet(rows, parquetPath, onProgress) {
    if (rows.length === 0)
        return;
    const tempTableName = `_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conn = await (0, connection_1.createConnection)();
    try {
        await conn.run(`
      CREATE TEMP TABLE ${tempTableName} (
        date VARCHAR, time VARCHAR, datetime VARCHAR,
        s_ip VARCHAR, c_ip VARCHAR, method VARCHAR,
        uri_stem VARCHAR, uri_query VARCHAR, port INTEGER,
        username VARCHAR, user_agent VARCHAR, referer VARCHAR,
        status INTEGER, substatus INTEGER, win32_status INTEGER,
        time_taken_ms INTEGER, source_file VARCHAR
      );
    `);
        const appender = await conn.createAppender(tempTableName);
        for (const row of rows) {
            appender.appendVarchar(row.date);
            appender.appendVarchar(row.time);
            appendNullableVarchar(appender, row.datetime || null);
            appender.appendVarchar(row.s_ip);
            appender.appendVarchar(row.c_ip);
            appender.appendVarchar(row.method);
            appender.appendVarchar(row.uri_stem);
            appendNullableVarchar(appender, row.uri_query);
            appender.appendInteger(row.port);
            appendNullableVarchar(appender, row.username);
            appendNullableVarchar(appender, row.user_agent);
            appendNullableVarchar(appender, row.referer);
            appender.appendInteger(row.status);
            appender.appendInteger(row.substatus);
            appender.appendInteger(row.win32_status);
            appender.appendInteger(row.time_taken_ms);
            appender.appendVarchar(row.source_file);
            appender.endRow();
        }
        appender.closeSync();
        await conn.run(`
      COPY (
        SELECT
          date,
          time,
          TRY_CAST(datetime AS TIMESTAMP) AS datetime,
          s_ip,
          c_ip,
          method,
          uri_stem,
          uri_query,
          port,
          username,
          user_agent,
          referer,
          status,
          substatus,
          win32_status,
          time_taken_ms,
          source_file
        FROM ${tempTableName}
      )
      TO '${escapePathForSQL(parquetPath)}' (FORMAT PARQUET, COMPRESSION SNAPPY);
    `);
        if (onProgress) {
            onProgress(rows.length);
        }
    }
    finally {
        try {
            await conn.run(`DROP TABLE IF EXISTS ${tempTableName};`);
        }
        finally {
            conn.closeSync();
        }
    }
}
/**
 * Register a unified DuckDB view over ALL parquet files.
 * This is the view all forensic queries run against.
 * Includes ANALYZE for better query planning.
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
    await (0, connection_1.execute)(`CREATE OR REPLACE VIEW logs AS SELECT * FROM read_parquet('${escapePathForSQL(glob)}')`);
    // Note: ANALYZE cannot be used on views in DuckDB, only on base tables
    console.log(`[db] Unified view 'logs' registered across ${files.length} parquet file(s)`);
}
/** Escape paths for use in SQL string literals */
function escapePathForSQL(pathStr) {
    return pathStr.replace(/\\/g, '\\\\').replace(/'/g, "''");
}
function appendNullableVarchar(appender, value) {
    if (value === null) {
        appender.appendNull();
        return;
    }
    appender.appendVarchar(value);
}
/** Check if parquet data already exists (for /files endpoint) */
function parquetExistsFor(logFileName) {
    const parquetName = logFileName.replace(/\.log$/i, '.parquet');
    return fs.existsSync(path.join(PARQUET_DIR, parquetName));
}
//# sourceMappingURL=converter.js.map