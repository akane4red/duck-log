import { FastifyInstance } from 'fastify';
import { ApiResponse } from '../shared/types';
import {
  createSession,
  ensureDefaultSession,
  getSessionSummary,
  listSessions,
  loadSessionMeta,
} from '../sessions/store';

export async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sessions', async (_req, reply) => {
    ensureDefaultSession();
    return reply.send({
      ok: true,
      data: listSessions().map((meta) => {
        const summary = getSessionSummary(meta.id);
        return { ...meta, parquet_files: summary.parquet_files };
      }),
    } satisfies ApiResponse<unknown>);
  });

  app.post<{ Body: { name?: string } }>('/sessions', async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) {
      return reply.code(400).send({
        ok: false,
        error: 'Body must include name: string',
      } satisfies ApiResponse<never>);
    }
    const meta = createSession(name);
    const summary = getSessionSummary(meta.id);
    return reply.code(201).send({
      ok: true,
      data: { ...meta, parquet_files: summary.parquet_files },
    } satisfies ApiResponse<unknown>);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/summary', async (req, reply) => {
    const id = req.params.id;
    const meta = loadSessionMeta(id);
    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown session: '${id}'`,
      } satisfies ApiResponse<never>);
    }
    const summary = getSessionSummary(id);
    return reply.send({
      ok: true,
      data: { ...meta, parquet_files: summary.parquet_files },
    } satisfies ApiResponse<unknown>);
  });
}

