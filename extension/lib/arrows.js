// Arrow geometry: the default gentle bend and the bend handle. An arrow is { x1, y1, x2, y2 }
// plus an optional quadratic Bezier control point { cx, cy }; without one it is straight.
// Loaded as a classic script into the review overlay (exposes globalThis.PageReviewArrows)
// and imported by the unit tests in Node.
(() => {
  const BEND = 0.12; // how far a new arrow bows out, relative to its length...
  const BEND_MAX_PX = 36; // ...but never more than this
  const MIN_BEND_LENGTH = 48; // shorter arrows stay straight
  const FLAT_PX = 3; // a handle dragged this close to the straight line makes the arrow straight

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

  globalThis.PageReviewArrows = { isCurved, defaultBend, midpoint, bendThrough };
})();
