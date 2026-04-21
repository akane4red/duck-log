"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filesRoutes = filesRoutes;
const watcher_1 = require("../ingestion/watcher");
async function filesRoutes(app) {
    /**
     * GET /files?dir=/path/to/logs
     * Scans a directory and returns all .log files with metadata.
     */
    app.get('/files', async (req, reply) => {
        const { dir } = req.query;
        if (!dir) {
            return reply.code(400).send({
                ok: false,
                error: 'Missing required query param: dir',
            });
        }
        try {
            const files = await (0, watcher_1.scanDirectory)(dir);
            return reply.send({
                ok: true,
                data: files,
            });
        }
        catch (err) {
            return reply.code(500).send({
                ok: false,
                error: String(err),
            });
        }
    });
}
//# sourceMappingURL=files.js.map