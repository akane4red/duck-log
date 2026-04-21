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
exports.ingestRoutes = ingestRoutes;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto_1 = require("crypto");
const promises_1 = require("stream/promises");
const converter_1 = require("../ingestion/converter");
const watcher_1 = require("../ingestion/watcher");
const UPLOAD_TMP_DIR = path.resolve(process.env.UPLOAD_TMP_DIR ?? './data/uploads');
async function ingestRoutes(app) {
    /**
     * POST /ingest
     * Body: { file_paths: string[] }
     * Starts ingestion pipeline. Non-blocking — returns immediately.
     * Poll GET /ingest/status for progress.
     */
    app.post('/ingest', async (req, reply) => {
        const { file_paths } = req.body ?? {};
        if (!Array.isArray(file_paths) || file_paths.length === 0) {
            return reply.code(400).send({
                ok: false,
                error: 'Body must include file_paths: string[]',
            });
        }
        const current = (0, converter_1.getIngestStatus)();
        if (current.running) {
            return reply.code(409).send({
                ok: false,
                error: 'Ingestion already in progress',
            });
        }
        const { valid, invalid } = (0, watcher_1.validateFilePaths)(file_paths);
        if (valid.length === 0) {
            return reply.code(400).send({
                ok: false,
                error: `No valid .log files found. Issues: ${invalid.map(i => `${i.path}: ${i.reason}`).join(', ')}`,
            });
        }
        // Fire ingestion — non-blocking
        (0, converter_1.ingestFiles)(valid).catch(err => {
            console.error('[route /ingest] Unhandled error:', err);
        });
        return reply.code(202).send({
            ok: true,
            data: {
                accepted: valid.length,
                skipped: invalid,
                message: 'Ingestion started. Poll GET /ingest/status for progress.',
            },
        });
    });
    /**
     * POST /ingest/upload
     * multipart/form-data with one or more file fields named "logs" (or any field name ending in .log).
     * Saves uploads to temp paths and runs the same ingestion pipeline (then deletes temp files).
     */
    app.post('/ingest/upload', async (req, reply) => {
        const current = (0, converter_1.getIngestStatus)();
        if (current.running) {
            return reply.code(409).send({
                ok: false,
                error: 'Ingestion already in progress',
            });
        }
        const tempPaths = [];
        fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
        try {
            const parts = req.parts();
            for await (const part of parts) {
                if (part.type !== 'file') {
                    continue;
                }
                const name = part.filename ?? '';
                if (!name.toLowerCase().endsWith('.log')) {
                    part.file.resume();
                    continue;
                }
                const safeBase = path.basename(name);
                const dest = path.join(UPLOAD_TMP_DIR, `${Date.now()}_${(0, crypto_1.randomBytes)(8).toString('hex')}_${safeBase}`);
                await (0, promises_1.pipeline)(part.file, fs.createWriteStream(dest));
                tempPaths.push(dest);
            }
        }
        catch (err) {
            for (const p of tempPaths) {
                try {
                    fs.unlinkSync(p);
                }
                catch {
                    // ignore
                }
            }
            return reply.code(400).send({
                ok: false,
                error: `Upload failed: ${String(err)}`,
            });
        }
        if (tempPaths.length === 0) {
            return reply.code(400).send({
                ok: false,
                error: 'No .log files received. Use form field name "logs" for each file.',
            });
        }
        (0, converter_1.ingestFiles)(tempPaths, { deleteSourcesAfter: true }).catch(err => {
            console.error('[route /ingest/upload] Unhandled error:', err);
        });
        return reply.code(202).send({
            ok: true,
            data: {
                accepted: tempPaths.length,
                skipped: [],
                message: 'Upload accepted. Ingestion started. Poll GET /ingest/status for progress.',
            },
        });
    });
    /**
     * GET /ingest/status
     * Returns current ingestion progress.
     */
    app.get('/ingest/status', async (_req, reply) => {
        return reply.send({
            ok: true,
            data: (0, converter_1.getIngestStatus)(),
        });
    });
}
//# sourceMappingURL=ingest.js.map