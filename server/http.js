// Localhost receiver: the extension PUTs reviews here; the reviews page reads statuses back.
import http from 'node:http';
import { DATA_DIR, StoreError, deleteReview, listReviews, saveReview, summary } from './store.js';

export const DEFAULT_PORT = Number(process.env.PAGE_REVIEW_PORT ?? 47615);
// The extension's ID is pinned by the "key" in extension/manifest.json, so it's the
// same wherever it's loaded from. Other extensions installed in the browser are refused.
const EXTENSION_IDS = (process.env.PAGE_REVIEW_EXTENSION_IDS ?? 'lehkiologlmiimeklbeblhinfkldafmj').split(',');
const ALLOWED_ORIGINS = new Set(EXTENSION_IDS.map((id) => `chrome-extension://${id.trim()}`));
const MAX_BODY = 64 * 1024 * 1024;

export function createReceiver(port) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Only the extension (or local tools without an Origin) may talk to us. The Host
    // check blocks DNS-rebinding pages, whose same-origin GETs carry no Origin header.
    if ((origin && !ALLOWED_ORIGINS.has(origin)) || !allowedHosts.has(req.headers.host)) {
      return send(res, 403, { error: 'forbidden' });
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return send(res, 204);

    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      const match = pathname.match(/^\/reviews\/([^/]+)$/);
      if (req.method === 'GET' && pathname === '/health') {
        return send(res, 200, { ok: true, app: 'page-review', dataDir: DATA_DIR });
      }
      if (req.method === 'GET' && pathname === '/reviews') {
        return send(res, 200, (await listReviews()).map(summary));
      }
      if (req.method === 'PUT' && match) {
        const review = JSON.parse(await readBody(req));
        if (review.id !== match[1]) throw new StoreError(400, 'id in body and URL differ');
        const stored = await saveReview(review);
        return send(res, 200, { ok: true, review: summary(stored) });
      }
      if (req.method === 'DELETE' && match) {
        await deleteReview(match[1]);
        return send(res, 200, { ok: true });
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err instanceof StoreError ? err.status : err instanceof SyntaxError ? 400 : 500;
      if (status === 500) console.error('[page-review]', err);
      if (status === 413) {
        // Answer first, then drop the rest of the upload.
        res.setHeader('connection', 'close');
        res.on('finish', () => req.destroy());
      }
      send(res, status, { error: err.message });
    }
  });
}

// Resolves to 'listening', or 'shared' when another page-review process already owns the port.
export function startReceiver(port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const server = createReceiver(port);
    server.once('listening', () => resolve({ status: 'listening', server }));
    server.once('error', async (err) => {
      if (err.code !== 'EADDRINUSE') return reject(err);
      const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
        .then((r) => r.json())
        .catch(() => null);
      if (health?.app === 'page-review') resolve({ status: 'shared', dataDir: health.dataDir });
      else reject(new Error(`port ${port} is used by another program (set PAGE_REVIEW_PORT)`));
    });
    server.listen(port, '127.0.0.1');
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.removeAllListeners('data');
        req.pause();
        reject(new StoreError(413, 'review too large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  if (body === undefined) return res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
