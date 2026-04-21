import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { pipeline } from 'stream/promises';
import { FastifyInstance } from 'fastify';
import { ingestFiles, getIngestStatus } from '../ingestion/converter';
import { validateFilePaths } from '../ingestion/watcher';
import { ApiResponse, IngestRequest, IngestStatus } from '../shared/types';

const UPLOAD_TMP_DIR = path.resolve(process.env.UPLOAD_TMP_DIR ?? './data/uploads');

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /ingest
   * Body: { file_paths: string[] }
   * Starts ingestion pipeline. Non-blocking — returns immediately.
   * Poll GET /ingest/status for progress.
   */
  app.post<{ Body: IngestRequest }>('/ingest', async (req, reply) => {
    const { file_paths } = req.body ?? {};

    if (!Array.isArray(file_paths) || file_paths.length === 0) {
      return reply.code(400).send({
        ok: false,
        error: 'Body must include file_paths: string[]',
      } satisfies ApiResponse<never>);
    }

    const current = getIngestStatus();
    if (current.running) {
      return reply.code(409).send({
        ok: false,
        error: 'Ingestion already in progress',
      } satisfies ApiResponse<never>);
    }

    const { valid, invalid } = validateFilePaths(file_paths);

    if (valid.length === 0) {
      return reply.code(400).send({
        ok: false,
        error: `No valid .log files found. Issues: ${invalid.map(i => `${i.path}: ${i.reason}`).join(', ')}`,
      } satisfies ApiResponse<never>);
    }

    // Fire ingestion — non-blocking
    ingestFiles(valid).catch(err => {
      console.error('[route /ingest] Unhandled error:', err);
    });

    return reply.code(202).send({
      ok: true,
      data: {
        accepted: valid.length,
        skipped: invalid,
        message: 'Ingestion started. Poll GET /ingest/status for progress.',
      },
    } satisfies ApiResponse<unknown>);
  });

  /**
   * POST /ingest/upload
   * multipart/form-data with one or more file fields named "logs" (or any field name ending in .log).
   * Saves uploads to temp paths and runs the same ingestion pipeline (then deletes temp files).
   */
  app.post('/ingest/upload', async (req, reply) => {
    const current = getIngestStatus();
    if (current.running) {
      return reply.code(409).send({
        ok: false,
        error: 'Ingestion already in progress',
      } satisfies ApiResponse<never>);
    }

    const tempPaths: string[] = [];
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
        const dest = path.join(
          UPLOAD_TMP_DIR,
          `${Date.now()}_${randomBytes(8).toString('hex')}_${safeBase}`
        );
        await pipeline(part.file, fs.createWriteStream(dest));
        tempPaths.push(dest);
      }
    } catch (err) {
      for (const p of tempPaths) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }
      return reply.code(400).send({
        ok: false,
        error: `Upload failed: ${String(err)}`,
      } satisfies ApiResponse<never>);
    }

    if (tempPaths.length === 0) {
      return reply.code(400).send({
        ok: false,
        error: 'No .log files received. Use form field name "logs" for each file.',
      } satisfies ApiResponse<never>);
    }

    ingestFiles(tempPaths, { deleteSourcesAfter: true }).catch(err => {
      console.error('[route /ingest/upload] Unhandled error:', err);
    });

    return reply.code(202).send({
      ok: true,
      data: {
        accepted: tempPaths.length,
        skipped: [] as Array<{ path: string; reason: string }>,
        message: 'Upload accepted. Ingestion started. Poll GET /ingest/status for progress.',
      },
    } satisfies ApiResponse<unknown>);
  });

  /**
   * GET /ingest/status
   * Returns current ingestion progress.
   */
  app.get('/ingest/status', async (_req, reply) => {
    return reply.send({
      ok: true,
      data: getIngestStatus(),
    } satisfies ApiResponse<IngestStatus>);
  });
}
