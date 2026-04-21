"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestRoutes = ingestRoutes;
const converter_1 = require("../ingestion/converter");
const watcher_1 = require("../ingestion/watcher");
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