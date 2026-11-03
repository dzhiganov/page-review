// Unit tests for arrow bends. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/arrows.js';

const A = globalThis.PageReviewArrows;
const near = (a, b, eps = 0.6) => Math.abs(a - b) <= eps;
// Distance from the curve's midpoint to the straight line between the ends.
const bulge = (a) => {
  const [mx, my] = A.midpoint(a);
  const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  return Math.abs((a.x2 - a.x1) * (a.y1 - my) - (a.x1 - mx) * (a.y2 - a.y1)) / len;
};

test('a new arrow bows out by about 12% of its length', () => {
  const a = { x1: 100, y1: 300, x2: 300, y2: 300 };
  Object.assign(a, A.defaultBend(a));
  assert.ok(A.isCurved(a));
  assert.ok(near(bulge(a), 24), `bulge ${bulge(a)}`);
});

test('the bend is capped for long arrows', () => {
  const a = { x1: 0, y1: 0, x2: 1000, y2: 0 };
  Object.assign(a, A.defaultBend(a));
  assert.ok(near(bulge(a), 36), `bulge ${bulge(a)}`);
});

test('short arrows stay straight', () => {
  assert.equal(A.defaultBend({ x1: 0, y1: 0, x2: 40, y2: 10 }), null);
  assert.equal(A.defaultBend({ x1: 5, y1: 5, x2: 5, y2: 5 }), null);
});

test('every arrow bends the same way relative to its direction', () => {
  // Left to right arcs upwards (smaller y), right to left downwards.
  const ltr = { x1: 0, y1: 100, x2: 200, y2: 100 };
  const rtl = { x1: 200, y1: 100, x2: 0, y2: 100 };
  assert.ok(A.defaultBend(ltr).cy < 100);
  assert.ok(A.defaultBend(rtl).cy > 100);
  // Rotating the arrow rotates the bend with it.
  const down = { x1: 100, y1: 0, x2: 100, y2: 200 };
  assert.ok(A.defaultBend(down).cx > 100);
});

test('dragging the handle moves the curve midpoint to it; flat makes it straight', () => {
  const a = { x1: 0, y1: 0, x2: 200, y2: 0 };
  Object.assign(a, A.bendThrough(a, 100, 50));
  assert.deepEqual(A.midpoint(a), [100, 50]);
  assert.equal(A.bendThrough(a, 120, 2), null, 'within 3px of the line: straight');
  assert.deepEqual(A.midpoint({ x1: 0, y1: 0, x2: 200, y2: 0 }), [100, 0]);
});

const R = [16, 16, 16, 16];
const card = (x, y, w = 200, h = 40) => ({ x, y, w, h });
// Distance from a point to a rounded rect's border (positive outside); r is clamped like the card's.
const outside = ([px, py], b, r) => {
  r = Math.min(r, b.w / 2, b.h / 2);
  const qx = Math.abs(px - (b.x + b.w / 2)) - (b.w / 2 - r);
  const qy = Math.abs(py - (b.y + b.h / 2)) - (b.h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
// Does the tangent at the tail, extended backwards, pass through the card's centre?
const aimsAtCentre = (a, b) => {
  const [ax, ay] = A.isCurved(a) ? [a.cx, a.cy] : [a.x2, a.y2];
  const [ox, oy] = [b.x + b.w / 2, b.y + b.h / 2];
  const cross = (ax - a.x1) * (oy - a.y1) - (ay - a.y1) * (ox - a.x1);
  return Math.abs(cross) / Math.hypot(ax - a.x1, ay - a.y1) < 0.5;
};
const attach = (a, b, r = R) => Object.assign({ ...a }, A.tailForCard(a, b, r));

test('border distance: straight sides and rounded corners', () => {
  assert.equal(A.borderDistance(card(0, 0, 100, 40), [0, 0, 0, 0], [1, 0]), 50);
  assert.equal(A.borderDistance(card(0, 0, 100, 40), R, [0, -1]), 20);
  // Diagonal of a 100px square with 16px corners: 34*sqrt(2) + 16.
  assert.ok(near(A.borderDistance(card(0, 0, 100, 100), R, [Math.SQRT1_2, Math.SQRT1_2]), 34 * Math.SQRT2 + 16, 1e-9));
  // A sharp corner reaches further than a rounded one.
  const d = [Math.SQRT1_2, -Math.SQRT1_2];
  assert.ok(A.borderDistance(card(0, 0, 100, 100), [16, 4, 16, 16], d) > A.borderDistance(card(0, 0, 100, 100), R, d));
});

test('the tail stops 6px outside the card on each side, aimed at its centre', () => {
  const head = [600, 400];
  const cards = { right: card(800, 380), left: card(200, 380), above: card(500, 100), below: card(500, 700) };
  for (const [side, b] of Object.entries(cards)) {
    for (const bent of [false, true]) {
      const a = { x1: b.x + b.w / 2, y1: b.y + b.h / 2, x2: head[0], y2: head[1] };
      if (bent) Object.assign(a, A.defaultBend(a));
      const t = attach(a, b);
      assert.ok(near(outside([t.x1, t.y1], b, 16), 6, 0.2), `${side} ${bent}: gap ${outside([t.x1, t.y1], b, 16)}`);
      assert.ok(aimsAtCentre(t, b), `${side} ${bent}: aims at the centre`);
      assert.deepEqual([t.x2, t.y2], head, 'head stays');
      if (bent) assert.ok(near(A.relativeBend(t).v, A.relativeBend(a).v, 0.01), 'bend in proportion');
    }
  }
});

test('an arrow leaving through a corner of the card clears the rounded corner', () => {
  const b = card(100, 100, 200, 60); // centre (200, 130), top-right corner (300, 100)
  const head = [700, -20]; // on the line from the centre through the corner
  const t = attach({ x1: 200, y1: 130, x2: head[0], y2: head[1] }, b);
  assert.ok(t.x1 > 300 - 16 && t.y1 < 100 + 16, `off the corner: ${t.x1},${t.y1}`);
  assert.ok(near(outside([t.x1, t.y1], b, 16), 6, 0.2), `gap ${outside([t.x1, t.y1], b, 16)}`);
  assert.ok(aimsAtCentre(t, b));
  // The sharp pin corner (4px) is honoured: the tail sits further out than with 16px.
  const sharp = attach({ x1: 200, y1: 130, x2: head[0], y2: head[1] }, b, [16, 4, 16, 16]);
  assert.ok(near(outside([sharp.x1, sharp.y1], b, 4), 6, 0.2));
  assert.ok(Math.hypot(sharp.x1 - 200, sharp.y1 - 130) > Math.hypot(t.x1 - 200, t.y1 - 130));
});

test('a grazing angle still leaves a 6px clearance', () => {
  const b = card(100, 100, 300, 40);
  const t = attach({ x1: 250, y1: 120, x2: 900, y2: 150 }, b);
  assert.ok(near(outside([t.x1, t.y1], b, 16), 6, 0.2), `gap ${outside([t.x1, t.y1], b, 16)}`);
});

test('a tiny card still gets a 6px gap', () => {
  const b = card(100, 100, 20, 12);
  const t = attach({ x1: 110, y1: 106, x2: 300, y2: 250 }, b);
  assert.ok(near(outside([t.x1, t.y1], b, 6), 6, 0.2), `gap ${outside([t.x1, t.y1], b, 6)}`);
  assert.ok(aimsAtCentre(t, b));
});

test('no tail change when the head is on the card', () => {
  assert.equal(A.tailForCard({ x1: 0, y1: 0, x2: 150, y2: 120 }, card(100, 100), R), null);
  assert.equal(A.tailForCard({ x1: 0, y1: 0, x2: 96, y2: 120 }, card(100, 100), R), null, 'within the gap');
});
