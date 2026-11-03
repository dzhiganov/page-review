// Lays out and draws several screenshots as one image, following a template
// (lib/templates.js). layoutComposition is pure, so it's unit-tested in Node;
// drawComposition paints that layout on a 2D canvas context.
import './arrows.js'; // globalThis.PageReviewArrows: the arrowhead shared with the page overlay

export const FONT_FAMILY = 'Inter, "Segoe UI", system-ui, sans-serif';
const MAX_SIDE = 2400; // common image height (row) or width (grid) is capped here...
const MIN_SIDE = 480; // ...and tiny images are scaled up to this.
const UNIT_BASE = 1280; // template sizes are in px for a 1280px screenshot; they scale with the images

// sizes: [{ w, h }] natural image sizes, in template order.
// measure(text, fontSize) -> text width in px (canvas measureText in the browser).
export function layoutComposition(template, sizes, measure) {
  const n = template.count;
  if (sizes.length !== n) throw new Error(`template "${template.name}" needs ${n} images, got ${sizes.length}`);
  const grid = n === 4;
  const cols = grid ? 2 : n;
  const rows = grid ? 2 : 1;

  // Row: same height for all. Grid: same width for all.
  const side = clamp(Math.min(...sizes.map((s) => (grid ? s.w : s.h))), MIN_SIDE, MAX_SIDE);
  const scaled = sizes.map((s) => {
    const k = side / (grid ? s.w : s.h);
    return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
  });
  const unit = Math.max(...scaled.map((s) => Math.max(s.w, s.h))) / UNIT_BASE;
  const px = (v) => Math.round(v * unit);

  const fontSize = px(30);
  const hasLabels = template.labelPosition !== 'none' && template.labels.some((l) => l.text.trim());
  const pill = template.labelStyle === 'pill';
  const labelH = pill ? Math.round(fontSize * 1.9) : Math.round(fontSize * 1.3);
  const outside = hasLabels && (template.labelPosition === 'above' || template.labelPosition === 'below');
  const band = outside ? labelH + px(20) : 0; // room for outside labels, per row

  const pad = px(template.padding);
  const minGap = { arrow: 120, divider: 56, none: 0 }[template.connector];
  const gap = Math.max(pad, px(minGap), px(24));

  // Column widths and row heights (grid cells take the biggest image in their column/row).
  const colW = Array.from({ length: cols }, (_, c) => Math.max(...scaled.filter((_, i) => i % cols === c).map((s) => s.w)));
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...scaled.filter((_, i) => Math.floor(i / cols) === r).map((s) => s.h)));

  const width = pad * 2 + colW.reduce((a, b) => a + b, 0) + gap * (cols - 1);
  const height = pad * 2 + rowH.reduce((a, b) => a + b, 0) + band * rows + gap * (rows - 1);

  const panels = scaled.map((s, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const cellX = pad + colW.slice(0, c).reduce((a, b) => a + b, 0) + gap * c;
    const cellY = pad + rowH.slice(0, r).reduce((a, b) => a + b, 0) + (band + gap) * r;
    const imageTop = cellY + (template.labelPosition === 'above' && outside ? band : 0);
    // Centered in its cell: horizontally in a row of equal heights, both ways in a grid.
    const image = {
      x: cellX + Math.round((colW[c] - s.w) / 2),
      y: imageTop + (grid ? 0 : Math.round((rowH[r] - s.h) / 2)),
      w: s.w,
      h: s.h,
    };
    const panel = { index: i, image, label: null };
    const text = template.labels[i].text.trim();
    if (hasLabels && text) {
      const textW = Math.ceil(measure(text, fontSize));
      const w = pill ? textW + Math.round(fontSize * 1.3) : textW;
      const inset = px(20);
      let x;
      let y;
      if (outside) {
        x = image.x + Math.round((image.w - w) / 2);
        y = template.labelPosition === 'above' ? cellY : imageTop + rowH[r] + px(20);
      } else {
        x = image.x + inset;
        y = template.labelPosition === 'inside-top' ? image.y + inset : image.y + image.h - inset - labelH;
      }
      panel.label = { text, color: template.labels[i].color, x, y, w, h: labelH, fontSize, pill };
    }
    return panel;
  });

  const connectors = [];
  if (template.connector !== 'none') {
    for (let c = 0; c < cols - 1; c++) {
      const left = pad + colW.slice(0, c + 1).reduce((a, b) => a + b, 0) + gap * c;
      const mid = left + gap / 2;
      if (template.connector === 'arrow') {
        // Arrows only appear in a row (never in the grid): at the row's middle, from one image to the next.
        const y = pad + (template.labelPosition === 'above' ? band : 0) + Math.round(rowH[0] / 2);
        connectors.push({ type: 'arrow', x1: Math.round(left + gap * 0.22), y1: y, x2: Math.round(left + gap * 0.78), y2: y, width: px(6) });
      } else {
        connectors.push({ type: 'divider', x1: Math.round(mid), y1: pad, x2: Math.round(mid), y2: height - pad, width: Math.max(1, px(3)) });
      }
    }
    if (grid && template.connector === 'divider') {
      const mid = Math.round(pad + rowH[0] + band + gap / 2);
      connectors.push({ type: 'divider', x1: pad, y1: mid, x2: width - pad, y2: mid, width: Math.max(1, px(3)) });
    }
  }

  return { width, height, unit, radius: px(14), panels, connectors };
}

// images: drawable sources (HTMLImageElement / ImageBitmap) in template order.
export function drawComposition(ctx, layout, images, template) {
  const { width, height, unit, radius } = layout;
  if (template.background2) {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, template.background);
    g.addColorStop(1, template.background2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = template.background;
  }
  ctx.fillRect(0, 0, width, height);
  const onDark = luminance(template.background2 ? mix(template.background, template.background2) : template.background) < 0.45;

  for (const c of layout.connectors) {
    ctx.save();
    ctx.strokeStyle = onDark ? 'rgba(255,255,255,.55)' : 'rgba(24,24,27,.35)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = c.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (c.type === 'arrow') {
      // Same open chevron head as the arrows drawn on the page.
      const { apex, left, right } = globalThis.PageReviewArrows.arrowHead(c, c.width);
      ctx.lineJoin = 'round';
      ctx.moveTo(c.x1, c.y1);
      ctx.lineTo(...apex);
      ctx.moveTo(...left);
      ctx.lineTo(...apex);
      ctx.lineTo(...right);
      ctx.stroke();
    } else {
      ctx.moveTo(c.x1, c.y1);
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  layout.panels.forEach((p, i) => {
    const { x, y, w, h } = p.image;
    ctx.save();
    ctx.shadowColor = onDark ? 'rgba(0,0,0,.45)' : 'rgba(24,24,27,.18)';
    ctx.shadowBlur = 40 * unit;
    ctx.shadowOffsetY = 10 * unit;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.drawImage(images[i], x, y, w, h);
    ctx.restore();
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.strokeStyle = 'rgba(24,24,27,.12)';
    ctx.lineWidth = Math.max(1, unit);
    ctx.stroke();
    ctx.restore();
    if (p.label) drawLabel(ctx, p.label, template);
  });
}

function drawLabel(ctx, l, template) {
  ctx.save();
  ctx.font = `600 ${l.fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  const inside = template.labelPosition.startsWith('inside');
  if (l.pill) {
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = l.fontSize * 0.4;
    ctx.shadowOffsetY = l.fontSize * 0.08;
    roundRect(ctx, l.x, l.y, l.w, l.h, l.h / 2);
    ctx.fillStyle = l.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = luminance(l.color) > 0.6 ? '#18181b' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(l.text, l.x + l.w / 2, l.y + l.h / 2);
  } else {
    if (inside) {
      // Plain text over a screenshot needs a halo to stay readable.
      ctx.lineWidth = l.fontSize * 0.25;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = luminance(l.color) > 0.5 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.85)';
      ctx.strokeText(l.text, l.x, l.y + l.h / 2);
    }
    ctx.fillStyle = l.color;
    ctx.textAlign = 'left';
    ctx.fillText(l.text, l.x, l.y + l.h / 2);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Relative luminance (0 = black, 1 = white) of a #rrggbb color.
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(a, b) {
  const c = [1, 3, 5].map((i) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// The stored item for a combined image: shaped like a review (so the reviews page,
// the local server and the downloads writer treat it like any other), with no
// comments of its own and a `composite` block describing where each panel came from.
export function compositeReview({ id, template, sources, screenshot, width, height, createdAt = new Date().toISOString() }) {
  return {
    id,
    url: '',
    title: template.name,
    createdAt,
    viewport: { width, height, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    comments: [],
    shapes: [],
    screenshot,
    composite: {
      template: template.name,
      layout: template.count === 4 ? 'grid 2×2' : `${template.count} in a row`,
      sources: sources.map((r, i) => ({
        id: r.id,
        label: template.labels[i]?.text ?? '',
        title: r.title ?? '',
        url: r.url ?? '',
        createdAt: r.createdAt,
        comments: (r.comments ?? []).map((c) => ({ n: c.n, text: c.text, selector: c.target?.selector ?? null })),
      })),
    },
  };
}
