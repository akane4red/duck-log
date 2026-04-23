import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { filesRoutes } from './routes/files';
import { ingestRoutes } from './routes/ingest';
import { queryRoutes } from './routes/query';
import { dashboardRoutes } from './routes/dashboard';
import { sessionsRoutes } from './routes/sessions';
import { uiRoutes } from './routes/ui';
import { ensureDefaultSession } from './sessions/store';
import { closeAllSessionDbs } from './db/sessionDb';

// ─────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  },
});

async function bootstrap(): Promise<void> {
  // CORS — allow React dev server and same-origin
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      cb(null, allowed);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024,
      files: 10_000,
    },
  });

  // Routes
  await app.register(filesRoutes);
  await app.register(sessionsRoutes);
  await app.register(ingestRoutes);
  await app.register(queryRoutes);
  await app.register(dashboardRoutes);
  await app.register(uiRoutes);

  // Health check
  app.get('/health', async () => ({
    ok: true,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }));

  // Ensure a default session exists so users always have somewhere to start.
  ensureDefaultSession();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal} — shutting down`);
    await app.close();
    closeAllSessionDbs();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`IIS Forensics backend running at http://${HOST}:${PORT}`);
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
