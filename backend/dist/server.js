"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const files_1 = require("./routes/files");
const ingest_1 = require("./routes/ingest");
const query_1 = require("./routes/query");
const ui_1 = require("./routes/ui");
const converter_1 = require("./ingestion/converter");
const connection_1 = require("./db/connection");
// ─────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const app = (0, fastify_1.default)({
    logger: {
        transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
    },
});
async function bootstrap() {
    // CORS — allow React dev server and same-origin
    await app.register(cors_1.default, {
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
    await app.register(multipart_1.default, {
        limits: {
            fileSize: 100 * 1024 * 1024,
            files: 10_000,
        },
    });
    // Routes
    await app.register(files_1.filesRoutes);
    await app.register(ingest_1.ingestRoutes);
    await app.register(query_1.queryRoutes);
    await app.register(ui_1.uiRoutes);
    // Health check
    app.get('/health', async () => ({
        ok: true,
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    }));
    // On startup, register any parquet files that already exist from a previous session
    // so queries work immediately without re-ingesting
    try {
        await (0, converter_1.registerUnifiedView)();
    }
    catch {
        // No parquet files yet — that's fine, ingestion hasn't run
        app.log.info('No existing parquet files found — waiting for first ingestion');
    }
    // Graceful shutdown
    const shutdown = async (signal) => {
        app.log.info(`Received ${signal} — shutting down`);
        await app.close();
        await (0, connection_1.closeDb)();
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Start
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`IIS Forensics backend running at http://${HOST}:${PORT}`);
}
bootstrap().catch(err => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map