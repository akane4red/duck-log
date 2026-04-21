import { FastifyInstance } from 'fastify';
import { scanDirectory } from '../ingestion/watcher';
import { ApiResponse, LogFileInfo } from '../shared/types';

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /files?dir=/path/to/logs
   * Scans a directory and returns all .log files with metadata.
   */
  app.get<{
    Querystring: { dir: string };
  }>('/files', async (req, reply) => {
    const { dir } = req.query;

    if (!dir) {
      return reply.code(400).send({
        ok: false,
        error: 'Missing required query param: dir',
      } satisfies ApiResponse<never>);
    }

    try {
      const files = await scanDirectory(dir);
      return reply.send({
        ok: true,
        data: files,
      } satisfies ApiResponse<LogFileInfo[]>);
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: String(err),
      } satisfies ApiResponse<never>);
    }
  });
}
