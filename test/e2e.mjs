// End-to-end check: load the extension in Chromium, annotate the fixture page, save,
// then use the reviews page. Runs with the AGENT_SYNC flag off (default) or on:
//   node test/e2e.mjs              # product as shipped
//   AGENT_SYNC=1 node test/e2e.mjs # plus the Claude Code (MCP server) hand-off
// Screenshots land in test/out/ (test/out/agent/ for the flagged run).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const AGENT = process.env.AGENT_SYNC === '1';
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'test/out', AGENT ? 'agent' : '');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// Test copy of the extension with host access, so the test can inject without a real toolbar click.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-'));
const ext = path.join(tmp, 'ext');
fs.cpSync(path.join(root, 'extension'), ext, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
const flagsFile = path.join(ext, 'lib/flags.js');
fs.writeFileSync(flagsFile, fs.readFileSync(flagsFile, 'utf8').replace(/AGENT_SYNC = \w+/, `AGENT_SYNC = ${AGENT}`));

// Agent-side receiver on a private port and data dir (env must be set before importing the store).
process.env.PAGE_REVIEW_DIR = path.join(tmp, 'data');
const receiverPort = await new Promise((resolve) => {
  const s = http.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const { startReceiver } = await import('../server/http.js');
const store = await import('../server/store.js');
// With the flag off the receiver still runs, to prove the extension never calls it.
let receiver = await startReceiver(receiverPort);

const fixture = fs.readFileSync(path.join(root, 'test/fixture.html'));
const server = http.createServer((_, res) => res.end(fixture)).listen(0);
const pageUrl = `http://127.0.0.1:${server.address().port}/`;

const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  assert.equal(extId, 'lehkiologlmiimeklbeblhinfkldafmj', 'extension id is pinned by the manifest key');
  await sw.evaluate((url) => chrome.storage.local.set({ settings: { serverUrl: url } }), `http://localhost:${receiverPort}`);
  const storedReviews = async () => {
    const all = await sw.evaluate(() => chrome.storage.local.get(null));
    return Object.entries(all)
      .filter(([k]) => k.startsWith('review:'))
      .map(([, v]) => v)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };
  const saved = (n) => (AGENT ? `Saved ${n} and sent to Claude.` : `Saved ${n}.`);

  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.bringToFront();
  const inject = () =>
    sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }, pageUrl);
  await inject();
  await page.waitForSelector('page-review-overlay');

  const drag = async (from, to) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 12 });
    await page.mouse.up();
  };

  // 1) Arrow from empty space to the sidebar nav, note at the tail.
  const nav = await page.locator('aside nav a').nth(2).boundingBox();
  await drag([560, 520], [nav.x + 40, nav.y + nav.height / 2]);
  await page.keyboard.press('t');
  await page.mouse.click(570, 530);
  await page.keyboard.type('Make font bigger');
  await page.keyboard.press('Enter');

  // 2) Box around the buy button, note right next to it.
  const buy = await page.locator('#buy').boundingBox();
  await page.keyboard.press('r');
  await drag([buy.x - 6, buy.y - 6], [buy.x + buy.width + 6, buy.y + buy.height + 6]);
  await page.keyboard.press('t');
  await page.mouse.click(buy.x + buy.width + 30, buy.y);
  await page.keyboard.type('Use brand purple here');
  await page.keyboard.press('Enter');

  // 3) Freehand circle around the second card, no text.
  const card = await page.locator('.card').nth(1).boundingBox();
  await page.keyboard.press('p');
  const cx = card.x + card.width / 2;
  const cy = card.y + card.height / 2;
  const pts = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 39) * Math.PI * 2;
    return [cx + Math.cos(a) * (card.width / 2 + 8), cy + Math.sin(a) * (card.height / 2 + 8)];
  });
  await page.mouse.move(...pts[0]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...p);
  await page.mouse.up();

  // Comments are Figma-style cards.
  const cards = page.locator('page-review-overlay .note-card');
  assert.equal(await cards.count(), 2);
  const box = (loc) => loc.boundingBox();
  const near = (a, b, dx, dy) => Math.abs(a.x - b.x - dx) < 2 && Math.abs(a.y - b.y - dy) < 2;

  // 1) Move: drag a card with the Select tool, then drag the circle.
  const noteCard = cards.filter({ hasText: 'Make font bigger' });
  const before = await box(noteCard);
  await page.keyboard.press('v');
  const grab = [before.x + before.width / 2, before.y + before.height / 2];
  await drag(grab, [grab[0] + 60, grab[1] + 40]);
  const moved = await box(noteCard);
  assert.ok(near(moved, before, 60, 40), `card moved: ${JSON.stringify([before, moved])}`);
  const ringEl = page.locator('page-review-overlay g[data-type="pen"]');
  const ringBefore = await box(ringEl);
  await drag([pts[10][0], pts[10][1]], [pts[10][0] + 30, pts[10][1]]);
  assert.ok(near(await box(ringEl), ringBefore, 30, 0), 'circle moved');

  // 3) Undo / redo: Ctrl+Z, Ctrl+Shift+Z, Cmd+Z, Ctrl+Y.
  await page.keyboard.press('Control+z');
  assert.ok(near(await box(ringEl), ringBefore, 0, 0), 'undo circle move');
  await page.keyboard.press('Control+z');
  assert.ok(near(await box(noteCard), before, 0, 0), 'undo card move');
  await page.keyboard.press('Control+Shift+z');
  assert.ok(near(await box(noteCard), before, 60, 40), 'redo card move');
  await page.keyboard.press('Meta+z');
  assert.ok(near(await box(noteCard), before, 0, 0), 'Cmd+Z undo');
  // Russian layout: the Z key reports key "я" but code "KeyZ".
  const shapeCount = await page.locator('page-review-overlay [data-id]').count();
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true })),
  );
  assert.equal(await page.locator('page-review-overlay [data-id]').count(), shapeCount - 1, 'Ctrl+Z with RU layout');
  await page.keyboard.press('Control+y');
  assert.equal(await page.locator('page-review-overlay [data-id]').count(), shapeCount, 'Ctrl+Y redo');
  await page.keyboard.press('Escape'); // deselect only, overlay stays open
  assert.equal(await page.locator('page-review-overlay').count(), 1);

  await page.screenshot({ path: path.join(outDir, '1-overlay.png') });

  await page.keyboard.press('Control+s');
  await page.locator('page-review-overlay .toast').filter({ hasText: saved('3 comments') }).waitFor();

  const reviews = await storedReviews();
  assert.equal(reviews.length, 1, 'one review stored');
  const review = reviews[0];
  assert.match(review.screenshot, /^data:image\/png;base64,/);
  fs.writeFileSync(path.join(outDir, '2-captured.png'), Buffer.from(review.screenshot.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(outDir, 'review.json'), JSON.stringify({ ...review, screenshot: '…' }, null, 2));

  const byText = (t) => review.comments.find((c) => c.text === t);
  const font = byText('Make font bigger');
  assert.ok(font, 'arrow comment exists');
  assert.equal(font.kind, 'arrow');
  assert.equal(font.target.text, 'Frontend');
  const brand = byText('Use brand purple here');
  assert.ok(brand, 'box comment exists');
  assert.equal(brand.kind, 'box');
  assert.equal(brand.target.selector, '#buy');
  const circled = review.comments.find((c) => c.kind === 'freehand');
  assert.ok(circled, 'freehand comment exists');
  assert.equal(circled.text, '');
  assert.equal(circled.target.text, 'Monorepositories');
  assert.equal(review.comments.length, 3);

  // Overlay still open after save; a second injection toggles it off (saved, so no confirm).
  assert.equal(await page.locator('page-review-overlay').count(), 1);
  await inject();
  await page.waitForSelector('page-review-overlay', { state: 'detached' });

  if (AGENT) {
    // The receiver stored it; the "agent" resolves the arrow comment.
    const [onServer] = await store.listReviews();
    assert.equal(onServer.id, review.id, 'review reached the agent server');
    assert.ok(fs.existsSync(store.screenshotPath(review.id)));
    await store.setCommentStatus(review.id, font.n, 'resolved', 'Sidebar links 13px → 15px');
  } else {
    assert.equal((await store.listReviews()).length, 0, 'flag off: nothing sent to the server');
  }

  // An older review, to check the day headers.
  await sw.evaluate((r) => chrome.storage.local.set({ [`review:${r.id}`]: r }), {
    ...review,
    id: 'older-review',
    title: 'Yesterday page',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  });

  // Reviews page: day groups, compact cards, two copy buttons.
  const reviewsPage = await context.newPage();
  reviewsPage.on('pageerror', (err) => console.error('[reviews page]', err.message));
  reviewsPage.on('console', (msg) => msg.type() === 'error' && console.error('[reviews page]', msg.text()));
  await reviewsPage.goto(`chrome-extension://${extId}/reviews.html`);
  await reviewsPage.locator('article.review').first().waitFor();
  assert.deepEqual(await reviewsPage.locator('h2.day').allTextContents(), ['Today', 'Yesterday']);
  const firstCard = reviewsPage.locator('article.review').first();
  assert.deepEqual(await firstCard.locator('.actions button').allTextContents(), ['Copy as image', 'Copy as Markdown']);
  assert.equal(await reviewsPage.locator('article.review li').count(), 0, 'no comment list');
  if (AGENT) {
    await reviewsPage.locator('.server.online').waitFor();
    await firstCard.locator('.sync.sent').filter({ hasText: '2 of 3 open' }).waitFor();
  } else {
    assert.ok(await reviewsPage.locator('#server').isHidden(), 'flag off: no Claude status');
    assert.equal(await reviewsPage.locator('.sync').count(), 0);
  }
  await reviewsPage.screenshot({ path: path.join(outDir, '3-reviews-page.png'), fullPage: true });

  // Copy as Markdown (Playwright can't grant clipboard-read to extension origins, so record it).
  await reviewsPage.evaluate(() => {
    navigator.clipboard.writeText = async (text) => void (window.__copied = text);
  });
  await firstCard.getByRole('button', { name: 'Copy as Markdown' }).click();
  await reviewsPage.locator('#toast').filter({ hasText: 'Markdown copied' }).waitFor();
  const md = await reviewsPage.evaluate(() => window.__copied);
  fs.writeFileSync(path.join(outDir, 'review.md'), md);
  assert.match(md, /> Make font bigger/);
  assert.match(md, /Target selector:\*\* `#buy`/);
  assert.match(md, /annotated screenshot, shared separately/);

  // Delete (with confirm).
  reviewsPage.once('dialog', (d) => d.accept());
  await reviewsPage.locator('article.review').filter({ hasText: 'Yesterday page' }).getByRole('button', { name: 'Delete review' }).click();
  await reviewsPage.locator('h2.day').filter({ hasText: 'Yesterday' }).waitFor({ state: 'detached' });
  assert.equal(await reviewsPage.locator('article.review').count(), 1);

  if (AGENT) {
    // Saving with no Claude Code session open: stored locally, delivered later without user action.
    receiver.server.close();
    receiver.server.closeAllConnections();
    await page.bringToFront();
    await inject();
    await page.waitForSelector('page-review-overlay');
    await page.keyboard.press('a');
    await drag([700, 600], [400, 300]);
    await page.keyboard.press('Control+s');
    await page.locator('page-review-overlay .toast').filter({ hasText: 'once a Claude Code session is open' }).waitFor();
    assert.equal((await store.listReviews()).length, 1, 'offline save did not reach the server');

    receiver = await startReceiver(receiverPort); // a Claude Code session starts
    const sent = await sw.evaluate(() => globalThis.syncPending()); // what the 30s alarm does
    assert.equal(sent, 1, 'pending review synced');
    assert.equal((await store.listReviews()).length, 2, 'offline review delivered');
    const first = await store.readReview(review.id);
    assert.equal(first.comments.find((c) => c.n === font.n).status, 'resolved', 'statuses survive');
    await inject(); // close (saved, so no confirm)
    await page.waitForSelector('page-review-overlay', { state: 'detached' });
  }

  // Several marks meaning one thing (circle + underline + arrow into the circle, note near
  // the right edge) become one comment, and the card stays on screen.
  await page.bringToFront();
  await inject();
  await page.waitForSelector('page-review-overlay');
  const h1 = await page.locator('h1').boundingBox();
  await page.keyboard.press('p');
  const ring = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 47) * Math.PI * 2;
    return [h1.x + h1.width / 2 + Math.cos(a) * (h1.width / 2 + 20), h1.y + h1.height / 2 + Math.sin(a) * (h1.height / 2 + 14)];
  });
  await page.mouse.move(...ring[0]);
  await page.mouse.down();
  for (const p of ring.slice(1)) await page.mouse.move(...p);
  await page.mouse.up();
  await drag([h1.x, h1.y + h1.height + 4], [h1.x + h1.width, h1.y + h1.height + 6]); // underline
  await page.keyboard.press('a');
  await drag([1200, 420], [h1.x + h1.width + 10, h1.y + h1.height + 8]);
  await page.keyboard.press('t');
  await page.mouse.click(1210, 430);
  await page.keyboard.type('can we make the title a bit smaller and less heavy please');
  await page.keyboard.press('Enter');
  await page.screenshot({ path: path.join(outDir, '4-grouped.png') });
  await page.keyboard.press('Control+s');
  await page.locator('page-review-overlay .toast').filter({ hasText: saved('1 comment') }).waitFor();

  const grouped = (await storedReviews())[0];
  assert.equal(grouped.comments.length, 1, `one comment, got ${JSON.stringify(grouped.comments.map((c) => c.marks))}`);
  assert.deepEqual([...grouped.comments[0].marks].sort(), ['arrow', 'pen', 'pen']);
  assert.equal(grouped.comments[0].target.tag, 'h1');
  assert.match(grouped.comments[0].text, /can we make the title/);
  const note = grouped.shapes.find((sh) => sh.type === 'text');
  assert.ok(note.x + note.w <= 1280 - 10, `note fits on screen (right edge ${note.x + note.w})`);
  if (!AGENT) assert.equal((await store.listReviews()).length, 0, 'flag off: still nothing sent');

  // Linking: an arrow that stops just short of a button still targets the button, and a
  // comment written right after a box belongs to it even ~110px away.
  await inject(); // close (saved)
  await page.waitForSelector('page-review-overlay', { state: 'detached' });
  await inject();
  await page.waitForSelector('page-review-overlay');
  const buyBox = await page.locator('#buy').boundingBox();
  const tip = [buyBox.x + buyBox.width + 5, buyBox.y + buyBox.height / 2];
  await page.keyboard.press('a');
  await drag([tip[0] + 200, tip[1] + 60], tip);
  await page.keyboard.press('t');
  await page.mouse.click(tip[0] + 205, tip[1] + 75);
  await page.keyboard.type('Arrow stops short');
  await page.keyboard.press('Enter');
  const api = await page.locator('.card').nth(2).boundingBox();
  await page.keyboard.press('r');
  await drag([api.x - 6, api.y - 6], [api.x + api.width + 6, api.y + api.height + 6]);
  await page.keyboard.press('t');
  await page.mouse.click(api.x + 20, api.y + api.height + 150);
  await page.keyboard.type('Far from its box');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+s');
  await page.locator('page-review-overlay .toast').filter({ hasText: saved('2 comments') }).waitFor();
  const linking = (await storedReviews())[0];
  const short = linking.comments.find((c) => c.text === 'Arrow stops short');
  assert.equal(short?.target.selector, '#buy', `arrow short of button -> ${short?.target.selector}`);
  const far = linking.comments.find((c) => c.text === 'Far from its box');
  assert.equal(far?.kind, 'box', 'far comment attached to the box drawn before it');
  assert.equal(far.target.text, 'API Layer');

  console.log(`E2E OK (AGENT_SYNC=${AGENT}): see ${path.relative(root, outDir) || 'test/out'}/`);
} finally {
  await context.close();
  server.close();
  receiver.server?.close();
}
