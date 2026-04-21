import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FastifyInstance } from 'fastify';

const publicDir = path.resolve(process.cwd(), 'frontend');

const assetTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

async function serveFile(reply: { type: (value: string) => unknown; send: (value: string) => unknown; code: (value: number) => typeof reply }, filename: string) {
  const filePath = path.join(publicDir, filename);
  const extension = path.extname(filename).toLowerCase();
  const contentType = assetTypes[extension] ?? 'text/plain; charset=utf-8';

  try {
    const content = await readFile(filePath, 'utf8');
    reply.type(contentType);
    return reply.send(content);
  } catch {
    return reply.code(404).send('Not found');
  }
}

export async function uiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => serveFile(reply, 'index.html'));
  app.get('/app.css', async (_req, reply) => serveFile(reply, 'app.css'));
  app.get('/app.js', async (_req, reply) => serveFile(reply, 'app.js'));
}
