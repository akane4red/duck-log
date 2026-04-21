"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uiRoutes = uiRoutes;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const publicDir = node_path_1.default.resolve(process.cwd(), 'frontend');
const assetTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
};
async function serveFile(reply, filename) {
    const filePath = node_path_1.default.join(publicDir, filename);
    const extension = node_path_1.default.extname(filename).toLowerCase();
    const contentType = assetTypes[extension] ?? 'text/plain; charset=utf-8';
    try {
        const content = await (0, promises_1.readFile)(filePath, 'utf8');
        reply.type(contentType);
        return reply.send(content);
    }
    catch {
        return reply.code(404).send('Not found');
    }
}
async function uiRoutes(app) {
    app.get('/', async (_req, reply) => serveFile(reply, 'index.html'));
    app.get('/app.css', async (_req, reply) => serveFile(reply, 'app.css'));
    app.get('/app.js', async (_req, reply) => serveFile(reply, 'app.js'));
}
//# sourceMappingURL=ui.js.map