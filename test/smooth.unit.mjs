// Unit tests for the freehand stroke recogniser. Run: npm run test:unit
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../extension/lib/smooth.js';

const { recognize, rdp, catmullRom } = globalThis.PageReviewSmooth;

// Deterministic hand tremor.
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
}
function jitter(points, px, seed = 7) {
  const r = rng(seed);
  return points.map(([x, y]) => [Math.round(x + r() * px), Math.round(y + r() * px)]);
}
// Points every ~`step` px along straight segments through `corners`.
function polyline(corners, step = 4) {
  const out = [];
  for (let i = 1; i < corners.length; i++) {
    const [a, b] = [corners[i - 1], corners[i]];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  out.push(corners[corners.length - 1]);
  return out;
}
function arc(cx, cy, r, from, to, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}
// Arrow head drawn in the same stroke: from the tip back along one barb, to the tip, along the other.
function head(tip, angle, len = 18, spread = 0.5) {
  const barb = (s) => [tip[0] - len * Math.cos(angle + s), tip[1] - len * Math.sin(angle + s)];
  return polyline([tip, barb(spread), tip, barb(-spread)]).slice(1);
}

test('tiny strokes are left alone', () => {
  assert.equal(recognize([[0, 0], [3, 2], [5, 4]]), null);
});

test('a nearly straight stroke becomes a straight line', () => {
  const s = recognize(jitter(polyline([[100, 100], [400, 160]]), 2));
  assert.equal(s.type, 'line');
  assert.equal(s.points.length, 2);
  assert.ok(Math.hypot(s.points[0][0] - 100, s.points[0][1] - 100) < 4);
  assert.ok(Math.hypot(s.points[1][0] - 400, s.points[1][1] - 160) < 4);
});

test('a short wobbly underline is still a line', () => {
  const s = recognize(jitter(polyline([[10, 50], [90, 52]], 3), 2, 3));
  assert.equal(s.type, 'line');
});

test('a gentle arc is not mistaken for a line', () => {
  const s = recognize(arc(200, 300, 150, Math.PI * 1.15, Math.PI * 1.85));
  assert.equal(s.type, 'curve');
});

test('line plus a V at the end becomes a straight arrow', () => {
  const tip = [420, 180];
  const shaft = jitter(polyline([[100, 300], tip]), 1.5);
  const s = recognize([...shaft, ...head(tip, Math.atan2(180 - 300, 420 - 100))]);
  assert.equal(s.type, 'arrow');
  assert.ok(Math.hypot(s.x1 - 100, s.y1 - 300) < 4, 'tail');
  assert.ok(Math.hypot(s.x2 - tip[0], s.y2 - tip[1]) < 6, `tip at ${s.x2},${s.y2}`);
  assert.equal(s.cx, undefined, 'straight');
});

test('a single hook (one barb) at the end also makes an arrow', () => {
  const tip = [300, 100];
  const s = recognize([...polyline([[100, 100], tip]), ...polyline([tip, [284, 112]]).slice(1)]);
  assert.equal(s.type, 'arrow');
  assert.ok(Math.abs(s.x2 - 300) < 5);
});

test('a curved shaft with a head becomes a curved arrow', () => {
  const shaft = arc(250, 300, 150, Math.PI, Math.PI * 1.5); // (100,300) up to (250,150)
  const tip = shaft[shaft.length - 1];
  const s = recognize([...shaft, ...head(tip, 0)]); // arriving heading right
  assert.equal(s.type, 'arrow');
  assert.ok(Number.isFinite(s.cx) && Number.isFinite(s.cy), 'has a control point');
  // The control point sits on the outside of the bend, up and to the left.
  assert.ok(s.cx < 175 && s.cy < 225, `control ${s.cx},${s.cy}`);
});

test('a zigzag is not an arrow', () => {
  const s = recognize(polyline([[0, 0], [100, 0], [20, 30], [120, 30], [40, 60], [140, 60]]));
  assert.notEqual(s?.type, 'arrow');
});

test('a head as long as the shaft is not an arrow', () => {
  const tip = [100, 0];
  const s = recognize([...polyline([[0, 0], tip]), ...polyline([tip, [10, 30]]).slice(1)]);
  assert.notEqual(s?.type, 'arrow');
});

test('a wobbly closed loop around a box becomes a rectangle', () => {
  const s = recognize(jitter(polyline([[100, 100], [300, 102], [302, 200], [99, 198], [104, 106]]), 2));
  assert.equal(s.type, 'rect');
  assert.ok(Math.abs(s.x - 100) < 5 && Math.abs(s.y - 100) < 5);
  assert.ok(Math.abs(s.w - 200) < 8 && Math.abs(s.h - 100) < 8);
});

test('a hand-drawn circle becomes an ellipse', () => {
  const pts = jitter(arc(200, 200, 80, -0.3, Math.PI * 2 - 0.1, 60), 3).map(([x, y]) => [x * 1.4 - 80, y]);
  const s = recognize(pts);
  assert.equal(s.type, 'ellipse');
  assert.ok(Math.abs(s.rx - 112) < 8 && Math.abs(s.ry - 80) < 8, `radii ${s.rx} ${s.ry}`);
  assert.ok(s.points.length > 32);
});

test('a half circle is not closed', () => {
  const s = recognize(arc(200, 200, 80, 0, Math.PI));
  assert.equal(s.type, 'curve');
});

test('a closed blob that is neither box nor ellipse stays a closed smooth curve', () => {
  const star = Array.from({ length: 11 }, (_, i) => {
    const r = i % 2 ? 40 : 100;
    const a = (i / 10) * Math.PI * 2;
    return [200 + Math.cos(a) * r, 200 + Math.sin(a) * r];
  });
  const s = recognize(polyline(star));
  assert.equal(s.type, 'curve');
  const [a, b] = [s.points[0], s.points[s.points.length - 1]];
  assert.deepEqual(a, b, 'closed curve ends where it starts');
});

test('a wobbly curve becomes smooth and keeps its ends', () => {
  const raw = jitter(
    Array.from({ length: 80 }, (_, i) => [100 + i * 5, 200 + Math.sin(i / 12) * 60]),
    3,
  );
  const s = recognize(raw);
  assert.equal(s.type, 'curve');
  // Smoother: much less total turning than the jittery input.
  const turning = (pts) => {
    let sum = 0;
    for (let i = 2; i < pts.length; i++) {
      const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
      const a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      let d = Math.abs(a2 - a1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      sum += d;
    }
    return sum;
  };
  assert.ok(turning(s.points) < turning(raw) / 3, `${turning(s.points)} vs ${turning(raw)}`);
  assert.deepEqual(s.points[0], raw[0]);
  assert.deepEqual(s.points[s.points.length - 1], raw[raw.length - 1]);
});

test('rdp keeps corners and drops collinear points', () => {
  const out = rdp(polyline([[0, 0], [100, 0], [100, 100]], 10), 1);
  assert.deepEqual(out, [[0, 0], [100, 0], [100, 100]]);
});

test('catmullRom passes through its control points', () => {
  const ctrl = [[0, 0], [50, 40], [100, 0]];
  const out = catmullRom(ctrl, { step: 5 });
  for (const p of ctrl) assert.ok(out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.2), `passes ${p}`);
});

test('a short straight arrow with a V head stays straight', () => {
  const tip = [180, 100];
  const s = recognize([...jitter(polyline([[100, 100], tip]), 1), ...head(tip, 0, 16, 0.6)]);
  assert.equal(s.type, 'arrow');
  assert.equal(s.cx, undefined, `control ${s.cx},${s.cy}`);
  assert.ok(Math.hypot(s.x2 - 180, s.y2 - 100) < 4);
});

test('a curved arrow arrives in the direction it was drawn', () => {
  // Quarter circle from (100,300) to (250,150), arriving heading right.
  const shaft = jitter(arc(250, 300, 150, Math.PI, Math.PI * 1.5), 1.5);
  const tip = shaft[shaft.length - 1];
  const s = recognize([...shaft, ...head(tip, 0)]);
  const arrival = (Math.atan2(s.y2 - s.cy, s.x2 - s.cx) * 180) / Math.PI;
  assert.ok(Math.abs(arrival) < 15, `arrives at ${arrival}°`);
});

test('straight arrows in every direction, length and head shape', () => {
  const misses = [];
  let seed = 1;
  for (let deg = 0; deg < 360; deg += 30) {
    for (const len of [70, 200, 450]) {
      for (const spread of [0.4, 0.6, 0.8]) {
        const a = (deg * Math.PI) / 180;
        const tail = [500, 500];
        const tip = [tail[0] + Math.cos(a) * len, tail[1] + Math.sin(a) * len];
        const s = recognize([...jitter(polyline([tail, tip]), 1.5, seed++), ...jitter(head(tip, a, 16, spread), 1, seed++)]);
        const ok = s.type === 'arrow' && s.cx === undefined && Math.hypot(s.x2 - tip[0], s.y2 - tip[1]) < 6;
        if (!ok) misses.push(`${deg}° ${len}px spread ${spread}: ${JSON.stringify(s).slice(0, 80)}`);
      }
    }
  }
  assert.deepEqual(misses, []);
});

test('wobbly lines in every direction stay lines', () => {
  for (let deg = 0; deg < 360; deg += 45) {
    const a = (deg * Math.PI) / 180;
    const s = recognize(jitter(polyline([[300, 300], [300 + Math.cos(a) * 160, 300 + Math.sin(a) * 160]]), 2, deg + 3));
    assert.equal(s.type, 'line', `${deg}°`);
  }
});

test('a back-and-forth scribble (crossing out) stays freehand', () => {
  const scribble = polyline([[100, 100], [300, 104], [110, 108], [305, 112], [105, 116]]);
  assert.equal(recognize(jitter(scribble, 1.5)), null);
  // Even a single double-back along one line is not a line.
  assert.equal(recognize(polyline([[100, 100], [300, 100], [140, 102]])), null);
});
