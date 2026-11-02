// Comment (note) font: defaults, validation and CSS. Comments saved before fonts existed
// have no `font`, so everything that reads one goes through normalizeFont().
// Loaded as a classic script into the review overlay (exposes globalThis.PageReviewNotes)
// and imported by the unit tests in Node.
(() => {
  const FAMILIES = {
    sans: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };
  const SIZES = [12, 14, 16, 20, 24, 32];
  const DEFAULT_FONT = Object.freeze({ family: 'sans', size: 14, weight: 400, color: '#1e1e1e' });

  // Any input (missing, partial, or junk from an older or newer build) -> a complete font.
  function normalizeFont(font) {
    const f = font && typeof font === 'object' ? font : {};
    const size = Number(f.size);
    return {
      family: Object.hasOwn(FAMILIES, f.family) ? f.family : DEFAULT_FONT.family,
      size: SIZES.includes(size) ? size : nearestSize(size),
      weight: Number(f.weight) >= 600 ? 700 : 400,
      color: typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color.toLowerCase() : DEFAULT_FONT.color,
    };
  }

  function nearestSize(size) {
    if (!Number.isFinite(size)) return DEFAULT_FONT.size;
    return SIZES.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best));
  }

  // Next size up (+1) or down (-1), staying within SIZES.
  function stepSize(size, dir) {
    const i = SIZES.indexOf(nearestSize(size));
    return SIZES[Math.max(0, Math.min(SIZES.length - 1, i + dir))];
  }

  function noteCss(font) {
    const f = normalizeFont(font);
    return {
      fontFamily: FAMILIES[f.family],
      fontSize: `${f.size}px`,
      lineHeight: `${Math.round(f.size * 1.43)}px`,
      fontWeight: String(f.weight),
      color: f.color,
    };
  }

  globalThis.PageReviewNotes = { FAMILIES, SIZES, DEFAULT_FONT, normalizeFont, stepSize, noteCss };
})();
