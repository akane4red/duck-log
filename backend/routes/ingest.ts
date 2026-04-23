import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { pipeline } from 'stream/promises';
import { FastifyInstance } from 'fastify';
import { ingestFiles, ingestFilesForSession, getIngestStatus, getIngestStatusForSession } from '../ingestion/converter';
import { validateFilePaths } from '../ingestion/watcher';
import { ApiResponse, IngestRequest, IngestStatus } from '../shared/types';
import { loadSessionMeta } from '../sessions/store';

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
   * POST /sessions/:id/ingest/upload
   * multipart/form-data with one or more file fields named "logs" (or any field name ending in .log).
   * Saves uploads to temp paths and runs the session-scoped ingestion pipeline (then deletes temp files).
   */
  app.post<{ Params: { id: string } }>('/sessions/:id/ingest/upload', async (req, reply) => {
    const sessionId = req.params.id;
    const meta = loadSessionMeta(sessionId);
    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown session: '${sessionId}'`,
      } satisfies ApiResponse<never>);
    }

    const current = getIngestStatusForSession(sessionId);
    if (current.running) {
      return reply.code(409).send({
        ok: false,
        error: 'Ingestion already in progress',
      } satisfies ApiResponse<never>);
    }

    const tempPaths: string[] = [];
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
    let totalSize = 0;

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

        const measureStream = part.file.on('data', (chunk) => {
          totalSize += chunk.length;
        });

        await pipeline(measureStream, fs.createWriteStream(dest));
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

    const concurrency = totalSize > 20_000_000_000 ? 10 : 6;

    ingestFilesForSession(sessionId, tempPaths, { deleteSourcesAfter: true, concurrency }).catch(err => {
      console.error('[route /sessions/:id/ingest/upload] Unhandled error:', err);
    });

    return reply.code(202).send({
      ok: true,
      data: {
        accepted: tempPaths.length,
        skipped: [] as Array<{ path: string; reason: string }>,
        message: `Upload accepted. Ingestion started with ${concurrency} workers in session '${meta.name}'. Poll GET /sessions/${sessionId}/ingest/status for progress.`,
      },
    } satisfies ApiResponse<unknown>);
  });

  /**
   * GET /sessions/:id/ingest/status
   * Returns current ingestion progress for a session.
   */
  app.get<{ Params: { id: string } }>('/sessions/:id/ingest/status', async (req, reply) => {
    const sessionId = req.params.id;
    const meta = loadSessionMeta(sessionId);
    if (!meta) {
      return reply.code(404).send({
        ok: false,
        error: `Unknown session: '${sessionId}'`,
      } satisfies ApiResponse<never>);
    }
    return reply.send({
      ok: true,
      data: getIngestStatusForSession(sessionId),
    } satisfies ApiResponse<IngestStatus>);
  });

  /**
   * POST /ingest/upload
   * multipart/form-data with one or more file fields named "logs" (or any field name ending in .log).
   * Saves uploads to temp paths and runs the same ingestion pipeline (then deletes temp files).
   * For large uploads (>100MB), uses higher concurrency for faster parallel processing.
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
    let totalSize = 0;

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
        
        // Track file size as it streams for concurrency adjustment
        let fileSize = 0;
        const measureStream = part.file.on('data', (chunk) => {
          fileSize += chunk.length;
          totalSize += chunk.length;
        });
        
        await pipeline(measureStream, fs.createWriteStream(dest));
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

    // Use consistent concurrency: 6 workers for normal loads, 10 for massive uploads (>20GB)
    const concurrency = totalSize > 20_000_000_000 ? 10 : 6;

    ingestFiles(tempPaths, { deleteSourcesAfter: true, concurrency }).catch(err => {
      console.error('[route /ingest/upload] Unhandled error:', err);
    });

    return reply.code(202).send({
      ok: true,
      data: {
        accepted: tempPaths.length,
        skipped: [] as Array<{ path: string; reason: string }>,
        message: `Upload accepted (${(totalSize / 1024 / 1024 / 1024).toFixed(1)}GB). Ingestion started with ${concurrency} workers. Poll GET /ingest/status for progress.`,
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
