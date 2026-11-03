// Shared setup for the README media scripts (screenshots.mjs, gifs.mjs): Chromium with the
// extension loaded, the demo page from docs/demo/ served on port 4311, and helpers to
// open the overlay and set a demo avatar.
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const VIEWPORT = { width: 1440, height: 900 };
const PORT = 4311;

// Options: `extensionDir` loads another build (the unpacked store zip) instead of extension/;
// `viewport` and `deviceScaleFactor` change the window (the store screenshots are 1280×800).
export async function launch({ extensionDir = path.join(root, 'extension'), viewport = VIEWPORT, deviceScaleFactor = 2 } = {}) {
  // Copy of the extension with host access, so the script can inject without a toolbar click.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-media-'));
  const ext = path.join(tmp, 'ext');
  fs.cpSync(extensionDir, ext, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

  const demo = fs.readFileSync(path.join(root, 'docs/demo/index.html'));
  const server = http.createServer((_, res) => res.end(demo));
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const pageUrl = `http://localhost:${PORT}/`;

  const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium',
    headless: true,
    viewport,
    deviceScaleFactor,
    colorScheme: 'light',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(pageUrl).origin });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.bringToFront();

  const toggleOverlay = () =>
    sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/notes.js', 'lib/arrows.js', 'lib/frame.js', 'lib/label.js', 'content.js'] });
    }, pageUrl);
  const openOverlay = async () => {
    await toggleOverlay();
    await page.waitForSelector('page-review-overlay');
  };
  const closeOverlay = async () => {
    const discard = (d) => d.accept(); // "Discard unsaved annotations?"
    page.on('dialog', discard);
    await toggleOverlay();
    await page.waitForSelector('page-review-overlay', { state: 'detached' });
    page.off('dialog', discard);
  };

  // A made-up avatar (initials on a gradient), drawn here so no photo is needed.
  const avatar = await page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#f59f00');
    grad.addColorStop(1, '#e8590c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#fff';
    g.font = '600 54px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('AK', 64, 68);
    return c.toDataURL('image/png');
  });
  await sw.evaluate((a) => chrome.storage.local.set({ settings: { avatar: a } }), avatar);

  const close = async () => {
    await context.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { context, sw, extId, page, pageUrl, tmp, openOverlay, closeOverlay, close };
}
