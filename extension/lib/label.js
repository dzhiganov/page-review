// A short, searchable name for a page element: a role word plus its visible text, e.g.
// Link "Pricing" or Button "Buy course". Recorded with each comment's target, so an agent
// can search the source for the text instead of decoding a CSS path.
// Loaded as a classic script into the review overlay (exposes globalThis.PageReviewLabel)
// and imported by format.js (the service worker, the reviews page, the server, unit tests).
(() => {
  const MAX_TEXT = 60;
  const ROLES = {
    link: 'Link',
    button: 'Button',
    heading: 'Heading',
    img: 'Image',
    image: 'Image',
    textbox: 'Input',
    searchbox: 'Input',
    combobox: 'Input',
    checkbox: 'Input',
    radio: 'Input',
  };
  const TAGS = {
    a: 'Link',
    button: 'Button',
    input: 'Input',
    textarea: 'Input',
    select: 'Input',
    img: 'Image',
    svg: 'Image',
    picture: 'Image',
    p: 'Text',
  };
  const SECTIONS = new Set(['section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'form']);

  // `el`: plain data about the element (what describe() records): tag, role, type (inputs),
  // classes, text (innerText), placeholder, alt, ariaLabel. Any of them may be missing.
  // Returns { role, text }; text is '' when the element has none.
  function elementLabel(el) {
    const tag = String(el?.tag ?? '').toLowerCase();
    return { role: roleWord(el ?? {}, tag), text: shortText(labelSource(el ?? {}, tag)) };
  }

  function roleWord(el, tag) {
    const role = ROLES[String(el.role ?? '').toLowerCase()];
    if (role) return role;
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(String(el.type ?? '').toLowerCase())) return 'Button';
    if (TAGS[tag]) return TAGS[tag];
    if (/^h[1-6]$/.test(tag)) return 'Heading';
    // Styled spans and divs: class names often say what they are (.btn, .button, .card).
    const classes = el.classes ?? [];
    if (classes.some((c) => /^(btn|button)\b|[-_](btn|button)$/i.test(c))) return 'Button';
    if (classes.some((c) => /card/i.test(c))) return 'Card';
    if (SECTIONS.has(tag)) return 'Section';
    return 'Element';
  }

  // Inputs have no inner text: their placeholder (or label) says what they are; images their alt.
  function labelSource(el, tag) {
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(String(el.type ?? '').toLowerCase())) {
      return el.value || el.ariaLabel;
    }
    if (['input', 'textarea', 'select'].includes(tag)) return el.placeholder || el.ariaLabel;
    if (tag === 'img') return el.alt || el.ariaLabel;
    return collapse(el.text) || el.ariaLabel;
  }

  // Whitespace collapsed, cut at a word boundary to about `max` characters, with "…".
  function shortText(value, max = MAX_TEXT) {
    const s = collapse(value);
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const space = s[max] === ' ' ? max : cut.lastIndexOf(' ');
    return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
  }

  function collapse(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  // Link "Pricing", or just Link when it has no text.
  function labelText(label) {
    return label.text ? `${label.role} "${label.text}"` : label.role;
  }

  globalThis.PageReviewLabel = { MAX_TEXT, elementLabel, shortText, labelText };
})();
