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
exports.parseLogFile = parseLogFile;
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const path = __importStar(require("path"));
// ─────────────────────────────────────────────
// IIS W3C Log Parser
// Handles variable #Fields: headers across files
// ─────────────────────────────────────────────
/** Maps raw IIS field names to our normalized schema keys */
const FIELD_MAP = {
    'date': 'date',
    'time': 'time',
    's-ip': 's_ip',
    'cs-method': 'method',
    'cs-uri-stem': 'uri_stem',
    'cs-uri-query': 'uri_query',
    's-port': 'port',
    'cs-username': 'username',
    'c-ip': 'c_ip',
    'cs(user-agent)': 'user_agent',
    'cs(referer)': 'referer',
    'sc-status': 'status',
    'sc-substatus': 'substatus',
    'sc-win32-status': 'win32_status',
    'time-taken': 'time_taken_ms',
};
const NUMBER_FIELDS = new Set([
    'port', 'status', 'substatus', 'win32_status', 'time_taken_ms'
]);
const NULLABLE_FIELDS = new Set([
    'uri_query', 'username', 'user_agent', 'referer'
]);
/**
 * Parse a single IIS .log file into normalized LogRow array.
 * Streams line-by-line so large files never fully load into memory.
 */
async function parseLogFile(filePath, onProgress) {
    const sourceName = path.basename(filePath);
    const rows = [];
    const errors = [];
    let fieldNames = [];
    let lineCount = 0;
    let errorCount = 0;
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    for await (const line of rl) {
        lineCount++;
        if (onProgress && lineCount % 50_000 === 0) {
            onProgress(lineCount);
        }
        // Skip blank lines
        if (!line.trim())
            continue;
        // Parse #Fields directive — this can appear multiple times in one file
        if (line.startsWith('#Fields:')) {
            const rawFields = line.slice(8).trim().toLowerCase().split(/\s+/);
            fieldNames = rawFields.map(f => FIELD_MAP[f] ?? null);
            continue;
        }
        // Skip other comment lines (#Software, #Version, #Date)
        if (line.startsWith('#'))
            continue;
        // No fields header seen yet — skip data lines
        if (fieldNames.length === 0)
            continue;
        const parts = line.split(' ');
        if (parts.length !== fieldNames.length) {
            errorCount++;
            if (errors.length < 20) {
                errors.push(`Line ${lineCount}: expected ${fieldNames.length} fields, got ${parts.length}`);
            }
            continue;
        }
        try {
            const raw = {};
            for (let i = 0; i < fieldNames.length; i++) {
                const key = fieldNames[i];
                if (!key)
                    continue;
                let value = parts[i];
                // IIS uses '-' for null/empty
                if (value === '-') {
                    value = NULLABLE_FIELDS.has(key) ? null : value;
                }
                // Coerce numeric fields
                if (NUMBER_FIELDS.has(key) && value !== null) {
                    const n = Number(value);
                    value = isNaN(n) ? 0 : n;
                }
                raw[key] = value;
            }
            // Compute ISO datetime from date + time fields
            const datetime = (raw.date && raw.time)
                ? `${raw.date}T${raw.time}Z`
                : null;
            const row = {
                date: raw.date ?? '',
                time: raw.time ?? '',
                datetime: datetime ?? '',
                s_ip: raw.s_ip ?? '',
                c_ip: raw.c_ip ?? '',
                method: raw.method ?? '',
                uri_stem: raw.uri_stem ?? '',
                uri_query: raw.uri_query ?? null,
                port: raw.port ?? 0,
                username: raw.username ?? null,
                user_agent: raw.user_agent ?? null,
                referer: raw.referer ?? null,
                status: raw.status ?? 0,
                substatus: raw.substatus ?? 0,
                win32_status: raw.win32_status ?? 0,
                time_taken_ms: raw.time_taken_ms ?? 0,
                source_file: sourceName,
            };
            rows.push(row);
        }
        catch (err) {
            errorCount++;
            if (errors.length < 20) {
                errors.push(`Line ${lineCount}: ${String(err)}`);
            }
        }
    }
    return {
        rows,
        field_count: fieldNames.length,
        line_count: lineCount,
        error_count: errorCount,
        errors,
    };
}
//# sourceMappingURL=parser.js.map