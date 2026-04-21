"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryRoutes = queryRoutes;
const queries_1 = require("../queries");
async function queryRoutes(app) {
    const registry = (0, queries_1.getRegistry)();
    /**
     * GET /queries
     * Lists all available named queries with their parameter schemas.
     */
    app.get('/queries', async (_req, reply) => {
        return reply.send({
            ok: true,
            data: registry.list(),
        });
    });
    /**
     * POST /query/:name
     * Body: query-specific parameters (see GET /queries for schema)
     * Runs a named forensic query and returns results.
     */
    app.post('/query/:name', async (req, reply) => {
        const { name } = req.params;
        const params = req.body ?? {};
        const handler = registry.get(name);
        if (!handler) {
            return reply.code(404).send({
                ok: false,
                error: `Unknown query: '${name}'. Call GET /queries to see available queries.`,
            });
        }
        try {
            const start = Date.now();
            const rows = await handler.run(params);
            const duration_ms = Date.now() - start;
            return reply.send({
                ok: true,
                data: {
                    query: name,
                    params,
                    duration_ms,
                    row_count: rows.length,
                    rows,
                },
            });
        }
        catch (err) {
            return reply.code(500).send({
                ok: false,
                error: `Query '${name}' failed: ${String(err)}`,
            });
        }
    });
}
//# sourceMappingURL=query.js.map