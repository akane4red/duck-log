import { FastifyInstance } from 'fastify';
import { getRegistry } from '../queries';
import { ApiResponse, QueryResponse } from '../shared/types';
import { ensureDefaultSession, loadSessionMeta } from '../sessions/store';
import { registerUnifiedViewForSession } from '../ingestion/converter';
import { sessionQuery } from '../db/sessionDb';

const MAX_QUERY_ROWS = Math.max(1, Number(process.env.MAX_QUERY_ROWS ?? 5000));

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  const registry = getRegistry();

  /**
   * GET /queries
   * Lists all available named queries with their parameter schemas.
   */
  app.get('/queries', async (_req, reply) => {
    return reply.send({
      ok: true,
      data: registry.list(),
    } satisfies ApiResponse<unknown>);
  });

  /**
   * POST /query/:name
   * Body: query-specific parameters (see GET /queries for schema)
   * Runs a named forensic query and returns results.
   */
  app.post<{
    Params: { name: string };
    Body: Record<string, unknown>;
  }>('/query/:name', async (req, reply) => {
    const { name } = req.params;
    const params = req.body ?? {};

    const handler = registry.get(name);
    if (!handler) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown query: '${name}'. Call GET /queries to see available queries.`,
      } satisfies ApiResponse<never>);
    }

    try {
      const start = Date.now();
      // Back-compat: run queries against default session.
      const sessionId = ensureDefaultSession().id;
      await registerUnifiedViewForSession(sessionId);
      const rows = await handler.run(params, { query: (sql: string) => sessionQuery(sessionId, sql) });
      const duration_ms = Date.now() - start;
      const row_count = rows.length;
      const rows_limited = row_count > MAX_QUERY_ROWS;
      const responseRows = rows_limited ? rows.slice(0, MAX_QUERY_ROWS) : rows;

      if (rows_limited) {
        app.log.warn(
          `[query] '${name}' produced ${row_count.toLocaleString()} rows; `
          + `returning first ${MAX_QUERY_ROWS.toLocaleString()} rows`
        );
      }

      return reply.send({
        ok: true,
        data: {
          query: name,
          params,
          duration_ms,
          row_count,
          rows: responseRows,
          rows_limited,
          returned_rows: responseRows.length,
        } satisfies QueryResponse,
      } satisfies ApiResponse<QueryResponse>);
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: `Query '${name}' failed: ${String(err)}`,
      } satisfies ApiResponse<never>);
    }
  });

  app.post<{
    Params: { id: string; name: string };
    Body: Record<string, unknown>;
  }>('/sessions/:id/query/:name', async (req, reply) => {
    const { id: sessionId, name } = req.params;
    const params = req.body ?? {};

    const meta = loadSessionMeta(sessionId);
    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown session: '${sessionId}'`,
      } satisfies ApiResponse<never>);
    }

    const handler = registry.get(name);
    if (!handler) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown query: '${name}'. Call GET /queries to see available queries.`,
      } satisfies ApiResponse<never>);
    }

    try {
      const start = Date.now();
      await registerUnifiedViewForSession(sessionId);
      const rows = await handler.run(params, { query: (sql: string) => sessionQuery(sessionId, sql) });
      const duration_ms = Date.now() - start;
      const row_count = rows.length;
      const rows_limited = row_count > MAX_QUERY_ROWS;
      const responseRows = rows_limited ? rows.slice(0, MAX_QUERY_ROWS) : rows;

      if (rows_limited) {
        app.log.warn(
          `[query] '${name}' produced ${row_count.toLocaleString()} rows; `
          + `returning first ${MAX_QUERY_ROWS.toLocaleString()} rows`
        );
      }

      return reply.send({
        ok: true,
        data: {
          query: name,
          params,
          duration_ms,
          row_count,
          rows: responseRows,
          rows_limited,
          returned_rows: responseRows.length,
        } satisfies QueryResponse,
      } satisfies ApiResponse<QueryResponse>);
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: `Query '${name}' failed: ${String(err)}`,
      } satisfies ApiResponse<never>);
    }
  });
}
