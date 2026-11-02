// Unit tests: composition layout, templates and settings persistence, agent instructions.
// Run: npm run test:unit
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, test } from 'node:test';

// chrome.storage.local stand-in, before the modules that use it are loaded.
let store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (key == null) return structuredClone(store);
        const keys = Array.isArray(key) ? key : [key];
        return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
      },
      async set(items) {
        Object.assign(store, structuredClone(items));
      },
    },
  },
};

const { layoutComposition, compositeReview, luminance } = await import('../extension/lib/compose.js');
const templates = await import('../extension/lib/templates.js');
const settings = await import('../extension/lib/settings.js');
const { agentInstructions, wslPath } = await import('../extension/lib/agent.js');
const { rootOf, reviewPaths, storedReview } = await import('../extension/lib/storage.js');
const { toMarkdown } = await import('../extension/lib/format.js');

const { BUILT_IN_TEMPLATES, normalizeTemplate } = templates;
const builtIn = (id) => normalizeTemplate(BUILT_IN_TEMPLATES.find((t) => t.id === id));
const measure = (text, size) => text.length * size * 0.6;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner, outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

beforeEach(() => {
  store = {};
});

describe('layoutComposition', () => {
  test('Before / After: two images side by side, labels above, arrow between', () => {
    const t = builtIn('before-after');
    const l = layoutComposition(t, [{ w: 1280, h: 800 }, { w: 1280, h: 800 }], measure);
    const [a, b] = l.panels;
    assert.equal(l.unit, 1);
    assert.equal(a.image.y, b.image.y, 'same row');
    assert.equal(a.image.h, 800);
    assert.ok(a.image.x + a.image.w < b.image.x, 'left to right, no overlap');
    assert.equal(a.image.x, t.padding, 'outer padding');
    assert.equal(l.width, b.image.x + b.image.w + t.padding);
    assert.equal(l.height, b.image.y + b.image.h + t.padding);
    for (const p of l.panels) {
      assert.ok(p.label.y + p.label.h <= p.image.y, 'label above its image');
      assert.ok(Math.abs(p.label.x + p.label.w / 2 - (p.image.x + p.image.w / 2)) <= 1, 'label centered');
    }
    assert.deepEqual(
      l.panels.map((p) => p.label.text),
      ['Before', 'After'],
    );
    assert.equal(l.connectors.length, 1);
    const [arrow] = l.connectors;
    assert.equal(arrow.type, 'arrow');
    assert.ok(arrow.x1 > a.image.x + a.image.w && arrow.x2 < b.image.x, 'arrow sits in the gap');
    assert.equal(arrow.y1, a.image.y + 400, 'arrow at mid height');
  });

  test('Desktop / Mobile: different sizes get the same height, labels below', () => {
    const l = layoutComposition(builtIn('desktop-mobile'), [{ w: 2880, h: 1800 }, { w: 1170, h: 2532 }], measure);
    const [desk, mob] = l.panels;
    assert.equal(desk.image.h, 1800);
    assert.equal(mob.image.h, 1800);
    assert.equal(mob.image.w, Math.round((1170 * 1800) / 2532), 'aspect ratio kept');
    assert.equal(l.unit, 2880 / 1280, 'sizes scale with the images');
    for (const p of l.panels) assert.ok(p.label.y >= p.image.y + p.image.h, 'label below');
    assert.equal(l.connectors.length, 0);
    assert.ok(l.height >= desk.label.y + desk.label.h);
  });

  test('three in a row: arrows between each pair', () => {
    const l = layoutComposition(builtIn('steps'), Array(3).fill({ w: 1280, h: 800 }), measure);
    assert.equal(l.panels.length, 3);
    assert.equal(l.connectors.filter((c) => c.type === 'arrow').length, 2);
    for (let i = 1; i < 3; i++) assert.ok(!overlaps(l.panels[i - 1].image, l.panels[i].image));
  });

  test('2×2 grid: two rows of two, labels on the images', () => {
    const l = layoutComposition(builtIn('grid'), Array(4).fill({ w: 1280, h: 800 }), measure);
    const [a, b, c, d] = l.panels.map((p) => p.image);
    assert.equal(a.y, b.y);
    assert.equal(c.y, d.y);
    assert.equal(a.x, c.x);
    assert.ok(c.y > a.y + a.h, 'second row below the first');
    for (const p of l.panels) assert.ok(inside(p.label, p.image), 'inside label stays on its image');
    for (const [i, p] of l.panels.entries()) for (const q of l.panels.slice(i + 1)) assert.ok(!overlaps(p.image, q.image));
  });

  test('grid divider draws a cross; arrows are not offered in a grid', () => {
    const t = normalizeTemplate({ ...builtIn('grid'), connector: 'divider' });
    const l = layoutComposition(t, Array(4).fill({ w: 1000, h: 1000 }), measure);
    assert.equal(l.connectors.length, 2);
    assert.equal(normalizeTemplate({ ...builtIn('grid'), connector: 'arrow' }).connector, 'none');
  });

  test('no labels: no extra room for them', () => {
    const t = normalizeTemplate({ ...builtIn('before-after'), labelPosition: 'none', connector: 'none', padding: 0 });
    const l = layoutComposition(t, [{ w: 1280, h: 800 }, { w: 1280, h: 800 }], measure);
    assert.equal(l.height, 800);
    assert.ok(l.panels.every((p) => p.label === null));
  });

  test('wrong number of images is an error', () => {
    assert.throws(() => layoutComposition(builtIn('steps'), [{ w: 10, h: 10 }], measure), /needs 3 images/);
  });

  test('tiny images are scaled up, huge ones down', () => {
    const small = layoutComposition(builtIn('before-after'), [{ w: 200, h: 100 }, { w: 200, h: 100 }], measure);
    assert.equal(small.panels[0].image.h, 480);
    const big = layoutComposition(builtIn('before-after'), [{ w: 8000, h: 5000 }, { w: 8000, h: 5000 }], measure);
    assert.equal(big.panels[0].image.h, 2400);
  });

  test('every built-in lays out with its own image count', () => {
    for (const raw of BUILT_IN_TEMPLATES) {
      const t = normalizeTemplate(raw);
      assert.equal(t.labels.length, t.count, t.name);
      const l = layoutComposition(t, Array(t.count).fill({ w: 1440, h: 900 }), measure);
      for (const p of l.panels) assert.ok(inside(p.image, { x: 0, y: 0, w: l.width, h: l.height }), t.name);
    }
  });
});

describe('templates', () => {
  test('normalizeTemplate fixes bad input', () => {
    const t = normalizeTemplate({ count: 7, padding: 999, background: 'red', labels: [{ text: 5 }], labelPosition: 'left' });
    assert.equal(t.count, 2);
    assert.equal(t.padding, 160);
    assert.equal(t.background, '#ffffff');
    assert.equal(t.labelPosition, 'above');
    assert.deepEqual(t.labels, [
      { text: '', color: '#18181b' },
      { text: '', color: '#18181b' },
    ]);
  });

  test('user presets persist next to the built-ins', async () => {
    const base = builtIn('before-after');
    const saved = await templates.saveUserTemplate({ ...base, name: 'Release notes', background: '#000000' });
    assert.equal(saved.builtIn, false);
    assert.match(saved.id, /^user-/);
    const all = await templates.allTemplates();
    assert.equal(all.length, BUILT_IN_TEMPLATES.length + 1);
    assert.equal(all.at(-1).name, 'Release notes');
    assert.equal(all.at(-1).background, '#000000');
    assert.ok(!('builtIn' in store.templates[0]), 'builtIn is not stored');

    // Same name (any case) replaces it; a new name adds one.
    await templates.saveUserTemplate({ ...base, name: 'release notes', padding: 8 });
    await templates.saveUserTemplate({ ...base, name: 'Other' });
    const mine = await templates.loadUserTemplates();
    assert.deepEqual(
      mine.map((t) => [t.name, t.padding]),
      [
        ['release notes', 8],
        ['Other', base.padding],
      ],
    );
    assert.equal(mine[0].id, saved.id, 'kept its id');

    await templates.deleteUserTemplate(saved.id);
    assert.deepEqual((await templates.loadUserTemplates()).map((t) => t.name), ['Other']);
    assert.equal((await templates.allTemplates()).filter((t) => t.builtIn).length, BUILT_IN_TEMPLATES.length);
  });
});

describe('settings', () => {
  test('defaults when nothing is stored', async () => {
    assert.deepEqual(await settings.getSettings(), settings.DEFAULTS);
  });

  test('updates merge and persist', async () => {
    await settings.updateSettings({ storage: 'downloads', downloadsFolder: 'reviews/page' });
    await settings.updateSettings({ avatar: 'data:image/png;base64,AAAA' });
    assert.deepEqual(store.settings, {
      ...settings.DEFAULTS,
      storage: 'downloads',
      downloadsFolder: 'reviews/page',
      avatar: 'data:image/png;base64,AAAA',
    });
    assert.equal((await settings.getSettings()).storage, 'downloads');
    await settings.updateSettings({ avatar: null });
    assert.equal((await settings.getSettings()).avatar, null);
  });

  test('keeps settings stored by older versions (serverUrl only)', async () => {
    store.settings = { serverUrl: 'http://localhost:5000' };
    const s = await settings.getSettings();
    assert.equal(s.serverUrl, 'http://localhost:5000');
    assert.equal(s.storage, 'browser');
  });

  test('rejects invalid values', async () => {
    const s = await settings.updateSettings({
      storage: 'cloud',
      serverUrl: 'https://example.com',
      avatar: 'javascript:alert(1)',
      downloadsFolder: '../../etc',
    });
    assert.equal(s.storage, 'browser');
    assert.equal(s.serverUrl, settings.DEFAULT_SERVER_URL);
    assert.equal(s.avatar, null);
    assert.equal(s.downloadsFolder, 'etc');
  });

  test('folder names are safe for chrome.downloads', () => {
    assert.equal(settings.cleanFolder(' /Page Review/ shots. '), 'Page Review/shots');
    assert.equal(settings.cleanFolder('a\\b:c*'), 'a/bc');
    assert.equal(settings.cleanFolder('..'), '');
    assert.equal(settings.normalizeSettings({ downloadsFolder: '..' }).downloadsFolder, 'page-review');
  });

  test('server sync follows the setting or the flag', () => {
    assert.equal(settings.sendsToServer({ storage: 'server' }), true);
    assert.equal(settings.sendsToServer({ storage: 'downloads' }), false);
    assert.equal(settings.sendsToServer({ storage: 'browser' }, true), true);
  });
});

describe('combined item', () => {
  const sources = [
    { id: 'aaa1-x', title: 'Old', url: 'http://localhost:3000/', createdAt: '2026-11-01T10:00:00Z', comments: [{ n: 1, text: 'Too big', target: { selector: 'h1' } }] },
    { id: 'aaa2-y', title: 'New', url: 'http://localhost:3000/', createdAt: '2026-11-02T10:00:00Z', comments: [] },
  ];
  const item = compositeReview({
    id: 'mx9-abcd',
    template: builtIn('before-after'),
    sources,
    screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    width: 100,
    height: 50,
  });

  test('is shaped like a review', () => {
    assert.equal(item.title, 'Before / After');
    assert.deepEqual(item.comments, []);
    assert.deepEqual(item.viewport, { width: 100, height: 50, devicePixelRatio: 1 });
    assert.deepEqual(
      item.composite.sources.map((s) => s.label),
      ['Before', 'After'],
    );
    assert.deepEqual(item.composite.sources[0].comments, [{ n: 1, text: 'Too big', selector: 'h1' }]);
  });

  test('Markdown lists the panels', () => {
    const md = toMarkdown(item, '/tmp/x/screenshot.png');
    assert.match(md, /^# Combined image: Before \/ After/);
    assert.match(md, /## Panel 1: Before/);
    assert.match(md, /\*\*#1:\*\* Too big \(`h1`\)/);
    assert.match(md, /`\/tmp\/x\/screenshot.png`/);
  });

  test('the local server accepts it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-review-unit-'));
    process.env.PAGE_REVIEW_DIR = dir;
    try {
      const serverStore = await import('../server/store.js');
      await serverStore.saveReview(item);
      const back = await serverStore.readReview(item.id);
      assert.equal(back.composite.template, 'Before / After');
      assert.ok(fs.existsSync(path.join(dir, 'reviews', item.id, 'screenshot.png')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('downloads layout matches the server', () => {
    assert.deepEqual(reviewPaths('page-review', 'mx9-abcd'), {
      dir: 'page-review/reviews/mx9-abcd',
      screenshot: 'page-review/reviews/mx9-abcd/screenshot.png',
      json: 'page-review/reviews/mx9-abcd/review.json',
      md: 'page-review/reviews/mx9-abcd/review.md',
    });
    assert.equal(storedReview(item).screenshot, 'screenshot.png');
    assert.equal(rootOf('/home/u/Downloads/pr/reviews/mx9-abcd/screenshot.png', 'mx9-abcd'), '/home/u/Downloads/pr');
    assert.equal(rootOf('C:\\Users\\u\\Downloads\\pr\\reviews\\mx9-abcd\\screenshot.png', 'mx9-abcd'), 'C:\\Users\\u\\Downloads\\pr');
    assert.equal(rootOf('/somewhere/else.png', 'mx9-abcd'), null);
  });
});

describe('agent instructions', () => {
  test('skill format: frontmatter, then where the files are', () => {
    const md = agentInstructions({ format: 'skill', storage: 'downloads', root: '/home/u/Downloads/page-review' });
    assert.match(md, /^---\nname: page-review\ndescription: .+\n---\n/);
    assert.match(md, /`\/home\/u\/Downloads\/page-review\/reviews`/);
    assert.match(md, /review\.json/);
    assert.match(md, /How comments map to elements/);
    assert.doesNotMatch(md, /set_comment_status/);
  });

  test('unknown downloads path says so', () => {
    const md = agentInstructions({ storage: 'downloads', rootGuess: '~/Downloads/shots', folder: 'shots' });
    assert.match(md, /`~\/Downloads\/shots\/reviews`/);
    assert.match(md, /look for the `shots` folder/);
  });

  test('Windows path gets its WSL equivalent', () => {
    const md = agentInstructions({ storage: 'downloads', root: 'C:\\Users\\dima\\Downloads\\page-review' });
    assert.match(md, /`C:\\Users\\dima\\Downloads\\page-review\\reviews`/);
    assert.match(md, /`\/mnt\/c\/Users\/dima\/Downloads\/page-review\/reviews`/);
    assert.equal(wslPath('/home/x'), null);
  });

  test('server mode mentions the MCP tools and statuses', () => {
    const md = agentInstructions({ storage: 'server', root: '/home/u/.page-review' });
    assert.match(md, /`\/home\/u\/.page-review\/reviews`/);
    assert.match(md, /set_comment_status/);
  });

  test('browser only: ask the user to paste, no paths', () => {
    const md = agentInstructions({ format: 'prompt', storage: 'browser' });
    assert.doesNotMatch(md, /^---/);
    assert.match(md, /Copy as Markdown/);
    assert.doesNotMatch(md, /reviews\/<id>\//);
  });
});

test('luminance', () => {
  assert.ok(luminance('#ffffff') > 0.99);
  assert.ok(luminance('#000000') < 0.01);
});
