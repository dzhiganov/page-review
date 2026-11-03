// Regenerates the README screenshots in docs/screenshots/ by driving the real
// extension in Chromium against docs/demo/index.html. Run: npm run screenshots
// (npm run gifs records the GIFs in docs/gifs/.)
import fs from 'node:fs';
import path from 'node:path';
import { launch, root, VIEWPORT } from './browser.mjs';

const outDir = process.env.OUT_DIR ?? path.join(root, 'docs/screenshots');
fs.mkdirSync(outDir, { recursive: true });

const { context, sw, extId, page, openOverlay, closeOverlay, close } = await launch();

try {
  const overlay = (sel) => page.locator(`page-review-overlay ${sel}`);
  const box = (sel) => page.locator(sel).first().boundingBox();
  const shot = (name, clip, p = page) =>
    p.screenshot({ path: path.join(outDir, `${name}.png`), ...(clip ? { clip } : {}) });
  const drag = async (from, to, steps = 16) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps });
    await page.mouse.up();
  };
  const freehand = async (points) => {
    await page.mouse.move(...points[0]);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(...p);
    await page.mouse.up();
  };
  // Arrows and boxes open a comment of their own: type into it.
  const say = async (text) => {
    await overlay('.note-card textarea').waitFor();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  const comment = async (x, y, text) => {
    await page.keyboard.press('t');
    await page.mouse.click(x, y);
    await say(text);
  };
  const save = async () => {
    await page.keyboard.press('Control+s');
    await overlay('.toast').filter({ hasText: 'Saved' }).waitFor();
  };
  const hideToast = () =>
    page.evaluate(() => {
      const t = document.querySelector('page-review-overlay')?.shadowRoot.querySelector('.toast');
      if (t) t.hidden = true;
    });
  const settle = async () => {
    await page.waitForTimeout(2500); // let the element hints fade
    await hideToast();
  };
  // Moves a comment card to the right of the "Book a demo" button.
  const besideGhost = async (text) => {
    await page.keyboard.press('v');
    const card = await overlay('.note-card').filter({ hasText: text }).boundingBox();
    const g = await box('.btn.ghost');
    await drag([card.x + card.width / 2, card.y + card.height / 2], [g.x + g.width + 30 + card.width / 2, g.y + g.height / 2]);
  };
  const scrollTo = (id) => page.evaluate((id) => scrollTo(0, document.getElementById(id).offsetTop - 40), id);

  // --- Hero: a page mid-review ---------------------------------------------------
  await openOverlay();
  await hideToast();
  const h1 = await box('h1');
  await page.keyboard.press('a');
  await drag([140, 560], [h1.x + 196, h1.y + h1.height - 26]);
  await say('Headline wraps to three lines. Can we shorten it?');

  const cta = await box('.btn.primary');
  await page.keyboard.press('r');
  await drag([cta.x - 8, cta.y - 8], [cta.x + cta.width + 8, cta.y + cta.height + 8]);
  await say('Use the brand indigo here, not green');
  await besideGhost('brand indigo'); // off the subtitle: the comment stays about the box
  await page.keyboard.press('Escape');

  await page.keyboard.press('3'); // blue
  const odd = await box('.ic.odd');
  await page.keyboard.press('a');
  await drag([odd.x + 190, odd.y + 12], [odd.x + odd.width + 6, odd.y + odd.height / 2]);
  await say('Different icon style');

  const headings = page.locator('.feature h3');
  const live = await headings.nth(0).boundingBox();
  const sharing = await headings.nth(2).boundingBox();
  await page.keyboard.press('s');
  await page.mouse.click(live.x + 160, live.y + live.height / 2);
  await say('Click Live dashboards');
  await page.mouse.click(sharing.x + 130, sharing.y + sharing.height / 2);
  await say('Go back, click Team sharing');
  await page.keyboard.press('1');
  await page.keyboard.press('v');
  await page.mouse.move(5, VIEWPORT.height - 5);
  await settle();
  await shot('hero');

  // --- Comment style bar: one comment selected ------------------------------------------
  const card = overlay('.note-card').filter({ hasText: 'Use the brand indigo' });
  await card.locator('.text').click();
  await overlay('.note-tools [data-note="bold"]').click();
  await page.waitForTimeout(300);
  const c = await card.boundingBox();
  const bar = await overlay('.note-tools').boundingBox();
  const pad = 24;
  const x0 = Math.min(c.x, bar.x) - pad;
  const y0 = Math.min(c.y, bar.y) - pad;
  const x1 = Math.max(c.x + c.width, bar.x + bar.width) + pad;
  const y1 = Math.max(c.y + c.height, bar.y + bar.height) + pad;
  await shot('comment-style', { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  await page.keyboard.press('Escape');

  // --- Show elements: outlines and tag badges ------------------------------------
  await overlay('[data-action="outlines"]').click();
  const sharingCard = await page.locator('.feature').nth(2).boundingBox();
  await page.mouse.move(sharingCard.x + sharingCard.width - 40, sharingCard.y + 14);
  await page.waitForTimeout(300);
  const row = await box('.features');
  const bottom = Math.min(row.y + row.height + 16, VIEWPORT.height - 6); // above the overlay's frame line
  await shot('show-elements', { x: row.x - 24, y: row.y - 22, width: row.width + 48, height: bottom - row.y + 22 });
  await overlay('[data-action="outlines"]').click();
  await save();
  await closeOverlay();

  // --- More reviews for the reviews page ---------------------------------------------
  // Features: a grey underline under a typo.
  await scrollTo('features');
  await openOverlay();
  const typo = await page.locator('.feature p').first().boundingBox();
  await page.keyboard.press('5'); // grey
  await page.keyboard.press('p');
  await freehand(Array.from({ length: 30 }, (_, i) => [typo.x + 76 + i * 3.1, typo.y + typo.height + 2 + Math.sin(i / 2) * 1.2]));
  await comment(typo.x + 60, typo.y + typo.height + 64, 'Typo: "analitics"');
  await page.keyboard.press('1');
  await save();
  await closeOverlay();

  // Pricing: a box around the plan to highlight.
  await scrollTo('pricing');
  await openOverlay();
  const pro = await page.locator('.plan').nth(1).boundingBox();
  await page.keyboard.press('r');
  await drag([pro.x - 10, pro.y - 10], [pro.x + pro.width + 10, pro.y + pro.height + 10]);
  await say('Highlight Pro, it is the plan we want people to pick');
  await save();
  await closeOverlay();

  // Before and after a fix, framed to the hero, to combine on the reviews page.
  const FRAME = [[180, 140], [1260, 560]];
  const framedReview = async (marks) => {
    await page.evaluate(() => scrollTo(0, 0));
    await openOverlay();
    await page.keyboard.press('f');
    await drag(...FRAME);
    await marks();
    await save();
    await closeOverlay();
  };
  await framedReview(async () => {
    const h = await box('h1');
    await page.keyboard.press('a');
    await drag([200, 400], [h.x + 196, h.y + h.height - 26]);
    await say('Three lines is too long');
    const b = await box('.btn.primary');
    await page.keyboard.press('r');
    await drag([b.x - 8, b.y - 8], [b.x + b.width + 8, b.y + b.height + 8]);
    await say('Use the brand indigo here');
    await besideGhost('brand indigo');
  });
  const fix = await page.addStyleTag({ content: '.btn.primary { background: #4f46e5 !important; }' });
  await page.evaluate(() => (document.querySelector('h1').textContent = 'Analytics your whole team understands'));
  await framedReview(async () => {
    await page.keyboard.press('4'); // green
    const b = await box('.btn.primary');
    await page.keyboard.press('r');
    await drag([b.x - 8, b.y - 8], [b.x + b.width + 8, b.y + b.height + 8]);
    await say('Looks right now');
    await besideGhost('Looks right');
    await page.keyboard.press('1');
  });
  await fix.evaluate((el) => el.remove());
  await page.reload();

  // The oldest review moves to yesterday, to show the day groups.
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

  // --- Reviews page: combine the before and after -----------------------------------------
  const reviews = await context.newPage();
  await reviews.goto(`chrome-extension://${extId}/reviews.html`);
  const cards = reviews.locator('article.review');
  await cards.nth(4).waitFor();
  await cards.nth(0).locator('.shot').dragTo(cards.nth(1).locator('.shot'));
  await reviews.locator('dialog.compose[open]').waitFor();
  await reviews.waitForTimeout(500);
  const dialog = await reviews.locator('dialog.compose').boundingBox();
  await shot('combine', dialog, reviews);
  await reviews.click('#composeCreate');
  await reviews.locator('#toast').filter({ hasText: 'Combined image created' }).waitFor();
  const composite = await sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.values(all).find((r) => r?.composite)?.screenshot;
  });
  fs.writeFileSync(path.join(outDir, 'combined.png'), Buffer.from(composite.split(',')[1], 'base64'));
  await reviews.locator('#toast').waitFor({ state: 'hidden' });
  await reviews.evaluate(() => scrollTo(0, 0));
  await reviews.waitForTimeout(300);
  await shot('reviews', null, reviews);

  // --- Settings -------------------------------------------------------------------
  await reviews.goto(`chrome-extension://${extId}/reviews.html#settings`);
  await reviews.locator('#settings input[value="downloads"]').check();
  await reviews.waitForTimeout(500);
  // Document coordinates: checking the radio scrolled the page.
  const panels = await reviews.evaluate(() => {
    const all = [...document.querySelectorAll('#settings .panel')].map((el) => el.getBoundingClientRect());
    const [first, last] = [all[0], all.at(-1)];
    return { x: first.left + scrollX, y: first.top + scrollY, width: first.width, height: last.bottom - first.top };
  });
  await reviews.screenshot({
    path: path.join(outDir, 'settings.png'),
    fullPage: true,
    clip: { x: panels.x - 24, y: panels.y - 24, width: panels.width + 48, height: panels.height + 48 },
  });
  console.log(`Screenshots written to ${outDir}`);
} finally {
  await close();
}
