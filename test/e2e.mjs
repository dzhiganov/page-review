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
  // Prefs saved by builds that had the Smooth checkbox must not matter any more.
  await sw.evaluate(() => chrome.storage.local.set({ editorPrefs: { smooth: true } }));
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
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/notes.js', 'lib/arrows.js', 'content.js'] });
    }, pageUrl);
  await inject();
  await page.waitForSelector('page-review-overlay');

  const drag = async (from, to) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 12 });
    await page.mouse.up();
  };

  // 1) Arrow from empty space to the sidebar nav: a comment opens at the tail right away.
  const nav = await page.locator('aside nav a').nth(2).boundingBox();
  await drag([560, 520], [nav.x + 40, nav.y + nav.height / 2]);
  await page.locator('page-review-overlay .note-card textarea').waitFor();
  await page.keyboard.type('Make font bigger');
  await page.keyboard.press('Enter');

  // 2) Box around the buy button: its comment opens at the box's corner.
  const buy = await page.locator('#buy').boundingBox();
  await page.keyboard.press('r');
  await drag([buy.x - 6, buy.y - 6], [buy.x + buy.width + 6, buy.y + buy.height + 6]);
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
  // Freehand stays as drawn: no smoothing, no Smooth checkbox.
  assert.equal(await page.locator('page-review-overlay .toolbar input[type="checkbox"]').count(), 0);
  const ringPath = await page.locator('page-review-overlay g[data-type="pen"] path').nth(1).getAttribute('d');
  assert.ok((ringPath.match(/Q/g) ?? []).length >= 30, 'pen stroke keeps its points');
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
  // The comment typed right after the arrow is attached to it and has the default font.
  const fontNote = review.shapes.find((sh) => sh.type === 'text' && sh.text === 'Make font bigger');
  assert.ok(review.shapes.some((sh) => sh.id === fontNote.mark && sh.type === 'arrow'), 'comment attached to its arrow');
  assert.deepEqual(fontNote.font, { family: 'sans', size: 14, weight: 400, color: '#1e1e1e' });
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
    await page.keyboard.press('Escape'); // no comment for this one
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
  await page.keyboard.type('Arrow stops short');
  await page.keyboard.press('Enter');
  const api = await page.locator('.card').nth(2).boundingBox();
  await page.keyboard.press('r');
  await drag([api.x - 6, api.y - 6], [api.x + api.width + 6, api.y + api.height + 6]);
  await page.keyboard.press('Escape'); // skip the automatic comment, write one by hand further away
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

  // Editing: clicking a comment with the Comment tool edits it (not a new one), and so does a
  // double-click with the Select tool.
  await inject(); // close (saved)
  await page.waitForSelector('page-review-overlay', { state: 'detached' });
  await inject();
  await page.waitForSelector('page-review-overlay');
  const overlay = (sel) => page.locator(`page-review-overlay ${sel}`);
  await page.keyboard.press('t');
  await page.mouse.click(700, 600);
  await page.keyboard.type('Edit me');
  await page.keyboard.press('Enter');
  const editCard = await overlay('.note-card').boundingBox();
  await page.mouse.click(editCard.x + editCard.width / 2, editCard.y + editCard.height / 2);
  assert.equal(await overlay('.note-card textarea').inputValue(), 'Edit me', 'Comment tool click edits the comment');
  await page.keyboard.type(' please');
  await page.keyboard.press('Enter');
  assert.deepEqual(await overlay('.note-card .text').allTextContents(), ['Edit me please']);
  await page.keyboard.press('v');
  await page.mouse.dblclick(editCard.x + editCard.width / 2, editCard.y + editCard.height / 2);
  assert.equal(await overlay('.note-card textarea').inputValue(), 'Edit me please', 'double-click edits');
  await page.keyboard.press('Escape');

  // A fresh auto-comment's bar is aligned straight away (while the card is still scaling in)
  // and after its animation, without typing anything.
  const barOnOpen = async () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => {
            const root = document.querySelector('page-review-overlay').shadowRoot;
            const card = root.querySelector('.note-card.editing');
            const bar = root.querySelector('.note-tools').getBoundingClientRect();
            resolve({ card: card.offsetLeft, bar: bar.left, animating: card.getAnimations().length > 0 });
          }),
        ),
    );
  await page.keyboard.press('a');
  await drag([300, 700], [520, 640]);
  const early = await barOnOpen();
  assert.ok(Math.abs(early.bar - early.card) < 0.6, `aligned on open: ${JSON.stringify(early)}`);
  await page.waitForTimeout(300);
  const settled = await barOnOpen();
  const cardBox = await overlay('.note-card.editing').boundingBox();
  assert.ok(Math.abs(settled.bar - cardBox.x) < 0.6, `aligned after the animation: ${JSON.stringify([settled, cardBox.x])}`);
  await page.keyboard.press('Control+z'); // close the empty comment and drop the arrow
  await page.keyboard.press('v');

  // The style bar is left-aligned with the card, 12px away, for narrow and wide cards alike.
  // Expected: below the card (above only without room), 12px gap, left-aligned unless that
  // would run off the window (8px margin), never overlapping the card.
  const barCheck = async (card) => {
    await card.locator('.text').click();
    const [c, b] = [await card.boundingBox(), await overlay('.note-tools').boundingBox()];
    const vp = page.viewportSize();
    const roomBelow = c.y + c.height + 12 + b.height <= vp.height - 8;
    const gap = roomBelow ? b.y - (c.y + c.height) : c.y - (b.y + b.height);
    assert.ok(roomBelow ? b.y > c.y : b.y < c.y, `below unless no room: ${JSON.stringify([c, b])}`);
    assert.ok(Math.abs(gap - 12) < 0.6, `12px gap, got ${gap}`);
    const expectedX = Math.max(8, Math.min(c.x, vp.width - 8 - b.width));
    assert.ok(Math.abs(b.x - expectedX) < 0.6, `left edge: card ${c.x}, bar ${b.x}, expected ${expectedX}`);
    assert.ok(b.x + b.width <= vp.width - 8 + 0.5, 'inside the window');
    await page.keyboard.press('Escape');
    return [c.width, b.width, { shifted: b.x < c.x - 0.5, above: !roomBelow }];
  };
  const [narrow, barW] = await barCheck(overlay('.note-card').filter({ hasText: 'Edit me please' }));
  assert.ok(narrow < barW, 'a card narrower than the bar');
  await page.keyboard.press('t');
  await page.mouse.click(300, 560);
  await page.keyboard.type('A much wider comment card, long enough to wrap onto a second line of text');
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await barCheck(overlay('.note-card').filter({ hasText: 'A much wider comment' }));
  await page.keyboard.press('Control+z'); // drop it again, the checks below count cards
  // Near the right edge (the bar shifts left just enough) and near the bottom (it flips above).
  for (const [x, y, text] of [[1250, 420, 'Right edge'], [620, 785, 'Bottom edge']]) {
    await page.keyboard.press('t');
    await page.mouse.click(x, y);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await page.keyboard.press('v');
    const [, , how] = await barCheck(overlay('.note-card').filter({ hasText: text }));
    assert.deepEqual(how, text === 'Right edge' ? { shifted: true, above: false } : { shifted: false, above: true }, text);
    await page.keyboard.press('Control+z');
  }

  // Undo/redo right after drawing an arrow: the empty comment closes and the arrow goes.
  await page.keyboard.press('a');
  await drag([300, 650], [450, 560]);
  assert.equal(await overlay('.note-card textarea').count(), 1);
  await page.keyboard.press('Control+z');
  assert.equal(await overlay('.note-card textarea').count(), 0, 'undo closes the empty comment');
  assert.equal(await overlay('g[data-type="arrow"]').count(), 0, 'undo removes the arrow');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await overlay('g[data-type="arrow"]').count(), 1, 'redo brings the arrow back');
  assert.equal(await overlay('.note-card').count(), 1, 'no empty comment left');

  // Arrows are drawn with a gentle bend; the selected arrow's midpoint handle straightens it.
  const arrowD = () => overlay('g[data-type="arrow"] path').nth(1).getAttribute('d');
  const [x1, y1, qx, qy, x2, y2] = (await arrowD()).match(/^M(\S+) (\S+) Q(\S+) (\S+) (\S+) (\S+)/).slice(1).map(Number);
  const mid = [(x1 + 2 * qx + x2) / 4, (y1 + 2 * qy + y2) / 4];
  await page.keyboard.press('v');
  await page.mouse.click(...mid); // on the curve: selects the arrow
  const handle = await overlay('[data-handle="bend"]').boundingBox();
  assert.ok(Math.abs(handle.x + handle.width / 2 - mid[0]) < 2 && Math.abs(handle.y + handle.height / 2 - mid[1]) < 2, 'handle at the curve midpoint');
  await drag(mid, [(x1 + x2) / 2, (y1 + y2) / 2]); // onto the straight line
  assert.doesNotMatch(await arrowD(), /Q/, 'dragged flat: straight');
  await page.keyboard.press('Control+z');
  assert.match(await arrowD(), /Q/, 'one undo restores the bend');

  // Dragging a comment takes its arrow's tail along (head stays put), as one undo step.
  await page.keyboard.press('Escape'); // deselect
  await page.keyboard.press('a');
  await drag([800, 650], [1000, 520]);
  await page.keyboard.type('Follow me');
  await page.keyboard.press('Enter');
  const follow = overlay('.note-card').filter({ hasText: 'Follow me' });
  const followArrow = overlay('g[data-type="arrow"] path').nth(3);
  const ends = async () => (await followArrow.getAttribute('d')).match(/^M(\S+) (\S+) Q\S+ \S+ (\S+) (\S+)/).slice(1).map(Number);
  const [t0x, t0y, h0x, h0y] = await ends();
  const fb = await follow.boundingBox();
  await page.keyboard.press('v');
  await drag([fb.x + fb.width / 2, fb.y + fb.height / 2], [fb.x + fb.width / 2 + 60, fb.y + fb.height / 2 + 40]);
  const [t1x, t1y, h1x, h1y] = await ends();
  // The path's shaft ends at the head's apex, half a stroke before the endpoint, along the
  // tangent: so it may turn a little about the fixed endpoint, but never by more than a stroke.
  assert.ok(Math.hypot(h1x - h0x, h1y - h0y) <= 3.01, 'arrow head stays on its target');
  // The tail sits just outside the moved card, aimed along its tangent at the card's centre.
  const fc = await follow.boundingBox();
  const [qx1, qy1] = (await followArrow.getAttribute('d')).match(/ Q(\S+) (\S+)/).slice(1).map(Number);
  const [ox, oy] = [fc.x + fc.width / 2, fc.y + fc.height / 2];
  const off = Math.abs((qx1 - t1x) * (oy - t1y) - (qy1 - t1y) * (ox - t1x)) / Math.hypot(qx1 - t1x, qy1 - t1y);
  assert.ok(off < 1.5, `tangent at the tail passes through the card centre (off by ${off})`);
  const gapX = Math.max(fc.x - t1x, 0, t1x - (fc.x + fc.width));
  const gapY = Math.max(fc.y - t1y, 0, t1y - (fc.y + fc.height));
  assert.ok(Math.hypot(gapX, gapY) > 1 && Math.hypot(gapX, gapY) <= 6.5, `tail just outside the card: ${[gapX, gapY]}`);
  assert.ok(Math.hypot(t1x - t0x - 60, t1y - t0y - 40) < 25, 'tail moved with the comment');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await ends(), [t0x, t0y, h0x, h0y], 'one undo puts the arrow back');
  assert.ok(Math.abs((await follow.boundingBox()).x - fb.x) < 1, 'and the comment');

  // Copy image: what Save would capture goes to the clipboard as a PNG; no review is stored,
  // the editor stays open and the outlines/handles are not in it.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(pageUrl).origin });
  const reviewsBefore = (await storedReviews()).length;
  const copyBtn = overlay('[data-action="copy"]');
  assert.equal(await copyBtn.getAttribute('aria-label'), 'Copy image');
  await copyBtn.click();
  await overlay('.toast').filter({ hasText: 'Screenshot copied.' }).waitFor();
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const blob = await item.getType('image/png');
    const bmp = await createImageBitmap(blob);
    return { types: item.types, size: blob.size, w: bmp.width, h: bmp.height };
  });
  assert.deepEqual(copied.types, ['image/png']);
  assert.deepEqual([copied.w, copied.h], [1280, 800], 'the visible tab, full size');
  assert.ok(copied.size > 5000, 'a real screenshot');
  assert.equal((await storedReviews()).length, reviewsBefore, 'no review saved');
  assert.equal(await overlay('.toolbar').isVisible(), true, 'still editing');
  assert.equal(await page.locator('page-review-overlay.capturing').count(), 0);

  // Show elements: off by default; on, linked elements stay outlined and the one under the
  // cursor gets an outline too, with any tool. Remembered across sessions.
  const outlines = overlay('.outlines .outline');
  const toggle = overlay('[data-action="outlines"]');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show elements');
  assert.equal(await outlines.count(), 0, 'off by default');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(100);
  const linked = await overlay('.outlines .outline span').allTextContents();
  assert.deepEqual(linked, ['main'], 'the element the marks point at, once'); // all marks so far land on <main>
  const buyBtn = await page.locator('#buy').boundingBox();
  await page.keyboard.press('v');
  await page.mouse.move(buyBtn.x + 10, buyBtn.y + 10);
  await page.waitForTimeout(100);
  assert.ok((await overlay('.outlines .outline span').allTextContents()).includes('button#buy'), 'hovered element outlined');
  await page.mouse.move(5, 795); // off the button
  await page.waitForTimeout(100);
  assert.ok(!(await overlay('.outlines .outline span').allTextContents()).includes('button#buy'), 'hover outline follows the cursor');
  // Outlines sit below comment cards and arrows, and a badge under a card moves to another corner.
  assert.ok(
    await page.evaluate(() => {
      const root = document.querySelector('page-review-overlay').shadowRoot;
      return !!(root.querySelector('.outlines').compareDocumentPosition(root.querySelector('.stage')) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
    'outlines are painted before (below) the drawings and cards',
  );
  await page.keyboard.press('t');
  await page.mouse.click(buyBtn.x + 4, buyBtn.y - 2); // the card grows up-right, over the button's badge spot
  await page.keyboard.type('Covers the badge');
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await page.mouse.move(buyBtn.x + buyBtn.width - 6, buyBtn.y + buyBtn.height - 6);
  await page.waitForTimeout(100);
  const clash = await page.evaluate(() => {
    const root = document.querySelector('page-review-overlay').shadowRoot;
    const label = [...root.querySelectorAll('.outline span')].find((s) => s.textContent === 'button#buy');
    if (!label) return 'no badge';
    const r = label.getBoundingClientRect();
    return [...root.querySelectorAll('.note-card')].some((c) => {
      const b = c.getBoundingClientRect();
      return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
    });
  });
  assert.equal(clash, false, 'badge moved off the comment card');
  await page.screenshot({ path: path.join(outDir, '5-badge-avoids-card.png') });
  assert.deepEqual(await sw.evaluate(async () => (await chrome.storage.local.get('editorPrefs')).editorPrefs), { smooth: true, outlines: true }, 'saved, old keys kept');
  await page.evaluate(() => document.querySelector('page-review-overlay').classList.add('capturing'));
  assert.equal(await overlay('.outlines').evaluate((el) => getComputedStyle(el).display), 'none', 'never in the screenshot');
  await page.evaluate(() => document.querySelector('page-review-overlay').classList.remove('capturing'));
  page.once('dialog', (d) => d.accept());
  await inject(); // close (unsaved: confirm)
  await page.waitForSelector('page-review-overlay', { state: 'detached' });
  await inject();
  await page.waitForSelector('page-review-overlay');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('page-review-overlay [data-action="outlines"]').getAttribute('aria-pressed'), 'true', 'remembered');
  await page.locator('page-review-overlay [data-action="outlines"]').click(); // off again
  assert.equal((await sw.evaluate(async () => (await chrome.storage.local.get('editorPrefs')).editorPrefs)).outlines, false);
  await inject(); // close (nothing drawn)
  await page.waitForSelector('page-review-overlay', { state: 'detached' });

  // Moving marks with the Select tool: an arrow by its curve (its comment comes along), a box
  // from inside, a freehand stroke by its line, arrow ends and box corners by their handles.
  // Each drag is one undo step; drawing tools still draw over marks.
  await inject();
  await page.waitForSelector('page-review-overlay');
  const shapeBox = (type) => overlay(`g[data-type="${type}"]`).first().boundingBox();
  const curveMid = async () => {
    const d = await overlay('g[data-type="arrow"] path').nth(1).getAttribute('d');
    const [x1, y1, qx, qy, x2, y2] = d.match(/^M(\S+) (\S+) Q(\S+) (\S+) (\S+) (\S+)/).slice(1).map(Number);
    return [(x1 + 2 * qx + x2) / 4, (y1 + 2 * qy + y2) / 4];
  };
  await page.keyboard.press('a');
  await drag([500, 650], [800, 500]);
  await page.keyboard.type('Moves with its arrow');
  await page.keyboard.press('Enter');
  await page.keyboard.press('r');
  await drag([900, 550], [1100, 700]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await drag([350, 720], [650, 730]);
  await page.keyboard.press('v');
  const noteBefore = await overlay('.note-card').boundingBox();
  const [a0, r0, p0] = [await shapeBox('arrow'), await shapeBox('rect'), await shapeBox('pen')];
  const grabAt = await curveMid();
  await drag(grabAt, [grabAt[0] - 40, grabAt[1] - 60]);
  const a1 = await shapeBox('arrow');
  assert.ok(Math.abs(a1.x - a0.x + 40) < 2 && Math.abs(a1.y - a0.y + 60) < 2, `arrow moved: ${JSON.stringify([a0, a1])}`);
  const noteAfter = await overlay('.note-card').boundingBox();
  assert.ok(Math.abs(noteAfter.x - noteBefore.x + 40) < 1 && Math.abs(noteAfter.y - noteBefore.y + 60) < 1, 'its comment came along');
  assert.ok(await overlay('[data-handle="tail"]').isVisible() && await overlay('[data-handle="head"]').isVisible(), 'arrow end handles');
  await drag([1000, 620], [1030, 600]); // inside the box
  const r1 = await shapeBox('rect');
  assert.ok(Math.abs(r1.x - r0.x - 30) < 1 && Math.abs(r1.y - r0.y + 20) < 1, 'box dragged from inside');
  await drag([500, 725], [500, 760]); // on the stroke
  const p1 = await shapeBox('pen');
  assert.ok(Math.abs(p1.y - p0.y - 35) < 1, 'freehand stroke moved');
  // Box corner handle resizes; arrow head handle moves the head only.
  const se = await overlay('[data-handle="se"]').boundingBox().catch(() => null);
  assert.equal(se, null, 'no box handles while the stroke is selected');
  await page.mouse.click(1040, 640); // select the box
  const corner = await overlay('[data-handle="se"]').boundingBox();
  await drag([corner.x + 4.5, corner.y + 4.5], [corner.x + 54.5, corner.y + 24.5]);
  const r2 = await shapeBox('rect');
  assert.ok(Math.abs(r2.width - r1.width - 50) < 1.5 && Math.abs(r2.x - r1.x) < 1, 'box resized from its corner');
  await page.keyboard.press('Control+z');
  assert.ok(Math.abs((await shapeBox('rect')).width - r1.width) < 1, 'one undo per drag');
  await page.keyboard.press('Control+z');
  assert.ok(Math.abs((await shapeBox('pen')).y - p0.y) < 1, 'undo the stroke move');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.ok(Math.abs((await shapeBox('arrow')).x - a0.x) < 1, 'undo the arrow move');
  assert.ok(Math.abs((await overlay('.note-card').boundingBox()).x - noteBefore.x) < 1, 'and its comment');
  // A drawing tool over a mark draws a new one instead of dragging.
  await page.keyboard.press('a');
  await drag([1000, 620], [1150, 520]);
  await page.keyboard.press('Escape');
  assert.equal(await overlay('g[data-type="arrow"]').count(), 2, 'arrow drawn from inside the box');
  assert.ok(Math.abs((await shapeBox('rect')).x - r0.x) < 1, 'box not moved by the arrow tool');
  page.once('dialog', (d) => d.accept());
  await inject();
  await page.waitForSelector('page-review-overlay', { state: 'detached' });

  // Combine: drag one screenshot onto another, create a Before / After image from them.
  await reviewsPage.bringToFront();
  await reviewsPage.reload();
  const reviewCards = reviewsPage.locator('article.review');
  await reviewCards.nth(1).waitFor();
  const reviewCount = await reviewCards.count();
  await reviewCards.nth(0).locator('.shot').dragTo(reviewCards.nth(1).locator('.shot'));
  await reviewsPage.locator('dialog.compose[open]').waitFor();
  assert.equal(await reviewsPage.locator('#tplSelect option:checked').textContent(), 'Before / After');
  await reviewsPage.click('#composeCreate');
  await reviewsPage.locator('#toast').filter({ hasText: 'Combined image created' }).waitFor();
  await reviewsPage.locator('article.review .meta').filter({ hasText: 'Combined from 2 reviews' }).waitFor();
  assert.equal(await reviewCards.count(), reviewCount + 1);
  const combined = (await storedReviews()).find((r) => r.composite);
  assert.deepEqual(combined.composite.sources.map((s) => s.label), ['Before', 'After']);
  assert.ok(combined.composite.sources[0].createdAt <= combined.composite.sources[1].createdAt, 'older one is Before');
  fs.writeFileSync(path.join(outDir, '5-combined.png'), Buffer.from(combined.screenshot.split(',')[1], 'base64'));

  console.log(`E2E OK (AGENT_SYNC=${AGENT}): see ${path.relative(root, outDir) || 'test/out'}/`);
} finally {
  await context.close();
  server.close();
  receiver.server?.close();
}
