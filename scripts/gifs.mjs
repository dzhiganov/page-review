// Records the README GIFs in docs/gifs/ by driving the real extension in Chromium against
// docs/demo/index.html. Frames come from the DevTools screencast; a drawn cursor follows the
// mouse (headless Chromium has none). ffmpeg turns each take into a looping GIF.
// Run: npm run gifs (needs ffmpeg on the PATH). Optional: GIFS=arrow,steps to record only some.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, root } from './browser.mjs';

const outDir = process.env.OUT_DIR ?? path.join(root, 'docs/gifs');
fs.mkdirSync(outDir, { recursive: true });
const only = process.env.GIFS?.split(',');
const WIDTH = 800; // GIF width in px
const FPS = 18;

const { context, page, tmp, openOverlay, closeOverlay, close } = await launch();
const cdp = await context.newCDPSession(page);

// ---------- recording ----------

let frames = null; // [{ file, t }] while recording
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  if (!frames) return;
  const file = path.join(tmp, `f${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: metadata.timestamp });
});

// `region`: the part of the 1440×900 viewport to keep, in CSS px. Holds the first frame
// for `lead` seconds and the last for `tail`, so the loop has a calm start and end.
async function record(name, region, act, { lead = 0.6, tail = 1.6 } = {}) {
  if (only && !only.includes(name)) return;
  frames = [];
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  await page.waitForTimeout(400); // at least one frame of the still page
  const first = Math.max(frames.length - 1, 0);
  await act();
  await page.waitForTimeout(200);
  await cdp.send('Page.stopScreencast');
  const taken = frames.slice(first);
  frames = null;
  if (taken.length < 2) throw new Error(`${name}: no frames`);

  // ffmpeg concat list: each frame lasts until the next one (frame timestamps are in seconds).
  const lines = [];
  taken.forEach((f, i) => {
    const hold = i === 0 ? lead : i === taken.length - 1 ? tail : taken[i + 1].t - f.t;
    lines.push(`file '${f.file}'`, `duration ${Math.max(hold, 0.001).toFixed(4)}`);
  });
  lines.push(`file '${taken.at(-1).file}'`); // concat ignores the last duration otherwise
  const list = path.join(tmp, `${name}.txt`);
  fs.writeFileSync(list, lines.join('\n'));

  const { x, y, w, h } = region;
  const crop = `crop=iw*${w}/1440:ih*${h}/900:iw*${x}/1440:ih*${y}/900`;
  const out = path.join(outDir, `${name}.gif`);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${FPS},${crop},scale=${WIDTH}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    '-loop', '0', out,
  ]);
  for (const f of taken) fs.rmSync(f.file);
  const secs = taken.at(-1).t - taken[1].t + lead + tail;
  console.log(`${path.relative(root, out)}: ${secs.toFixed(1)}s, ${taken.length} frames, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
}

// ---------- a visible, eased cursor ----------

let at = [720, 450];
async function showCursor() {
  await page.evaluate(([x, y]) => {
    document.getElementById('demo-cursor')?.remove();
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML =
      '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.6 15.2 L17.5 15.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(${x - 2}px,${y - 2}px);transition:scale .08s;transform-origin:2px 2px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.3))`;
    document.documentElement.appendChild(c); // after the overlay: drawn on top of it
    addEventListener('mousemove', (e) => (c.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`), true);
    addEventListener('mousedown', () => (c.style.scale = '0.86'), true);
    addEventListener('mouseup', () => (c.style.scale = '1'), true);
  }, at);
  await page.mouse.move(...at);
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// Paced by the clock, not by step count: each mouse event takes a while to go through.
async function moveTo(x, y, ms = 650) {
  const [x0, y0] = at;
  const start = Date.now();
  for (let t = 0; t < 1; ) {
    t = Math.min(1, (Date.now() - start) / ms);
    const k = ease(t);
    await page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k);
    await page.waitForTimeout(8);
  }
  at = [x, y];
}
async function dragTo(from, to, ms = 700) {
  await moveTo(...from);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await moveTo(...to, ms);
  await page.waitForTimeout(60);
  await page.mouse.up();
}
async function click(x, y, ms) {
  await moveTo(x, y, ms);
  await page.waitForTimeout(80);
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
}
const pause = (ms) => page.waitForTimeout(ms);
const type = (text) => page.keyboard.type(text, { delay: 40 });

// ---------- helpers ----------

const overlay = (sel) => page.locator(`page-review-overlay ${sel}`);
const box = (sel) => page.locator(sel).first().boundingBox();
const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
async function fresh() {
  await page.evaluate(() => scrollTo(0, 0));
  await openOverlay();
  await page.evaluate(() => (document.querySelector('page-review-overlay').shadowRoot.querySelector('.toast').hidden = true));
  // A click with the Select tool clears the overlay's "skip the next click" flag, which a
  // drag in the previous take can leave set (it would swallow the first Step click).
  await page.keyboard.press('v');
  await page.mouse.click(1420, 880);
  await showCursor();
}
// Drawn off camera, without the eased cursor.
async function quickArrow(from, to, text) {
  await page.keyboard.press('a');
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 10 });
  await page.mouse.up();
  await overlay('.note-card textarea').waitFor();
  if (text) await page.keyboard.type(text);
  await page.keyboard.press(text ? 'Enter' : 'Escape');
  await page.mouse.move(...at);
}
const arrowPath = async (n) =>
  (await overlay('g[data-type="arrow"] path').nth(n).getAttribute('d')).match(/^M(\S+) (\S+) Q(\S+) (\S+) (\S+) (\S+)/).slice(1).map(Number);

try {
  // 1) Draw an arrow; its comment opens straight away.
  await fresh();
  const cta = await box('.btn.primary');
  // An arrow from the empty space on the left to the button; its card opens past the tail.
  const tail = [450, 610];
  const head = [cta.x - 6, cta.y + cta.height / 2];
  const say = 'Use the brand indigo';
  const arrowTool = await overlay('[data-tool="arrow"]').boundingBox();
  at = [900, 300];
  await page.mouse.move(...at);
  await record('arrow-comment', { x: 205, y: 0, w: 980, h: 700 }, async () => {
    await click(...centre(arrowTool), 650);
    await pause(250);
    await dragTo(tail, head, 750);
    await pause(350);
    await type(say);
    await pause(300);
    await page.keyboard.press('Enter');
    await moveTo(760, 380, 600);
  });
  await closeOverlay();

  // 2) Move a comment: its arrow follows. Then bend the arrow with its middle handle.
  await fresh();
  await quickArrow(tail, head, say);
  await page.keyboard.press('v');
  const card = overlay('.note-card').filter({ hasText: say });
  at = [760, 600];
  await page.mouse.move(...at);
  await record('move-and-bend', { x: 150, y: 380, w: 900, h: 320 }, async () => {
    const c = await card.boundingBox();
    const grab = [c.x + c.width / 2, c.y + c.height / 2];
    await dragTo(grab, [grab[0] - 20, grab[1] - 130], 900);
    await pause(350);
    const [x1, y1, qx, qy, x2, y2] = await arrowPath(1);
    const mid = [(x1 + 2 * qx + x2) / 4, (y1 + 2 * qy + y2) / 4];
    await click(...mid, 500);
    await pause(350);
    // Pull the bend handle across the straight line between the ends: the curve flips.
    const chord = [(x1 + x2) / 2, (y1 + y2) / 2];
    const to = [chord[0] - (mid[0] - chord[0]) * 1.6, chord[1] - (mid[1] - chord[1]) * 1.6];
    await dragTo(mid, to, 800);
    await pause(300);
    await moveTo(to[0] + 90, to[1] + 70, 500);
  });
  await closeOverlay();

  // 3) Steps: numbered in order; deleting one renumbers the rest.
  await fresh();
  const heads = page.locator('.feature h3');
  const alerts = await heads.nth(1).boundingBox();
  const sharing = await heads.nth(2).boundingBox();
  const row = await box('.features');
  at = [1180, row.y - 10];
  await page.mouse.move(...at);
  await page.keyboard.press('s');
  const step = async (x, y, text) => {
    await click(x, y, 450);
    await pause(100);
    await type(text);
    await page.keyboard.press('Enter');
    await pause(200);
  };
  await record('steps', { x: 500, y: row.y - 16, w: 880, h: row.height + 32 }, async () => {
    await step(alerts.x + 130, alerts.y + alerts.height / 2, 'Open Smart alerts');
    await step(sharing.x + 200, row.y + 40, 'Go back');
    await step(sharing.x + 130, sharing.y + sharing.height / 2, 'Open Team sharing');
    await pause(250);
    await page.keyboard.press('v');
    const back = await overlay('.note-card').filter({ hasText: 'Go back' }).locator('.text').boundingBox();
    await click(...centre(back), 500);
    await pause(450);
    await page.keyboard.press('Delete');
    await pause(150);
    await moveTo(at[0] + 30, at[1] + 120, 450);
  }, { lead: 0.4, tail: 1.3 });
  await closeOverlay();

  // 4) Copy for agent: the Markdown that lands on the clipboard, pasted into an agent.
  await fresh();
  await quickArrow(tail, head, say);
  const odd = await box('.ic.odd');
  await page.keyboard.press('3');
  await quickArrow([odd.x + 190, odd.y + 12], [odd.x + odd.width + 6, odd.y + odd.height / 2], 'Different icon style');
  await page.keyboard.press('1');
  await page.keyboard.press('s');
  const ghost = await box('.btn.ghost');
  await page.mouse.click(ghost.x + ghost.width - 30, ghost.y + ghost.height / 2);
  await page.keyboard.type('Click Book a demo');
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  // A plain panel standing in for the agent's input, on top of the overlay.
  await page.evaluate(() => {
    const p = document.createElement('div');
    p.id = 'demo-agent';
    p.innerHTML = '<div class="bar">Agent</div><textarea spellcheck="false" placeholder="Paste the review here"></textarea>';
    p.style.cssText =
      'position:fixed;left:225px;top:120px;width:940px;height:500px;z-index:2147483647;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:#16161d;box-shadow:0 18px 50px rgba(0,0,0,.35);opacity:0;pointer-events:none;translate:0 12px;transition:opacity .25s,translate .25s;font-family:ui-monospace,Menlo,Consolas,monospace';
    p.querySelector('.bar').style.cssText = 'padding:9px 14px;color:#a1a1aa;font-size:12px;border-bottom:1px solid #2a2a33';
    p.querySelector('textarea').style.cssText =
      'flex:1;margin:0;padding:14px;border:0;outline:0;resize:none;background:transparent;color:#e4e4e7;font:14px/1.55 ui-monospace,Menlo,Consolas,monospace';
    document.documentElement.insertBefore(p, document.getElementById('demo-cursor'));
  });
  const copyBtn = await overlay('[data-action="copy"]').boundingBox();
  at = [900, 300];
  await page.mouse.move(...at);
  await record('copy-for-agent', { x: 205, y: 0, w: 980, h: 640 }, async () => {
    await click(...centre(copyBtn), 700);
    await pause(450);
    const item = await overlay('[role="menuitem"]').filter({ hasText: 'Copy for agent' }).boundingBox();
    await click(item.x + 40, item.y + item.height / 2, 450);
    await overlay('.toast').filter({ hasText: 'Markdown for the agent copied.' }).waitFor();
    await pause(700);
    await page.evaluate(() => {
      const p = document.getElementById('demo-agent');
      p.style.opacity = '1';
      p.style.pointerEvents = 'auto';
      p.style.translate = '0 0';
    });
    await pause(350);
    await click(900, 260, 600);
    await pause(200);
    await page.evaluate(async () => {
      document.querySelector('#demo-agent textarea').value = await navigator.clipboard.readText();
    });
    await pause(2200);
  }, { tail: 1.4 });
  await closeOverlay();
} finally {
  await close();
}
