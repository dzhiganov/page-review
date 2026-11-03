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

test('moving the tail keeps the head and the bend in proportion', () => {
  const a = { x1: 100, y1: 300, x2: 300, y2: 300 };
  Object.assign(a, A.defaultBend(a));
  const before = A.relativeBend(a);
  A.moveTail(a, -100, 0); // 1.5 times as long
  assert.deepEqual([a.x2, a.y2], [300, 300], 'head stays');
  assert.deepEqual([a.x1, a.y1], [0, 300]);
  const after = A.relativeBend(a);
  assert.ok(near(after.u, before.u, 0.01) && near(after.v, before.v, 0.01), 'same relative bend');
  assert.ok(near(bulge(a), 36), `bulge scales with length: ${bulge(a)}`);
});

test('moving the tail round the head rotates the bend with the arrow', () => {
  const a = { x1: 0, y1: 100, x2: 200, y2: 100 };
  Object.assign(a, A.defaultBend(a)); // arcs upwards
  A.moveTail(a, 400, 0); // now points right to left
  assert.ok(a.cy > 100, 'still bends clockwise, now downwards');
});

test('moving the tail of a straight arrow keeps it straight', () => {
  const a = A.moveTail({ x1: 0, y1: 0, x2: 100, y2: 0 }, 10, 20);
  assert.equal(A.isCurved(a), false);
  assert.deepEqual([a.x1, a.y1, a.x2, a.y2], [10, 20, 100, 0]);
});
