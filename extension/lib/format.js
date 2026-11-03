// Turns a stored review into Markdown an AI agent can read.
import './label.js'; // globalThis.PageReviewLabel

const { elementLabel, labelText } = globalThis.PageReviewLabel;

const KIND_LABEL = {
  arrow: 'Arrow pointing at the target element',
  box: 'Box drawn around the target element',
  freehand: 'Freehand mark over/around the target element',
  text: 'Note written directly over the target element',
};

// What a mark without text says, for the short (clipboard) form.
const KIND_SHORT = {
  arrow: 'an arrow points at it',
  box: 'a box is drawn around it',
  freehand: 'it is circled or marked',
};

// `screenshot` is the image's file path, or null when the image is shared separately.
// `brief`: the short form that "Copy for agent" in the editor puts on the clipboard: each
// comment with its element and text, then the steps.
export function toMarkdown(review, screenshot = null, { brief = false } = {}) {
  if (review.composite) return compositeMarkdown(review, screenshot);
  if (brief) return briefMarkdown(review, screenshot);
  const { viewport: vp } = review;
  const out = [];
  out.push(`# Page review: ${review.title || review.url}`, '');
  out.push(`- **URL:** ${review.url}`);
  out.push(`- **Captured:** ${new Date(review.createdAt).toLocaleString()}`);
  const shot = review.frame ?? { w: vp.width, h: vp.height };
  const shotPx = `${Math.round(shot.w * vp.devicePixelRatio)}×${Math.round(shot.h * vp.devicePixelRatio)} px`;
  out.push(
    `- **Viewport:** ${vp.width}×${vp.height} CSS px, devicePixelRatio ${vp.devicePixelRatio}` +
      (review.frame ? '' : ` (screenshot is ${shotPx})`),
  );
  if (review.frame) {
    const f = review.frame;
    out.push(`- **Frame:** x=${f.x}, y=${f.y}, ${f.w}×${f.h} CSS px of the viewport (the screenshot shows only this area, ${shotPx})`);
  }
  out.push(`- **Scroll position:** x=${review.scroll.x}, y=${review.scroll.y}`);
  out.push(
    `- **Screenshot:** ${screenshot ? `\`${screenshot}\`` : 'the annotated screenshot, shared separately'}. ` +
      "The reviewer's drawings are baked in; the numbered pins and badges match the comment numbers below.",
  );
  out.push('');
  out.push(
    review.frame
      ? "Coordinates are CSS pixels relative to the frame's top-left corner (the screenshot's top-left) at capture time."
      : 'Coordinates are CSS pixels relative to the viewport at capture time.',
    '',
  );
  const open = review.comments.filter((c) => (c.status ?? 'open') === 'open').length;
  const tracked = review.comments.some((c) => c.status && c.status !== 'open');
  out.push(`## Comments (${review.comments.length}${tracked ? `, ${open} open` : ''})`, '');

  for (const c of review.comments) {
    out.push(c.target ? `### ${c.n}. ${nameOf(c.target)}` : `### ${c.n}`, '');
    out.push(c.text ? c.text.split('\n').map((l) => `> ${l}`).join('\n') : '> _(drawing only, no text)_');
    out.push('');
    if (c.status && c.status !== 'open') out.push(`- **Status:** ${c.status}${c.note ? `: ${c.note}` : ''}`);
    const extra = c.marks?.length > 1 ? ` (drawn as ${c.marks.join(' + ')})` : '';
    out.push(`- **Annotation:** ${KIND_LABEL[c.kind] ?? c.kind}${extra}`);
    const t = c.target;
    if (!t) {
      out.push('- **Target:** none found', '');
      continue;
    }
    out.push(`- **Target selector:** \`${t.selector}\``);
    if (t.text) out.push(`- **Target text:** "${t.text}"`);
    if (t.ariaLabel) out.push(`- **aria-label:** "${t.ariaLabel}"`);
    out.push(`- **Target box:** x=${t.rect.x}, y=${t.rect.y}, ${t.rect.w}×${t.rect.h}`);
    if (t.ancestors.length) out.push(`- **Ancestors (nearest first):** ${t.ancestors.map((a) => `\`${a}\``).join(' < ')}`);
    const styles = Object.entries(t.styles)
      .filter(([, v]) => v && v !== 'normal' && v !== 'none' && v !== '0px' && v !== 'auto')
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    if (styles) out.push(`- **Computed styles:** ${styles}`);
    out.push('', '````html', t.html, '````', '');
  }
  out.push(...stepsSection(review));
  return out.join('\n');
}

// Steps: an ordered list, numbered like the purple step badges in the screenshot.
function stepsSection(review, brief = false) {
  const steps = review.steps ?? [];
  if (!steps.length) return [];
  if (brief) {
    const out = ['### Steps', ''];
    for (const st of steps) {
      const where = st.target ? `${nameOf(st.target)} (${shortSelector(st.target)})` : '(no element found)';
      out.push(`${st.n}. ${oneLine(st.text) || '_(no text)_'} — ${where}`);
    }
    return [...out, ''];
  }
  const out = [`## Steps (${steps.length})`, ''];
  out.push('Steps the reviewer numbered on the page, in order (filled purple badges in the screenshot).', '');
  for (const st of steps) {
    out.push(`${st.n}. ${oneLine(st.text) || '_(no text)_'}`);
    out.push(`   - **Target:** ${st.target ? `${nameOf(st.target)} (\`${st.target.selector}\`)` : 'none found'}`);
  }
  out.push('');
  return out;
}

function briefMarkdown(review, screenshot) {
  const { viewport: vp, frame: f } = review;
  const size = `viewport ${vp.width}×${vp.height}${f ? `; frame ${f.w}×${f.h} at x=${f.x}, y=${f.y}` : ''}`;
  const out = ['## Page feedback', `${review.title || review.url} — ${review.url}   (${size})`, ''];
  out.push(
    screenshot
      ? `Screenshot: \`${screenshot}\` (its numbered badges match the numbers below).`
      : "Screenshot: not attached (this text doesn't include the image).",
    '',
  );
  // A mark without text only says something when it points at an element.
  for (const c of review.comments.filter((c) => c.text || c.target)) {
    out.push(`### ${c.n}. ${targetLabel(c.target)}`);
    out.push(c.text || `_(no text: ${KIND_SHORT[c.kind] ?? 'marked'})_`, '');
  }
  out.push(...stepsSection(review, true));
  return out.join('\n').trimEnd() + '\n';
}

// The element in a heading: what it is and says, then its selector, e.g. Link "Pricing" — a:nth-of-type(3).
function targetLabel(t) {
  if (!t) return '(no element found)';
  return `${nameOf(t)} — ${shortSelector(t)}`;
}

// Link "Pricing". Reviews saved before labels were recorded get one from the stored tag and text.
function nameOf(t) {
  return labelText(t.label ?? elementLabel(t));
}

// The selector, or just the tag (and id) when the full path is too long to read.
function shortSelector(t) {
  return t.selector.length <= 60 ? t.selector : `${t.tag}${t.id ? `#${t.id}` : ''}`;
}

function oneLine(text) {
  return (text ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

// A combined image (made on the reviews page from several reviews with a template).
function compositeMarkdown(review, screenshot) {
  const { composite } = review;
  const order = composite.sources.length === 4 ? 'left to right, top to bottom' : 'left to right';
  const out = [`# Combined image: ${review.title}`, ''];
  out.push(`- **Made from:** ${composite.sources.length} reviews, ${composite.layout} (${order})`);
  out.push(`- **Created:** ${new Date(review.createdAt).toLocaleString()}`);
  out.push(
    `- **Image:** ${screenshot ? `\`${screenshot}\`` : 'the combined image, shared separately'}. ` +
      "Each panel is an annotated screenshot; the numbered badges in a panel match that panel's comments below.",
  );
  out.push('');
  composite.sources.forEach((s, i) => {
    out.push(`## Panel ${i + 1}${s.label ? `: ${s.label}` : ''}`, '');
    if (s.url) out.push(`- **Page:** ${s.title ? `${s.title}, ` : ''}${s.url}`);
    if (s.createdAt) out.push(`- **Captured:** ${new Date(s.createdAt).toLocaleString()}`);
    out.push(`- **Review id:** ${s.id}`);
    for (const c of s.comments) {
      out.push(`- **#${c.n}:** ${c.text ? c.text.replace(/\n/g, ' ') : '_(drawing only, no text)_'}${c.selector ? ` (\`${c.selector}\`)` : ''}`);
    }
    out.push('');
  });
  return out.join('\n');
}
