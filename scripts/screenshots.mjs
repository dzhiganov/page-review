// Regenerates the README screenshots in docs/screenshots/ by driving the real
// extension in Chromium against docs/demo/index.html. Run: npm run screenshots
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });
const VIEWPORT = { width: 1440, height: 900 };

// Copy of the extension with host access, so the script can inject without a toolbar click.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-shots-'));
const ext = path.join(tmp, 'ext');
fs.cpSync(path.join(root, 'extension'), ext, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

const demo = fs.readFileSync(path.join(root, 'docs/demo/index.html'));
const server = http.createServer((_, res) => res.end(demo)).listen(0);
const pageUrl = `http://localhost:${server.address().port}/`;

const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium',
  headless: true,
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'light',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.bringToFront();

  const toggleOverlay = () =>
    sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }, pageUrl);
  const openOverlay = async () => {
    await toggleOverlay();
    await page.waitForSelector('page-review-overlay');
  };
  const closeOverlay = async () => {
    await toggleOverlay();
    await page.waitForSelector('page-review-overlay', { state: 'detached' });
  };
  const box = (sel) => page.locator(sel).first().boundingBox();
  const drag = async (from, to) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 16 });
    await page.mouse.up();
  };
  const freehand = async (points) => {
    await page.mouse.move(...points[0]);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...p);
    await page.mouse.up();
  };
  // A slightly wobbly hand-drawn ellipse around a box.
  const ellipse = (b, padX, padY) =>
    Array.from({ length: 64 }, (_, i) => {
      const a = (i / 60) * Math.PI * 2 - 0.5;
      const wobble = 1 + Math.sin(i * 0.7) * 0.015;
      return [
        b.x + b.width / 2 + Math.cos(a) * (b.width / 2 + padX) * wobble,
        b.y + b.height / 2 + Math.sin(a) * (b.height / 2 + padY) * wobble,
      ];
    });
  const comment = async (x, y, text) => {
    await page.keyboard.press('t');
    await page.mouse.click(x, y);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  const save = async () => {
    await page.keyboard.press('Control+s');
    await page.locator('page-review-overlay .toast').filter({ hasText: 'Saved' }).waitFor();
  };
  const settle = () => page.waitForTimeout(4000); // let element hints and the welcome toast fade

  // --- Review 1: the hero -------------------------------------------------
  await openOverlay();
  const h1 = await box('h1');
  await page.keyboard.press('p');
  await freehand(ellipse(h1, 28, 18));
  await page.keyboard.press('a');
  await drag([150, 470], [h1.x + 10, h1.y + h1.height + 6]);
  await comment(70, 520, 'Headline wraps to two lines. Can we shorten it?');

  const cta = await box('.btn.primary');
  await page.keyboard.press('r');
  await drag([cta.x - 8, cta.y - 8], [cta.x + cta.width + 8, cta.y + cta.height + 8]);
  const ghost = await box('.btn.ghost');
  await comment(ghost.x + ghost.width + 40, ghost.y + ghost.height, 'Use the brand indigo here, not green');

  await page.keyboard.press('3'); // blue
  const odd = await box('.ic.odd');
  await page.keyboard.press('a');
  await drag([odd.x + 150, odd.y + 30], [odd.x + odd.width + 6, odd.y + odd.height / 2]);
  await comment(odd.x + 158, odd.y + 46, 'Different icon style');
  await page.keyboard.press('1');
  await page.keyboard.press('v');
  await settle();
  await page.screenshot({ path: path.join(outDir, 'annotate.png') });
  await save();
  await closeOverlay();

  // --- Review 2: features -------------------------------------------------
  await page.evaluate(() => scrollTo(0, document.getElementById('features').offsetTop - 40));
  await openOverlay();
  const typo = await page.locator('.feature p').first().boundingBox();
  await page.keyboard.press('p');
  await freehand(
    Array.from({ length: 30 }, (_, i) => [typo.x + 76 + i * 3.1, typo.y + typo.height + 2 + Math.sin(i / 2) * 1.2]),
  );
  await comment(typo.x + 60, typo.y + typo.height + 64, 'Typo: "analitics"');
  const sharing = await page.locator('.feature').nth(2).locator('p').boundingBox();
  await page.keyboard.press('r');
  await drag([sharing.x - 8, sharing.y - 6], [sharing.x + sharing.width + 8, sharing.y + sharing.height + 6]);
  await comment(sharing.x + 40, sharing.y + sharing.height + 70, 'Mention the Slack integration here');
  await save();
  await closeOverlay();

  // --- Review 3: pricing --------------------------------------------------
  await page.evaluate(() => scrollTo(0, document.getElementById('pricing').offsetTop - 40));
  await openOverlay();
  const plans = page.locator('.plan');
  const pro = await plans.nth(1).boundingBox();
  await page.keyboard.press('r');
  await drag([pro.x - 10, pro.y - 10], [pro.x + pro.width + 10, pro.y + pro.height + 10]);
  await comment(pro.x + 40, pro.y - 24, 'Highlight Pro, it is the plan we want people to pick');
  const price = await plans.nth(2).locator('.price').boundingBox();
  await page.keyboard.press('a');
  await drag([price.x + 260, price.y + 110], [price.x + 150, price.y + price.height / 2]);
  await comment(price.x + 220, price.y + 160, 'Show the yearly price too');
  await save();
  await closeOverlay();

  // --- Review 4: testimonials -----------------------------------------------
  await page.evaluate(() => scrollTo(0, document.getElementById('customers').offsetTop - 40));
  await openOverlay();
  const quote = await page.locator('.quote').first().boundingBox();
  await page.keyboard.press('p');
  await freehand(ellipse(quote, 22, 18));
  await comment(quote.x + quote.width - 40, quote.y + quote.height + 70, 'Add customer photos and company logos');
  await save();
  await closeOverlay();

  // The first review moves to yesterday, to show the day groups.
  await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const [oldest] = Object.entries(all)
      .filter(([k]) => k.startsWith('review:'))
      .sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt));
    const [key, review] = oldest;
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setHours(16, 42);
    await chrome.storage.local.set({ [key]: { ...review, createdAt: yesterday.toISOString() } });
  });

  // --- Reviews page ---------------------------------------------------------
  const reviews = await context.newPage();
  await reviews.goto(`chrome-extension://${extId}/reviews.html`);
  await reviews.locator('article.review').nth(3).waitFor();
  await reviews.waitForTimeout(300);
  await reviews.screenshot({ path: path.join(outDir, 'reviews.png'), fullPage: true });

  // The Markdown an agent gets, for the README excerpt.
  const all = await sw.evaluate(() => chrome.storage.local.get(null));
  const latestFirst = Object.entries(all)
    .filter(([k]) => k.startsWith('review:'))
    .map(([, v]) => v)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const { toMarkdown } = await import('../extension/lib/format.js');
  const hero = latestFirst.find((r) => r.comments.some((c) => c.text.startsWith('Headline')));
  fs.writeFileSync(path.join(tmp, 'hero.md'), toMarkdown(hero));
  for (const r of latestFirst) {
    console.log(r.comments.map((c) => `  #${c.n} ${c.kind} [${c.marks}] "${c.text}" -> ${c.target?.selector}`).join('\n'));
  }
  fs.writeFileSync(path.join(tmp, 'hero.png'), Buffer.from(hero.screenshot.split(',')[1], 'base64'));
  console.log(`Screenshots written to ${path.relative(root, outDir)}/ (sample Markdown: ${path.join(tmp, 'hero.md')})`);
} finally {
  await context.close();
  server.close();
}
