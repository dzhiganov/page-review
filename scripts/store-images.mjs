// Generates the Chrome Web Store images in store/images/ by driving the real extension in
// Chromium against docs/demo/index.html. Run: npm run store-images (needs ffmpeg).
//
//   screenshot-1..5.png  1280×800, 24-bit PNG (no alpha), a caption over the real UI
//   promo-small.png      440×280 small promo tile
//   promo-marquee.png    1400×560 marquee promo tile
//   icon-128.png         128×128 store icon: 96×96 artwork with 16px transparent padding
//
// The demo company's name and the one third-party product name on the page are swapped
// for made-up ones, since store images must not show other brands. On WSL the pages are
// rendered with Segoe UI from the Windows fonts folder, which is what the demo and the
// extension ask for first; elsewhere the system's default sans-serif is used.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const W = 1280;
const H = 800;
const outDir = path.join(path.dirname(import.meta.dirname), 'store/images');
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-store-images-'));
useWindowsFonts();
const { launch, root } = await import('./browser.mjs'); // after the font setup: Chromium inherits the env

const ICON = fs.readFileSync(path.join(root, 'scripts/make-icons.mjs'), 'utf8').match(/<svg[\s\S]*?<\/svg>/)[0];
// The icon without the 4px margin around its rounded square, for the store icon and the tiles.
const ICON_TIGHT = ICON.replace('viewBox="0 0 128 128"', 'viewBox="4 4 120 120"');
const BRAND = '#7048e8';
// The icon in white, for the purple promo tiles.
const ICON_ON_BRAND = ICON_TIGHT.replace('fill="#7048e8"', 'fill="#fff"').replaceAll('stroke="#fff"', `stroke="${BRAND}"`);
const FONT = `"Segoe UI", system-ui, sans-serif`;

const { context, sw, extId, page, openOverlay, closeOverlay, close } = await launch({ viewport: { width: W, height: H } });
const raw = {}; // name -> PNG buffer of a full 1280×800 window (2× pixels)
let agentMarkdown = '';

try {
  await page.evaluate(debrand);
  const overlay = (sel) => page.locator(`page-review-overlay ${sel}`);
  const box = (sel) => page.locator(sel).first().boundingBox();
  const drag = async (from, to, steps = 16) => {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps });
    await page.mouse.up();
  };
  const say = async (text) => {
    await overlay('.note-card textarea').waitFor();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
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
  const besideGhost = async (text) => {
    await page.keyboard.press('v');
    const card = await overlay('.note-card').filter({ hasText: text }).boundingBox();
    const g = await box('.btn.ghost');
    await drag([card.x + card.width / 2, card.y + card.height / 2], [g.x + g.width + 30 + card.width / 2, g.y + g.height / 2]);
  };
  const reload = async () => {
    await page.reload();
    await page.evaluate(debrand);
  };

  // --- 1. A page mid-review ----------------------------------------------------------
  await page.evaluate(() => scrollTo(0, 60));
  await openOverlay();
  await hideToast();
  const h1 = await box('h1');
  await page.keyboard.press('a');
  await drag([150, 520], [h1.x + 170, h1.y + h1.height - 24]);
  await say('Headline wraps to three lines. Can we shorten it?');
  const cta = await box('.btn.primary');
  await page.keyboard.press('r');
  await drag([cta.x - 8, cta.y - 8], [cta.x + cta.width + 8, cta.y + cta.height + 8]);
  await say('Use the brand indigo here, not green');
  await besideGhost('brand indigo');
  await page.keyboard.press('Escape');
  // Step pins on the last letters of the headings, so the cards don't cover the text.
  const [live, sharing] = await page.evaluate(() =>
    [0, 2].map((i) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelectorAll('.feature h3')[i]);
      const r = range.getBoundingClientRect();
      return { x: r.right - 4, y: r.top + r.height / 2 };
    }),
  );
  await page.keyboard.press('s');
  await page.mouse.click(live.x, live.y);
  await say('Click Live dashboards');
  await page.mouse.click(sharing.x, sharing.y);
  await say('Go back, click Team sharing');
  await page.keyboard.press('1');
  await page.keyboard.press('v');
  await page.mouse.move(5, H - 5);
  await settle();
  raw.review = await page.screenshot();

  // --- 2. Show elements -----------------------------------------------------------------
  await overlay('[data-action="outlines"]').click();
  await page.mouse.move(5, H - 5);
  await page.waitForTimeout(300);
  raw.outlines = await page.screenshot();
  await overlay('[data-action="outlines"]').click();

  // --- 3. Copy for agent: the menu open, and the Markdown it copies ------------------------
  await save();
  await settle();
  await overlay('[data-action="copy"]').click();
  await page.waitForTimeout(300);
  raw.copy = await page.screenshot();
  await overlay('[data-copy="agent"]').click();
  await overlay('.toast').filter({ hasText: 'copied' }).waitFor();
  agentMarkdown = await page.evaluate(() => navigator.clipboard.readText());
  await closeOverlay();

  // --- More reviews, for the reviews page ---------------------------------------------------
  await page.evaluate(() => scrollTo(0, document.getElementById('features').offsetTop - 40));
  await openOverlay();
  const typo = await page.locator('.feature p').first().boundingBox();
  await page.keyboard.press('5'); // grey
  await page.keyboard.press('p');
  await drag([typo.x + 70, typo.y + typo.height + 2], [typo.x + 165, typo.y + typo.height + 2], 20);
  await page.keyboard.press('t');
  await page.mouse.click(typo.x + 60, typo.y + typo.height + 64);
  await say('Typo: "analitics"');
  await page.keyboard.press('1');
  await save();
  await closeOverlay();

  await page.evaluate(() => scrollTo(0, document.getElementById('pricing').offsetTop - 40));
  await openOverlay();
  const pro = await page.locator('.plan').nth(1).boundingBox();
  await page.keyboard.press('r');
  await drag([pro.x - 10, pro.y - 10], [pro.x + pro.width + 10, pro.y + pro.height + 10]);
  await say('Highlight Pro, it is the plan we want people to pick');
  await save();
  await closeOverlay();

  // Before and after a fix, framed to the hero.
  const framedReview = async (marks) => {
    await page.evaluate(() => scrollTo(0, 0));
    await openOverlay();
    await page.keyboard.press('f');
    await drag([150, 130], [1130, 520]);
    await marks();
    await save();
    await closeOverlay();
  };
  await framedReview(async () => {
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
  await reload();

  // --- 4 and 5. Reviews page and the Combine dialog -------------------------------------------
  const reviews = await context.newPage();
  await reviews.setViewportSize({ width: W, height: H });
  await reviews.goto(`chrome-extension://${extId}/reviews.html`);
  const cards = reviews.locator('article.review');
  await cards.nth(4).waitFor();
  await reviews.waitForTimeout(500);
  raw.reviews = await reviews.screenshot();
  await cards.nth(0).locator('.shot').dragTo(cards.nth(1).locator('.shot'));
  await reviews.locator('dialog.compose[open]').waitFor();
  await reviews.waitForTimeout(500);
  raw.combine = await reviews.locator('dialog.compose').screenshot();
} finally {
  await close();
}

// --- Compose the store images -------------------------------------------------------------
const { chromium } = await import('playwright');
const browser = await chromium.launch();
try {
  const shots = [
    ['Draw arrows, boxes and comments on any page', frame(raw.review)],
    ['See which element each comment points at', frame(raw.outlines)],
    ['Copy the review as Markdown for your AI agent', frame(raw.copy, markdownPanel(agentMarkdown))],
    ['Saved reviews stay in your browser, grouped by day', frame(raw.reviews)],
    ['Combine screenshots into one image: before and after', card(raw.combine)],
  ];
  for (const [i, [caption, body]] of shots.entries()) {
    await render(`screenshot-${i + 1}.png`, W, H, page1280(caption, body));
  }
  await render('promo-small.png', 440, 280, promoSmall());
  await render('promo-marquee.png', 1400, 560, promoMarquee(raw.review));
  await render('icon-128.png', 128, 128, `<style>body{margin:0;background:transparent}svg{position:absolute;left:16px;top:16px;width:96px;height:96px}</style>${ICON_TIGHT}`, { alpha: true });
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`Store images written to ${path.relative(root, outDir)}/`);

// Renders HTML at the exact size; store screenshots and tiles are flattened to 24-bit RGB.
async function render(name, width, height, html, { alpha = false } = {}) {
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(100);
  const file = path.join(outDir, name);
  await p.screenshot({ path: file, omitBackground: alpha });
  await p.close();
  if (!alpha) {
    const flat = path.join(tmp, name);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-pix_fmt', 'rgb24', flat]);
    fs.copyFileSync(flat, file);
  }
}

function dataUrl(png) {
  return `data:image/png;base64,${png.toString('base64')}`;
}

function page1280(caption, body) {
  return `<style>
    body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #f3f0ff; font-family: ${FONT}; position: relative; }
    h1 { margin: 0; padding-top: 34px; text-align: center; font-size: 32px; font-weight: 600; letter-spacing: -0.01em; color: #1e1b2e; }
  </style><h1>${caption}</h1>${body}`;
}

// The window screenshot at 1120×700, flush with the bottom edge.
function frame(png, extra = '') {
  return `<style>
    .shot { position: absolute; left: 80px; top: 108px; width: 1120px; height: 700px; border-radius: 14px 14px 0 0; overflow: hidden;
      box-shadow: 0 12px 40px rgba(48, 25, 128, 0.18), 0 0 0 1px rgba(48, 25, 128, 0.08); background: #fff; }
    .shot img { width: 100%; height: 100%; display: block; }
  </style><div class="shot"><img src="${dataUrl(png)}"></div>${extra}`;
}

// An element screenshot (the Combine dialog) as a card, centred under the caption.
function card(png) {
  return `<style>
    .card { position: absolute; left: 50%; top: 116px; transform: translateX(-50%); width: 1080px; border-radius: 12px; overflow: hidden;
      box-shadow: 0 12px 40px rgba(48, 25, 128, 0.18), 0 0 0 1px rgba(48, 25, 128, 0.08); }
    .card img { width: 100%; display: block; }
  </style><div class="card"><img src="${dataUrl(png)}"></div>`;
}

function markdownPanel(md) {
  const lines = md
    .split('\n')
    .filter((l) => !/^Screenshot:/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n')
    .slice(0, 18);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = lines.map((l) => (/^#/.test(l) ? `<b>${esc(l)}</b>` : esc(l))).join('\n');
  return `<style>
    .md { position: absolute; right: 56px; bottom: 36px; width: 560px; padding: 22px 26px; border-radius: 14px; background: #18181b; color: #e4e4e7;
      font: 14px/1.6 Consolas, ui-monospace, monospace; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
    .md b { color: #c4b5fd; font-weight: 600; }
  </style><div class="md">${html}</div>`;
}

function promoSmall() {
  return `<style>
    body { margin: 0; width: 440px; height: 280px; overflow: hidden; background: ${BRAND}; font-family: ${FONT}; color: #fff;
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    svg { width: 76px; height: 76px; }
    .name { margin-top: 16px; font-size: 34px; font-weight: 700; letter-spacing: -0.01em; }
    .tag { margin-top: 8px; width: 340px; font-size: 17px; line-height: 1.35; color: #ece6ff; }
  </style>
  ${ICON_ON_BRAND}<div class="name">Page Review</div>
  <div class="tag">Mark up any web page for your AI agent</div>`;
}

function promoMarquee(png) {
  return `<style>
    body { margin: 0; width: 1400px; height: 560px; overflow: hidden; background: ${BRAND}; font-family: ${FONT}; color: #fff; position: relative; }
    .text { position: absolute; left: 80px; top: 150px; width: 470px; }
    .head { display: flex; align-items: center; gap: 18px; }
    .head svg { width: 72px; height: 72px; }
    .name { font-size: 50px; font-weight: 700; letter-spacing: -0.015em; }
    .tag { margin-top: 26px; font-size: 26px; line-height: 1.4; color: #ece6ff; }
    .shot { position: absolute; left: 620px; top: 70px; width: 960px; height: 600px; border-radius: 16px 0 0 0; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
    .shot img { width: 960px; height: 600px; display: block; }
  </style>
  <div class="text"><div class="head">${ICON_ON_BRAND}<span class="name">Page Review</span></div>
  <div class="tag">Draw and comment on any web page, then save the review for your AI agent.</div></div>
  <div class="shot"><img src="${dataUrl(png)}"></div>`;
}

// Runs in the demo page: made-up names instead of the demo's company name and the chat app.
function debrand() {
  const swap = (s) => s.replace(/Northwind/g, 'Tallyfield').replace(/Slack & email/g, 'Chat & email');
  document.title = swap(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) walker.currentNode.nodeValue = swap(walker.currentNode.nodeValue);
}

// Points fontconfig at Segoe UI and Consolas from the Windows fonts folder, when it's there.
function useWindowsFonts() {
  const win = '/mnt/c/Windows/Fonts';
  const want = ['segoeui.ttf', 'segoeuib.ttf', 'seguisb.ttf', 'segoeuil.ttf', 'consola.ttf', 'consolab.ttf'];
  if (!want.every((f) => fs.existsSync(path.join(win, f)))) return;
  const dir = path.join(tmp, 'fonts');
  fs.mkdirSync(dir);
  for (const f of want) fs.copyFileSync(path.join(win, f), path.join(dir, f));
  const conf = path.join(tmp, 'fonts.conf');
  const prefer = (family, font) => `<alias><family>${family}</family><prefer><family>${font}</family></prefer></alias>`;
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${dir}</dir><cachedir>${path.join(tmp, 'fc-cache')}</cachedir>
${prefer('sans-serif', 'Segoe UI')}${prefer('system-ui', 'Segoe UI')}${prefer('monospace', 'Consolas')}${prefer('ui-monospace', 'Consolas')}
</fontconfig>`,
  );
  process.env.FONTCONFIG_FILE = conf;
}
