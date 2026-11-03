// Frame (capture area): the part of the viewport that Save and Copy image capture, set with
// the Frame tool. A frame is { x, y, w, h } in viewport CSS px; without one the whole
// viewport is captured. Pure maths: cropping the captured image (any DPR or zoom), and
// moving the saved coordinates so they are relative to the frame.
// Loaded as a classic script into the review overlay and the service worker (exposes
// globalThis.PageReviewFrame) and imported by the unit tests in Node.
(() => {
  const MIN_PX = 8; // a frame dragged smaller than this is a click, not a frame

  // The frame spanned by two corners, kept inside the viewport (vw × vh).
  function frameFrom(x1, y1, x2, y2, vw, vh) {
    const left = clamp(Math.min(x1, x2), 0, vw);
    const top = clamp(Math.min(y1, y2), 0, vh);
    const right = clamp(Math.max(x1, x2), 0, vw);
    const bottom = clamp(Math.max(y1, y2), 0, vh);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function isFrame(f) {
    return Boolean(f) && f.w >= MIN_PX && f.h >= MIN_PX;
  }

  // Moved by (dx, dy) but kept whole inside the viewport.
  function moveFrame(f, dx, dy, vw, vh) {
    return { ...f, x: clamp(f.x + dx, 0, Math.max(0, vw - f.w)), y: clamp(f.y + dy, 0, Math.max(0, vh - f.h)) };
  }

  // Kept inside a viewport that may have shrunk (window resized); null if nothing is left.
  function fitFrame(f, vw, vh) {
    if (!f) return null;
    const fitted = frameFrom(f.x, f.y, f.x + f.w, f.y + f.h, vw, vh);
    return isFrame(fitted) ? fitted : null;
  }

  // The frame in image pixels. The captured image covers the whole viewport, so its scale
  // (devicePixelRatio times page zoom) comes from the image itself. Pixels are square, and
  // the width gives the scale more precisely (innerHeight is rounded to a CSS px and is the
  // shorter side), so it's used for both axes. Edges are rounded separately, so neighbouring
  // frames share their pixel edges.
  function cropRect(f, imageW, imageH, vw) {
    const k = imageW / vw;
    const left = clamp(Math.round(f.x * k), 0, imageW);
    const top = clamp(Math.round(f.y * k), 0, imageH);
    const right = clamp(Math.round((f.x + f.w) * k), left, imageW);
    const bottom = clamp(Math.round((f.y + f.h) * k), top, imageH);
    return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
  }

  // A shape moved by (dx, dy): any mark, comment or step.
  function shiftShape(s, dx, dy) {
    const out = { ...s };
    if (s.points) out.points = s.points.map(([px, py]) => [px + dx, py + dy]);
    for (const [kx, ky] of [['x', 'y'], ['x1', 'y1'], ['x2', 'y2'], ['cx', 'cy'], ['ax', 'ay']]) {
      if (Number.isFinite(s[kx])) out[kx] = s[kx] + dx;
      if (Number.isFinite(s[ky])) out[ky] = s[ky] + dy;
    }
    return out;
  }

  function shiftBox(b, dx, dy) {
    return b && { ...b, x: b.x + dx, y: b.y + dy };
  }

  function overlaps(a, b) {
    return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
  }

  // The items (comments or steps, each with `shapeIds`) that show in the frame: at least one
  // of their shapes overlaps it. `boxOf(shape)` gives a shape's box in viewport px.
  function itemsInFrame(f, items, shapes, boxOf) {
    const byId = new Map(shapes.map((s) => [s.id, s]));
    return items.filter((item) => item.shapeIds.some((id) => byId.has(id) && overlaps(boxOf(byId.get(id)), f)));
  }

  // Review data for a framed capture: items outside the frame are dropped (they aren't in the
  // image), with their shapes, and everything else is shifted so (0, 0) is the frame's
  // top-left corner, like the cropped image.
  function cropItems(f, items, shapes, boxOf) {
    const kept = itemsInFrame(f, items, shapes, boxOf);
    const keptIds = new Set(kept.flatMap((item) => item.shapeIds));
    const [dx, dy] = [-f.x, -f.y];
    return {
      items: kept.map((item) => ({
        ...item,
        region: shiftBox(item.region, dx, dy),
        badge: shiftBox(item.badge, dx, dy),
        target: item.target && { ...item.target, rect: shiftBox(item.target.rect, dx, dy) },
      })),
      shapes: shapes.filter((s) => keptIds.has(s.id)).map((s) => shiftShape(s, dx, dy)),
      dropped: items.length - kept.length,
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  globalThis.PageReviewFrame = { MIN_PX, frameFrom, isFrame, moveFrame, fitFrame, cropRect, shiftShape, overlaps, itemsInFrame, cropItems };
})();
