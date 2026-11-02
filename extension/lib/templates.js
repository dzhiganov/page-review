// Templates for combining screenshots into one image. Built-ins live here; the
// user's own presets are kept in chrome.storage.local under "templates".

export const LABEL_POSITIONS = ['above', 'below', 'inside-top', 'inside-bottom', 'none'];
export const LABEL_STYLES = ['pill', 'text'];
export const CONNECTORS = ['none', 'arrow', 'divider'];
export const COUNTS = [2, 3, 4]; // 2 or 3 in a row, 4 as a 2×2 grid

const ACCENT = '#7048e8';
const INK = '#18181b';

export const BUILT_IN_TEMPLATES = [
  {
    id: 'before-after',
    name: 'Before / After',
    count: 2,
    labels: [
      { text: 'Before', color: '#868e96' },
      { text: 'After', color: ACCENT },
    ],
    labelPosition: 'above',
    labelStyle: 'pill',
    background: '#f3f0ff',
    background2: '#e5dbff',
    padding: 56,
    connector: 'arrow',
  },
  {
    id: 'expected-actual',
    name: 'Expected / Actual',
    count: 2,
    labels: [
      { text: 'Expected', color: '#2f9e44' },
      { text: 'Actual', color: '#e03131' },
    ],
    labelPosition: 'above',
    labelStyle: 'pill',
    background: '#ffffff',
    background2: null,
    padding: 48,
    connector: 'divider',
  },
  {
    id: 'desktop-mobile',
    name: 'Desktop / Mobile',
    count: 2,
    labels: [
      { text: 'Desktop', color: '#e9ecef' },
      { text: 'Mobile', color: '#e9ecef' },
    ],
    labelPosition: 'below',
    labelStyle: 'text',
    background: '#212529',
    background2: '#343a40',
    padding: 64,
    connector: 'none',
  },
  {
    id: 'light-dark',
    name: 'Light / Dark',
    count: 2,
    labels: [
      { text: 'Light', color: '#f8f9fa' },
      { text: 'Dark', color: INK },
    ],
    labelPosition: 'above',
    labelStyle: 'pill',
    background: '#dee2e6',
    background2: '#868e96',
    padding: 56,
    connector: 'none',
  },
  {
    id: 'steps',
    name: 'Step 1 → 2 → 3',
    count: 3,
    labels: [
      { text: 'Step 1', color: ACCENT },
      { text: 'Step 2', color: ACCENT },
      { text: 'Step 3', color: ACCENT },
    ],
    labelPosition: 'above',
    labelStyle: 'pill',
    background: '#f8f9fa',
    background2: null,
    padding: 48,
    connector: 'arrow',
  },
  {
    id: 'grid',
    name: '2×2 grid',
    count: 4,
    labels: ['A', 'B', 'C', 'D'].map((text) => ({ text, color: INK })),
    labelPosition: 'inside-top',
    labelStyle: 'pill',
    background: '#f1f3f5',
    background2: null,
    padding: 40,
    connector: 'none',
  },
].map((t) => ({ ...t, builtIn: true }));

const HEX = /^#[0-9a-f]{6}$/i;

// Fills in defaults and drops anything invalid, so stored presets can't break rendering.
export function normalizeTemplate(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const count = COUNTS.includes(t.count) ? t.count : 2;
  const labels = Array.from({ length: count }, (_, i) => {
    const l = Array.isArray(t.labels) ? t.labels[i] : null;
    return {
      text: typeof l?.text === 'string' ? l.text.slice(0, 40) : '',
      color: HEX.test(l?.color) ? l.color : INK,
    };
  });
  let connector = CONNECTORS.includes(t.connector) ? t.connector : 'none';
  if (count === 4 && connector === 'arrow') connector = 'none'; // no reading order to point along in a grid
  return {
    id: typeof t.id === 'string' && t.id ? t.id : `user-${Date.now().toString(36)}`,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 60) : 'Untitled',
    count,
    labels,
    labelPosition: LABEL_POSITIONS.includes(t.labelPosition) ? t.labelPosition : 'above',
    labelStyle: LABEL_STYLES.includes(t.labelStyle) ? t.labelStyle : 'pill',
    background: HEX.test(t.background) ? t.background : '#ffffff',
    background2: HEX.test(t.background2) ? t.background2 : null,
    padding: Number.isFinite(t.padding) ? Math.min(160, Math.max(0, Math.round(t.padding))) : 48,
    connector,
    builtIn: t.builtIn === true,
  };
}

export async function loadUserTemplates() {
  const { templates } = await chrome.storage.local.get('templates');
  return (Array.isArray(templates) ? templates : []).map((t) => normalizeTemplate({ ...t, builtIn: false }));
}

export async function allTemplates() {
  return [...BUILT_IN_TEMPLATES.map(normalizeTemplate), ...(await loadUserTemplates())];
}

// Saving under the name of an existing preset replaces it.
export async function saveUserTemplate(template) {
  const list = await loadUserTemplates();
  const existing = list.find((t) => t.name.toLowerCase() === template.name.trim().toLowerCase());
  const saved = normalizeTemplate({
    ...template,
    id: existing?.id ?? `user-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    builtIn: false,
  });
  const next = existing ? list.map((t) => (t.id === existing.id ? saved : t)) : [...list, saved];
  await chrome.storage.local.set({ templates: next.map(({ builtIn, ...t }) => t) });
  return saved;
}

export async function deleteUserTemplate(id) {
  const list = await loadUserTemplates();
  await chrome.storage.local.set({ templates: list.filter((t) => t.id !== id).map(({ builtIn, ...t }) => t) });
}
