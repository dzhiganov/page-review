// Builds the Chrome Web Store upload, dist/page-review-<version>.zip, then checks it: the zip
// is unpacked to a temp folder, loaded in Chromium, and a review is drawn, saved and found on
// the reviews page. Run: npm run build:store
//
// The zip holds only what the extension loads: the "key" field is removed from the manifest
// (it pins the ID of unpacked dev builds; the store assigns its own), and source maps, dotfiles
// and anything outside extension/ (tests, scripts, docs, server) are left out.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, root } from './browser.mjs';

const src = path.join(root, 'extension');
const SHIPPED = /\.(js|html|css|png|json)$/;
// Fixed timestamps (2026-01-01 00:00) keep the zip byte-identical for the same sources.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
delete manifest.key;

const files = listFiles(src)
  .filter((rel) => SHIPPED.test(rel) && !rel.endsWith('.map') && !rel.split('/').some((p) => p.startsWith('.')))
  .sort();
const entries = files.map((rel) => ({
  name: rel,
  data: rel === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : fs.readFileSync(path.join(src, rel)),
}));

const out = path.join(root, 'dist', `page-review-${manifest.version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, makeZip(entries));
console.log(`Wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB, ${entries.length} files)`);

// --- Check the zip ---------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-store-'));
try {
  const unpacked = path.join(tmp, 'ext');
  for (const { name, data } of readZip(fs.readFileSync(out))) {
    fs.mkdirSync(path.dirname(path.join(unpacked, name)), { recursive: true });
    fs.writeFileSync(path.join(unpacked, name), data);
  }
  const shipped = JSON.parse(fs.readFileSync(path.join(unpacked, 'manifest.json'), 'utf8'));
  assert.equal(shipped.key, undefined, 'no "key" in the store manifest');
  for (const icon of Object.values(shipped.icons)) assert.ok(fs.existsSync(path.join(unpacked, icon)), `icon ${icon}`);
  assert.ok(!files.some((f) => /(^|\/)(test|scripts|docs|server)\//.test(f)), 'nothing outside the extension');
  await smokeTest(unpacked);
  console.log('Store zip checked: loads in Chromium, overlay opens, comment added, saved, reviews page lists it.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function smokeTest(extensionDir) {
  const { context, sw, extId, page, openOverlay, close } = await launch({ extensionDir, grantOptional: false });
  try {
    // Downloads is an optional permission: not granted until the user picks it in Settings.
    assert.equal(await sw.evaluate(() => typeof chrome.downloads), 'undefined', 'downloads API needs the optional permission');
    await openOverlay();
    await page.keyboard.press('t');
    await page.mouse.click(700, 300);
    await page.locator('page-review-overlay .note-card textarea').waitFor();
    await page.keyboard.type('Smoke test comment');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+s');
    await page.locator('page-review-overlay .toast').filter({ hasText: 'Saved' }).waitFor();
    const stored = await sw.evaluate(async () => Object.values(await chrome.storage.local.get(null)).filter((v) => v?.comments));
    assert.equal(stored.length, 1, 'one review stored');
    assert.match(stored[0].screenshot, /^data:image\/png;base64,/);
    assert.equal(stored[0].comments[0].text, 'Smoke test comment');

    const reviews = await context.newPage();
    const errors = [];
    reviews.on('pageerror', (err) => errors.push(err.message));
    await reviews.goto(`chrome-extension://${extId}/reviews.html`);
    await reviews.locator('article.review').first().waitFor();
    assert.equal(await reviews.locator('article.review').count(), 1);
    await reviews.goto(`chrome-extension://${extId}/reviews.html#settings`);
    await reviews.locator('#settings input[value="browser"]:checked').waitFor();
    assert.deepEqual(errors, [], 'no errors on the reviews page');
  } finally {
    await close();
  }
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

// --- Minimal zip writer and reader (deflate, no zip64), so the build needs no zip tool ---

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(zlib.crc32(data), crc, `CRC of ${name}`);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
