// Cleans up a finished freehand stroke: nearly straight -> line, line plus a hook at the
// end -> arrow (straight or curved), closed loop -> box or ellipse, anything else -> a
// smooth curve. Pure functions on [x, y] point arrays.
// Loaded as a classic script into the review overlay (exposes globalThis.PageReviewSmooth)
// and imported by the unit tests in Node.
(() => {
  const T = {
    minLength: 16, // shorter strokes are left alone (dots, ticks)
    lineDeviation: 0.06, // max distance from the chord, relative to its length...
    lineDeviationPx: 5, // ...but always allow a few pixels of hand wobble
    lineStraightness: 1.1, // path length / chord length
    arrowTurn: 110, // degrees: how sharply the stroke doubles back at the tip
    arrowHeadMax: 0.5, // how far the head reaches from the tip, relative to the shaft length
    arrowHeadMinPx: 6,
    arrowHeadMaxPx: 60,
    arrowBarbAngle: 75, // degrees between a barb and the shaft, pointing back
    curvedShaft: 0.08, // shaft bulge relative to its chord before it counts as curved
    closedGap: 0.2, // start-end gap relative to the bounding box diagonal
    rectCornerTurn: 55, // degrees: a corner is a turn at least this sharp...
    rectAxisSlack: 20, // ...and box sides must be within this many degrees of the axes
    ellipseError: 0.13, // mean radial error of an ellipse fit
    curveSimplify: 0.02, // RDP epsilon for curves, relative to the diagonal
    reversalTurn: 150, // degrees: the stroke goes back on itself (crossing out, scribbling)
    reversalStepPx: 8, // measured between points this far apart, so tremor doesn't count
  };

  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pathLength = (pts) => pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);
  const round = (v) => Math.round(v * 10) / 10;
  const roundPt = (p) => [round(p[0]), round(p[1])];

  function bbox(pts) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // Distance from p to the segment a-b.
  function segDist(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (!len2) return dist(p, a);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }

  // Signed turn in degrees between direction a->b and b->c (0 = straight on, 180 = doubling back).
  function turn(a, b, c) {
    const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = ((a2 - a1) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  // Ramer-Douglas-Peucker: keeps the points that matter for the shape.
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let max = 0;
      let idx = -1;
      for (let i = s + 1; i < e; i++) {
        const d = segDist(pts[i], pts[s], pts[e]);
        if (d > max) [max, idx] = [d, i];
      }
      if (idx !== -1 && max > eps) {
        keep[idx] = 1;
        stack.push([s, idx], [idx, e]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  }

  function dedupe(points) {
    const pts = [];
    for (const p of points) if (!pts.length || dist(pts[pts.length - 1], p) >= 1) pts.push([p[0], p[1]]);
    return pts;
  }

  // Evens out jitter with a small moving average (ends stay put). Only for curves: it would
  // blunt the corners that lines, arrows and boxes are recognised by.
  function soften(pts) {
    if (pts.length < 5) return pts;
    return pts.map((p, i) => {
      if (i < 2 || i > pts.length - 3) return p;
      const w = pts.slice(i - 2, i + 3);
      return [w.reduce((s, q) => s + q[0], 0) / 5, w.reduce((s, q) => s + q[1], 0) / 5];
    });
  }

  // Centripetal Catmull-Rom through `pts`, sampled about every `step` px.
  function catmullRom(pts, { closed = false, step = 4 } = {}) {
    if (pts.length < 3) return pts.map(roundPt);
    const P = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
    const out = [];
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      const t01 = Math.sqrt(dist(p0, p1)) || 1e-4;
      const t12 = Math.sqrt(dist(p1, p2)) || 1e-4;
      const t23 = Math.sqrt(dist(p2, p3)) || 1e-4;
      // Tangents for the Hermite form of the centripetal spline.
      const m1 = [0, 1].map(
        (k) => (p2[k] - p1[k] + t12 * ((p1[k] - p0[k]) / t01 - (p2[k] - p0[k]) / (t01 + t12))),
      );
      const m2 = [0, 1].map(
        (k) => (p2[k] - p1[k] + t12 * ((p3[k] - p2[k]) / t23 - (p3[k] - p1[k]) / (t12 + t23))),
      );
      const n = Math.max(1, Math.ceil(dist(p1, p2) / step));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const [t2, t3] = [t * t, t * t * t];
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        out.push([0, 1].map((k) => round(h00 * p1[k] + h10 * m1[k] + h01 * p2[k] + h11 * m2[k])));
      }
    }
    out.push(roundPt(closed ? pts[0] : pts[pts.length - 1]));
    return out;
  }

  function ellipsePoints({ cx, cy, rx, ry }, n = 64) {
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [round(cx + Math.cos(a) * rx), round(cy + Math.sin(a) * ry)];
    });
  }

  // Does the stroke go back on itself somewhere? RDP would hide this (a back-and-forth
  // scribble simplifies to one segment), so it's checked on the raw path.
  function hasReversal(pts) {
    const coarse = [pts[0]];
    for (const p of pts) if (dist(coarse[coarse.length - 1], p) >= T.reversalStepPx) coarse.push(p);
    return coarse.some((p, i) => i > 0 && i < coarse.length - 1 && Math.abs(turn(coarse[i - 1], p, coarse[i + 1])) > T.reversalTurn);
  }

  function asLine(pts) {
    if (hasReversal(pts)) return false;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const chord = dist(a, b);
    if (!chord) return false;
    const dev = Math.max(...pts.map((p) => segDist(p, a, b)));
    // Measured on a lightly simplified path, so tremor doesn't count as length but doubling back does.
    const len = pathLength(rdp(pts, T.lineDeviationPx / 2));
    return dev <= Math.max(T.lineDeviationPx, chord * T.lineDeviation) && len / chord <= T.lineStraightness;
  }

  // Line plus a hook/V at the end. Returns the shaft (tail to tip), or null.
  function findArrowShaft(pts) {
    const total = pathLength(pts);
    const eps = Math.max(3, Math.min(6, Math.hypot(bbox(pts).w, bbox(pts).h) * 0.03));
    const simple = rdp(pts, eps);
    // Walk back from the end: the tip is the last sharp reversal with only a short head after it.
    for (let k = simple.length - 2; k >= 1; k--) {
      if (Math.abs(turn(simple[k - 1], simple[k], simple[k + 1])) < T.arrowTurn) continue;
      const tip = simple[k];
      const tipIdx = pts.indexOf(tip);
      // A V head returns to the tip before its second barb: the shaft ends at the first arrival.
      const near = Math.max(4, eps);
      const end = pts.findIndex((p, i) => i <= tipIdx && dist(p, tip) <= near);
      const shaft = [...pts.slice(0, end), tip];
      const shaftLen = pathLength(shaft);
      // How far the head reaches from the tip (a V head goes out and back twice).
      const reach = Math.max(...pts.slice(end).map((p) => dist(p, tip)));
      if (reach < T.arrowHeadMinPx || reach > T.arrowHeadMaxPx || reach > shaftLen * T.arrowHeadMax) continue;
      if (shaftLen < total * 0.4) continue;
      // The shaft itself never doubles back; otherwise this "tip" is really a barb.
      const inShaft = simple.filter((p) => pts.indexOf(p) < end);
      inShaft.push(tip);
      if (inShaft.some((p, i) => i > 0 && i < inShaft.length - 1 && Math.abs(turn(inShaft[i - 1], p, inShaft[i + 1])) >= T.arrowTurn)) continue;
      // Every barb points back along the shaft.
      const back = shaftEndDirection(shaft);
      const barbs = simple.filter((p) => pts.indexOf(p) > end && dist(p, tip) > T.arrowHeadMinPx * 0.75);
      if (!barbs.length) continue;
      const ok = barbs.every((p) => {
        const v = [(p[0] - tip[0]) / dist(p, tip), (p[1] - tip[1]) / dist(p, tip)];
        const cos = v[0] * back[0] + v[1] * back[1];
        return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI <= T.arrowBarbAngle;
      });
      if (ok) return shaft;
    }
    return null;
  }

  // Unit vector from the tip back along the last stretch of the shaft.
  function shaftEndDirection(shaft) {
    const tip = shaft[shaft.length - 1];
    const reach = Math.min(40, pathLength(shaft) * 0.3);
    let acc = 0;
    let from = shaft[0];
    for (let i = shaft.length - 1; i > 0; i--) {
      acc += dist(shaft[i], shaft[i - 1]);
      if (acc >= reach) {
        from = shaft[i - 1];
        break;
      }
    }
    const d = dist(from, tip) || 1;
    return [(from[0] - tip[0]) / d, (from[1] - tip[1]) / d];
  }

  // Point at a fraction of the path length.
  function pointAt(pts, frac) {
    const target = pathLength(pts) * frac;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (acc + d >= target) {
        const t = d ? (target - acc) / d : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
      }
      acc += d;
    }
    return pts[pts.length - 1];
  }

  function asArrow(shaft) {
    const [a, b] = [shaft[0], shaft[shaft.length - 1]];
    const arrow = { type: 'arrow', x1: round(a[0]), y1: round(a[1]), x2: round(b[0]), y2: round(b[1]) };
    const chord = dist(a, b);
    const bulge = Math.max(...shaft.map((p) => segDist(p, a, b)));
    if (bulge <= Math.max(T.lineDeviationPx, chord * T.curvedShaft)) return arrow;
    const c = tangentControl(shaft) ?? midpointControl(shaft);
    return { ...arrow, cx: round(c[0]), cy: round(c[1]) };
  }

  // Quadratic Bezier control point where the start and end tangents meet, so the arrow
  // leaves and arrives in the directions it was drawn. Null when that fits the stroke badly.
  function tangentControl(shaft) {
    const [a, b] = [shaft[0], shaft[shaft.length - 1]];
    const u = sub(pointAt(shaft, 0.15), a);
    const v = sub(b, pointAt(shaft, 0.85));
    const den = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(den) < 1e-6) return null;
    // a + s*u = b - t*v
    const d = sub(b, a);
    const s = (d[0] * v[1] - d[1] * v[0]) / den;
    const t = (u[0] * d[1] - u[1] * d[0]) / den;
    if (s <= 0 || t <= 0) return null;
    const c = [a[0] + s * u[0], a[1] + s * u[1]];
    const mid = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
    return dist(mid, pointAt(shaft, 0.5)) <= dist(a, b) * 0.12 ? c : null;
  }

  // Quadratic Bezier through the shaft's midpoint: C = 2M - (A + B) / 2.
  function midpointControl(shaft) {
    const [a, b] = [shaft[0], shaft[shaft.length - 1]];
    const m = pointAt(shaft, 0.5);
    return [2 * m[0] - (a[0] + b[0]) / 2, 2 * m[1] - (a[1] + b[1]) / 2];
  }

  const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];

  function asRect(pts, box) {
    const diag = Math.hypot(box.w, box.h);
    const ring = rdp(pts, diag * 0.06);
    // Count corners around the loop, including where it closes.
    const loop = dist(ring[0], ring[ring.length - 1]) < diag * T.closedGap ? ring.slice(0, -1) : ring;
    if (loop.length < 4) return null;
    const n = loop.length;
    const corners = loop.filter((p, i) => Math.abs(turn(loop[(i - 1 + n) % n], p, loop[(i + 1) % n])) >= T.rectCornerTurn);
    if (corners.length !== 4) return null;
    for (let i = 0; i < 4; i++) {
      const [p, q] = [corners[i], corners[(i + 1) % 4]];
      const deg = (Math.atan2(Math.abs(q[1] - p[1]), Math.abs(q[0] - p[0])) * 180) / Math.PI;
      if (Math.min(deg, 90 - deg) > T.rectAxisSlack) return null;
    }
    return { type: 'rect', x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) };
  }

  function asEllipse(pts, box) {
    const e = { cx: box.x + box.w / 2, cy: box.y + box.h / 2, rx: box.w / 2, ry: box.h / 2 };
    if (e.rx < 4 || e.ry < 4) return null;
    const err =
      pts.reduce((s, p) => s + Math.abs(Math.hypot((p[0] - e.cx) / e.rx, (p[1] - e.cy) / e.ry) - 1), 0) / pts.length;
    if (err > T.ellipseError) return null;
    // The stroke must go (nearly) all the way round.
    const sweep = new Set(pts.map((p) => Math.floor(((Math.atan2(p[1] - e.cy, p[0] - e.cx) + Math.PI) / (2 * Math.PI)) * 12) % 12));
    if (sweep.size < 11) return null;
    return { type: 'ellipse', ...e, points: ellipsePoints(e) };
  }

  // Returns the cleaned-up shape for a finished stroke, or null to keep it as drawn:
  //   { type: 'line', points }          two points
  //   { type: 'arrow', x1, y1, x2, y2 } plus cx, cy (quadratic control point) when curved
  //   { type: 'rect', x, y, w, h }
  //   { type: 'ellipse', cx, cy, rx, ry, points }
  //   { type: 'curve', points }         smoothed polyline (closed curves end where they start)
  function recognize(points) {
    const pts = dedupe(points);
    if (pts.length < 3 || pathLength(pts) < T.minLength) return null;
    const box = bbox(pts);
    const diag = Math.hypot(box.w, box.h);
    const [first, last] = [pts[0], pts[pts.length - 1]];
    const closed = dist(first, last) < diag * T.closedGap && pathLength(pts) > diag * 1.5;

    if (closed) {
      const shape = asRect(pts, box) ?? asEllipse(pts, box);
      if (shape) return shape;
    } else {
      if (asLine(pts)) return { type: 'line', points: [roundPt(first), roundPt(last)] };
      const shaft = findArrowShaft(pts);
      if (shaft) return asArrow(shaft);
    }
    // A scribble or crossing-out: smoothing would only mangle it, keep it as drawn.
    if (hasReversal(pts)) return null;
    const eps = Math.max(1.5, Math.min(8, diag * T.curveSimplify));
    const simple = rdp(soften(pts), eps);
    if (closed) return { type: 'curve', points: catmullRom(simple.slice(0, -1), { closed: true }) };
    return { type: 'curve', points: catmullRom(simple) };
  }

  globalThis.PageReviewSmooth = { recognize, rdp, catmullRom, THRESHOLDS: T };
})();
