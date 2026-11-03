// Unit tests for the frame (capture area): cropping at any DPR or zoom, and moving the saved
// coordinates to the crop. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/frame.js';

const F = globalThis.PageReviewFrame;

test('a frame from two corners, in any order, stays inside the viewport', () => {
  assert.deepEqual(F.frameFrom(300, 200, 100, 50, 1280, 800), { x: 100, y: 50, w: 200, h: 150 });
  assert.deepEqual(F.frameFrom(-20, 700, 1400, 900, 1280, 800), { x: 0, y: 700, w: 1280, h: 100 });
  assert.equal(F.isFrame(F.frameFrom(10, 10, 14, 200, 1280, 800)), false, 'too thin');
  assert.equal(F.isFrame(null), false);
});

test('moving keeps the whole frame on screen; a smaller window trims it', () => {
  const f = { x: 100, y: 100, w: 400, h: 300 };
  assert.deepEqual(F.moveFrame(f, 50, -20, 1280, 800), { x: 150, y: 80, w: 400, h: 300 });
  assert.deepEqual(F.moveFrame(f, 2000, 2000, 1280, 800), { x: 880, y: 500, w: 400, h: 300 });
  assert.deepEqual(F.moveFrame(f, -500, -500, 1280, 800), { x: 0, y: 0, w: 400, h: 300 });
  assert.deepEqual(F.fitFrame(f, 300, 800), { x: 100, y: 100, w: 200, h: 300 });
  assert.equal(F.fitFrame(f, 50, 800), null, 'nothing left of it');
});

test('crop at DPR 1 is the frame itself', () => {
  assert.deepEqual(F.cropRect({ x: 100, y: 50, w: 400, h: 300 }, 1280, 800, 1280), { x: 100, y: 50, w: 400, h: 300 });
});

test('crop at DPR 2 doubles everything', () => {
  assert.deepEqual(F.cropRect({ x: 100, y: 50, w: 400, h: 300 }, 2560, 1600, 1280), { x: 200, y: 100, w: 800, h: 600 });
});

test('crop at fractional scale (zoom 125% on a 2x screen) rounds each edge', () => {
  // 1440 CSS px wide at 2x and 125% zoom: innerWidth 1152, innerHeight 650 (rounded from
  // 650.4), image 2880×1626. Scale 2.5 on both axes, from the width.
  assert.deepEqual(F.cropRect({ x: 380, y: 180, w: 720, h: 460 }, 2880, 1626, 1152), { x: 950, y: 450, w: 1800, h: 1150 });
  const r = F.cropRect({ x: 10.3, y: 20.7, w: 100.5, h: 50.2 }, 2880, 1626, 1152);
  assert.deepEqual(r, { x: 26, y: 52, w: 277 - 26, h: 177 - 52 });
  // Two frames side by side share their pixel edge: no gap, no overlap.
  const a = F.cropRect({ x: 0, y: 0, w: 33.3, h: 10 }, 2880, 1626, 1152);
  const b = F.cropRect({ x: 33.3, y: 0, w: 33.3, h: 10 }, 2880, 1626, 1152);
  assert.equal(a.x + a.w, b.x);
});

test('crop never leaves the image', () => {
  // Image a pixel short of the exact scale (as captures can be): still inside it.
  const r = F.cropRect({ x: 1180, y: 700, w: 100, h: 100 }, 2559, 1599, 1280);
  assert.ok(r.x + r.w <= 2559 && r.y + r.h <= 1599, JSON.stringify(r));
  assert.ok(r.w >= 1 && r.h >= 1);
});

test('every kind of shape shifts by the offset', () => {
  const [dx, dy] = [-100, -50];
  assert.deepEqual(F.shiftShape({ id: 'p', type: 'pen', points: [[110, 60], [120, 70]], color: '#e03131' }, dx, dy).points, [[10, 10], [20, 20]]);
  const arrow = F.shiftShape({ id: 'a', type: 'arrow', x1: 100, y1: 50, x2: 300, y2: 250, cx: 200, cy: 100 }, dx, dy);
  assert.deepEqual([arrow.x1, arrow.y1, arrow.x2, arrow.y2, arrow.cx, arrow.cy], [0, 0, 200, 200, 100, 50]);
  const straight = F.shiftShape({ id: 'b', type: 'arrow', x1: 100, y1: 50, x2: 300, y2: 250 }, dx, dy);
  assert.equal('cx' in straight, false, 'a straight arrow stays straight');
  const note = F.shiftShape({ id: 'n', type: 'text', ax: 150, ay: 90, x: 150, y: 60, w: 120, h: 30, text: 'hi' }, dx, dy);
  assert.deepEqual([note.ax, note.ay, note.x, note.y, note.w, note.h], [50, 40, 50, 10, 120, 30]);
  const rect = F.shiftShape({ id: 'r', type: 'rect', x: 100, y: 50, w: 10, h: 10 }, dx, dy);
  assert.deepEqual([rect.x, rect.y, rect.w, rect.h], [0, 0, 10, 10]);
});

test('cropping review data: shifted to the frame, items outside it dropped', () => {
  const frame = { x: 100, y: 50, w: 400, h: 300 };
  const shapes = [
    { id: 'in', type: 'rect', x: 150, y: 100, w: 50, h: 40 },
    { id: 'out', type: 'rect', x: 900, y: 600, w: 50, h: 40 },
    // An arrow inside the frame whose comment card sits outside it: kept, card and all.
    { id: 'arr', type: 'arrow', x1: 480, y1: 300, x2: 300, y2: 200 },
    { id: 'card', type: 'text', ax: 600, ay: 400, x: 600, y: 370, w: 100, h: 30, mark: 'arr', text: 'x' },
  ];
  const boxOf = (s) =>
    s.type === 'arrow'
      ? { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) }
      : { x: s.x, y: s.y, w: s.w, h: s.h };
  const target = { selector: '#buy', rect: { x: 140, y: 90, w: 80, h: 60 } };
  const items = [
    { n: 1, shapeIds: ['in'], region: { x: 150, y: 100, w: 50, h: 40 }, badge: { x: 150, y: 100 }, target },
    { n: 2, shapeIds: ['out'], region: { x: 900, y: 600, w: 50, h: 40 }, badge: { x: 900, y: 600 }, target: null },
    { n: 3, shapeIds: ['arr', 'card'], region: { x: 300, y: 200, w: 0, h: 0 }, badge: { x: 600, y: 400 }, target: null },
  ];
  assert.deepEqual(F.itemsInFrame(frame, items, shapes, boxOf).map((i) => i.n), [1, 3]);
  const out = F.cropItems(frame, items, shapes, boxOf);
  assert.equal(out.dropped, 1);
  assert.deepEqual(out.items.map((i) => i.n), [1, 3]);
  assert.deepEqual(out.items[0].region, { x: 50, y: 50, w: 50, h: 40 });
  assert.deepEqual(out.items[0].badge, { x: 50, y: 50 });
  assert.deepEqual(out.items[0].target.rect, { x: 40, y: 40, w: 80, h: 60 });
  assert.equal(target.rect.x, 140, 'the input is not changed');
  assert.deepEqual(out.shapes.map((s) => s.id), ['in', 'arr', 'card']);
  assert.deepEqual([out.shapes[0].x, out.shapes[0].y], [50, 50]);
  assert.deepEqual([out.shapes[2].ax, out.shapes[2].ay], [500, 350]);
});
