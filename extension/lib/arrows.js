// Arrow geometry: the default gentle bend, the bend handle, and keeping a bend in proportion
// when the tail moves to its comment card. An arrow is { x1, y1, x2, y2 } plus an optional quadratic Bezier
// control point { cx, cy }; without one it is straight.
// Loaded as a classic script into the review overlay (exposes globalThis.PageReviewArrows)
// and imported by the unit tests in Node.
(() => {
  const BEND = 0.12; // how far a new arrow bows out, relative to its length...
  const BEND_MAX_PX = 36; // ...but never more than this
  const MIN_BEND_LENGTH = 48; // shorter arrows stay straight
  const FLAT_PX = 3; // a handle dragged this close to the straight line makes the arrow straight
  const GAP_PX = 6; // space between an arrow's tail and its comment card

  const round = (v) => Math.round(v * 10) / 10;

  // Unit vector along the arrow, and the normal it bows towards (clockwise from the direction
  // of travel, so every arrow curves the same way: a left-to-right arrow arcs upwards).
  function frame({ x1, y1, x2, y2 }) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!len) return null;
    const e = [(x2 - x1) / len, (y2 - y1) / len];
    return { len, e, n: [e[1], -e[0]], mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
  }

  function isCurved(a) {
    return Number.isFinite(a.cx) && Number.isFinite(a.cy);
  }

  // Control point for a freshly drawn arrow, or null when it's too short to bend.
  function defaultBend(a) {
    const f = frame(a);
    if (!f || f.len < MIN_BEND_LENGTH) return null;
    // A quadratic curve's midpoint is halfway between the chord and its control point.
    const bulge = Math.min(f.len * BEND, BEND_MAX_PX);
    return { cx: round(f.mid[0] + f.n[0] * bulge * 2), cy: round(f.mid[1] + f.n[1] * bulge * 2) };
  }

  // Point halfway along the curve (where the bend handle sits).
  function midpoint(a) {
    if (!isCurved(a)) return [(a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2];
    return [(a.x1 + 2 * a.cx + a.x2) / 4, (a.y1 + 2 * a.cy + a.y2) / 4];
  }

  // Control point that puts the curve's midpoint at the handle (hx, hy), or null for straight.
  function bendThrough(a, hx, hy) {
    const f = frame(a);
    if (!f) return null;
    const off = (hx - f.mid[0]) * f.n[0] + (hy - f.mid[1]) * f.n[1];
    if (Math.abs(off) < FLAT_PX) return null;
    return { cx: round(2 * hx - f.mid[0]), cy: round(2 * hy - f.mid[1]) };
  }

  // The control point in the arrow's own frame, as fractions of its length.
  function relativeBend(a) {
    const f = frame(a);
    if (!f || !isCurved(a)) return null;
    const d = [a.cx - f.mid[0], a.cy - f.mid[1]];
    return { u: (d[0] * f.e[0] + d[1] * f.e[1]) / f.len, v: (d[0] * f.n[0] + d[1] * f.n[1]) / f.len };
  }

  // Control point for arrow `a` (new endpoints) with the same relative bend as before.
  function applyRelativeBend(a, rel) {
    const f = frame(a);
    if (!f || !rel) return null;
    const along = rel.u * f.len;
    const across = rel.v * f.len;
    return {
      cx: round(f.mid[0] + f.e[0] * along + f.n[0] * across),
      cy: round(f.mid[1] + f.e[1] * along + f.n[1] * across),
    };
  }

  // Distance from the centre of `box` along the unit direction `d` to its rounded border.
  // radii: corner radii [top-left, top-right, bottom-right, bottom-left].
  function borderDistance(box, radii, d) {
    const [hw, hh] = [box.w / 2, box.h / 2];
    const [ax, ay] = [Math.abs(d[0]), Math.abs(d[1])];
    let t = Math.min(ax ? hw / ax : Infinity, ay ? hh / ay : Infinity);
    const corner = d[1] < 0 ? (d[0] < 0 ? 0 : 1) : d[0] < 0 ? 3 : 2;
    const r = Math.max(0, Math.min(radii[corner] ?? 0, hw, hh));
    // By symmetry, work in the quadrant where both components are positive.
    if (r > 0 && ax * t > hw - r && ay * t > hh - r) {
      // The exit is on the corner's arc: |t*d - c| = r, far root.
      const [cx, cy] = [hw - r, hh - r];
      const b = ax * cx + ay * cy;
      t = b + Math.sqrt(Math.max(0, b * b - (cx * cx + cy * cy - r * r)));
    }
    return t;
  }

  // Tail for an arrow whose comment card is `box`: on the line from the card's centre along
  // the curve's tangent at the tail (so the arrow looks like it continues into the middle of
  // the card), with `gap` px of clear space to the card's rounded border, at any angle. The head stays, the bend keeps its
  // proportion. Returns { x1, y1 } plus { cx, cy } for a curved arrow, or null when the head
  // is on (or right next to) the card.
  function tailForCard(a, box, radii, gap = GAP_PX) {
    const o = [box.x + box.w / 2, box.y + box.h / 2];
    // Points `gap` px from a rounded rect form the same rect grown by `gap`, corners included.
    const outer = { x: box.x - gap, y: box.y - gap, w: box.w + gap * 2, h: box.h + gap * 2 };
    const outerRadii = radii.map((r) => Math.min(r, box.w / 2, box.h / 2) + gap);
    const near = gap + 2;
    if (a.x2 > box.x - near && a.x2 < box.x + box.w + near && a.y2 > box.y - near && a.y2 < box.y + box.h + near) return null;
    const rel = relativeBend(a);
    let tail = { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...(rel ? { cx: a.cx, cy: a.cy } : {}) };
    // The tangent at the tail points at the control point, which itself depends on the tail:
    // a few rounds settle it.
    for (let i = 0; i < 8; i++) {
      const aim = rel ? [tail.cx, tail.cy] : [a.x2, a.y2];
      const len = Math.hypot(aim[0] - o[0], aim[1] - o[1]);
      if (!len) return null;
      const d = [(aim[0] - o[0]) / len, (aim[1] - o[1]) / len];
      const t = borderDistance(outer, outerRadii, d);
      const next = { ...tail, x1: round(o[0] + d[0] * t), y1: round(o[1] + d[1] * t) };
      if (rel) Object.assign(next, applyRelativeBend(next, rel));
      const settled = Math.hypot(next.x1 - tail.x1, next.y1 - tail.y1) < 0.1;
      tail = next;
      if (settled) break;
    }
    return rel ? { x1: tail.x1, y1: tail.y1, cx: tail.cx, cy: tail.cy } : { x1: tail.x1, y1: tail.y1 };
  }

  globalThis.PageReviewArrows = { isCurved, defaultBend, midpoint, bendThrough, relativeBend, applyRelativeBend, borderDistance, tailForCard, GAP_PX };
})();
