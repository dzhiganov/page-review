// Server check: receiver security + MCP tools, using a real MCP client over stdio.
// Run: npm run test:server
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-data-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const EXT = 'chrome-extension://lehkiologlmiimeklbeblhinfkldafmj'; // pinned by the manifest key

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'server/mcp.js')],
  env: { ...process.env, PAGE_REVIEW_DIR: dataDir, PAGE_REVIEW_PORT: String(port) },
  stderr: 'pipe',
});
const client = new Client({ name: 'test', version: '0.0.0' });
await client.connect(transport);

try {
  await waitFor(() => fetch(`${base}/health`).then((r) => r.ok).catch(() => false));

  // --- receiver security ---
  const review = sampleReview();
  const put = (headers, body = review) =>
    fetch(`${base}/reviews/${review.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  assert.equal((await put({ origin: 'https://evil.example' })).status, 403, 'web pages are rejected');
  assert.equal((await put({ origin: 'chrome-extension://otherextensionidaaaaaaaaaaaaaaa' })).status, 403, 'other extensions rejected');
  assert.equal((await put({ origin: EXT }, { ...review, createdAt: undefined })).status, 400, 'missing createdAt rejected');
  assert.equal(await statusWithHost(`evil.example:${port}`), 403, 'rebinding host rejected');
  const preflight = await fetch(`${base}/reviews/${review.id}`, {
    method: 'OPTIONS',
    headers: { origin: EXT, 'access-control-request-method': 'PUT' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), EXT);
  assert.equal((await put({ origin: EXT }, { ...review, id: 'other-id' })).status, 400, 'id mismatch rejected');
  assert.equal((await put({ origin: EXT }, { ...review, screenshot: 'nope' })).status, 400, 'bad screenshot rejected');
  const ok = await put({ origin: EXT });
  assert.equal(ok.status, 200, await ok.clone().text());

  const dir = path.join(dataDir, 'reviews', review.id);
  assert.ok(fs.existsSync(path.join(dir, 'screenshot.png')));
  assert.match(fs.readFileSync(path.join(dir, 'review.md'), 'utf8'), /Make font bigger/);

  // --- MCP tools ---
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_review', 'list_reviews', 'set_comment_status']);
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name), ['address-review']);

  const listed = await client.callTool({ name: 'list_reviews', arguments: {} });
  assert.match(listed.content[0].text, new RegExp(`${review.id}.*2/2 open`));

  const got = await client.callTool({ name: 'get_review', arguments: { id: 'latest' } });
  assert.match(got.content[0].text, /Target selector:\*\* `aside\.sidebar > nav`/);
  assert.equal(got.content[1].type, 'image');
  assert.equal(got.content[1].mimeType, 'image/png');

  const set = await client.callTool({
    name: 'set_comment_status',
    arguments: { id: review.id, comment: 1, status: 'resolved', note: 'Sidebar font 13px → 15px' },
  });
  assert.match(set.content[0].text, /now resolved.*Still open: #2/);
  // Parallel status updates must not overwrite each other.
  await Promise.all([
    client.callTool({ name: 'set_comment_status', arguments: { id: review.id, comment: 2, status: 'wontfix', note: 'by design' } }),
    client.callTool({ name: 'set_comment_status', arguments: { id: review.id, comment: 1, status: 'resolved', note: 'Sidebar font 13px → 15px' } }),
  ]);
  const both = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
  assert.deepEqual(both.comments.map((c) => c.status), ['resolved', 'wontfix'], 'no lost update');
  await client.callTool({ name: 'set_comment_status', arguments: { id: review.id, comment: 2, status: 'open' } });
  assert.ok(!fs.existsSync(`${dir}.lock`), 'lock released');

  const bad = await client.callTool({ name: 'set_comment_status', arguments: { id: review.id, comment: 9, status: 'resolved' } });
  assert.equal(bad.isError, true);

  // Status is visible to the extension, and re-sending the review keeps it.
  await put({ origin: EXT });
  const summaries = await (await fetch(`${base}/reviews`, { headers: { origin: EXT } })).json();
  assert.equal(summaries[0].comments[0].status, 'resolved');
  assert.equal(summaries[0].comments[0].note, 'Sidebar font 13px → 15px');
  assert.equal(summaries[0].open, 1);
  assert.match(fs.readFileSync(path.join(dir, 'review.md'), 'utf8'), /\*\*Status:\*\* resolved: Sidebar font/);

  const openOnly = await client.callTool({ name: 'list_reviews', arguments: { status: 'open' } });
  assert.match(openOnly.content[0].text, /1\/2 open/);

  // Delete.
  assert.equal((await fetch(`${base}/reviews/${review.id}`, { method: 'DELETE', headers: { origin: EXT } })).status, 200);
  const empty = await client.callTool({ name: 'list_reviews', arguments: { status: 'all' } });
  assert.match(empty.content[0].text, /No reviews found/);

  console.log('SERVER OK');
} finally {
  await client.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

function sampleReview() {
  // 1×1 PNG
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const target = (selector, text) => ({
    selector,
    tag: 'nav',
    id: null,
    classes: [],
    role: null,
    ariaLabel: null,
    text,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    styles: { 'font-size': '13px' },
    ancestors: ['aside.sidebar'],
    html: '<nav>…</nav>',
  });
  return {
    id: 'mx1abc-test',
    url: 'http://localhost:3000/',
    title: 'Fixture',
    createdAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    comments: [
      { n: 1, text: 'Make font bigger', kind: 'arrow', region: {}, badge: { x: 0, y: 0 }, shapeIds: [], target: target('aside.sidebar > nav', 'Recents') },
      { n: 2, text: 'Wrong color', kind: 'box', region: {}, badge: { x: 0, y: 0 }, shapeIds: [], target: target('#buy', 'Buy') },
    ],
    shapes: [],
    screenshot: `data:image/png;base64,${png}`,
  };
}

// fetch() drops custom Host headers, so use http.request for the DNS-rebinding check.
function statusWithHost(host) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/reviews', headers: { host } }, (res) => resolve(res.statusCode)).on('error', reject);
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timed out waiting for receiver');
}
