// Turns a stored review into Markdown an AI agent can read.

const KIND_LABEL = {
  arrow: 'Arrow pointing at the target element',
  box: 'Box drawn around the target element',
  freehand: 'Freehand mark over/around the target element',
  text: 'Note written directly over the target element',
};

// `screenshot` is the image's file path, or null when the image is shared separately.
export function toMarkdown(review, screenshot = null) {
  const { viewport: vp } = review;
  const out = [];
  out.push(`# Page review: ${review.title || review.url}`, '');
  out.push(`- **URL:** ${review.url}`);
  out.push(`- **Captured:** ${new Date(review.createdAt).toLocaleString()}`);
  out.push(
    `- **Viewport:** ${vp.width}×${vp.height} CSS px, devicePixelRatio ${vp.devicePixelRatio} ` +
      `(screenshot is ${Math.round(vp.width * vp.devicePixelRatio)}×${Math.round(vp.height * vp.devicePixelRatio)} px)`,
  );
  out.push(`- **Scroll position:** x=${review.scroll.x}, y=${review.scroll.y}`);
  out.push(
    `- **Screenshot:** ${screenshot ? `\`${screenshot}\`` : 'the annotated screenshot, shared separately'}. ` +
      "The reviewer's drawings are baked in; the numbered pins and badges match the comment numbers below.",
  );
  out.push('');
  out.push('Coordinates are CSS pixels relative to the viewport at capture time.', '');
  const open = review.comments.filter((c) => (c.status ?? 'open') === 'open').length;
  const tracked = review.comments.some((c) => c.status && c.status !== 'open');
  out.push(`## Comments (${review.comments.length}${tracked ? `, ${open} open` : ''})`, '');

  for (const c of review.comments) {
    out.push(`### ${c.n}`, '');
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
  return out.join('\n');
}
