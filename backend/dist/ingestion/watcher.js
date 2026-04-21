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
exports.scanDirectory = scanDirectory;
exports.validateFilePaths = validateFilePaths;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const glob_1 = require("glob");
const converter_1 = require("./converter");
// ─────────────────────────────────────────────
// File Scanner
// Discovers .log files on local disk / NAS
// ─────────────────────────────────────────────
/**
 * Scan a directory (recursively) for IIS .log files.
 * Returns metadata for each file including ingestion status.
 */
async function scanDirectory(dirPath) {
    const absDir = path.resolve(dirPath);
    if (!fs.existsSync(absDir)) {
        throw new Error(`Directory not found: ${absDir}`);
    }
    const pattern = path.join(absDir, '**', '*.log').replace(/\\/g, '/');
    const files = await (0, glob_1.glob)(pattern, { nodir: true });
    const results = files.map(filePath => {
        const stat = fs.statSync(filePath);
        const name = path.basename(filePath);
        return {
            name,
            path: filePath,
            size_bytes: stat.size,
            size_mb: Math.round((stat.size / 1024 / 1024) * 100) / 100,
            modified_at: stat.mtime.toISOString(),
            ingested: (0, converter_1.parquetExistsFor)(name),
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
function validateFilePaths(filePaths) {
    const valid = [];
    const invalid = [];
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
        }
        catch {
            invalid.push({ path: filePath, reason: 'File not readable' });
        }
    }
    return { valid, invalid };
}
//# sourceMappingURL=watcher.js.map