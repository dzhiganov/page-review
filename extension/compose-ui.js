// The "Combine" dialog: pick a template, order the images, adjust, create a new item.
import { FONT_FAMILY, compositeReview, drawComposition, layoutComposition } from './lib/compose.js';
import { exportReview } from './lib/storage.js';
import { allTemplates, deleteUserTemplate, normalizeTemplate, saveUserTemplate } from './lib/templates.js';
import { h, loadImage } from './ui.js';

const dialog = document.getElementById('compose');
const canvas = document.getElementById('composeCanvas');
const tplSelect = document.getElementById('tplSelect');
const slotsEl = document.getElementById('composeSlots');
const fields = {
  labelPosition: document.getElementById('labelPosition'),
  labelStyle: document.getElementById('labelStyle'),
  connector: document.getElementById('connector'),
  padding: document.getElementById('padding'),
  background: document.getElementById('background'),
  gradient: document.getElementById('gradient'),
  background2: document.getElementById('background2'),
};
const UP = '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>';

let state = null; // { reviews, images, templates, template, resolve }
let frame = 0;

dialog.addEventListener('close', () => finish(false));
document.getElementById('composeCancel').addEventListener('click', () => dialog.close());
document.getElementById('composeCreate').addEventListener('click', create);
document.getElementById('tplSave').addEventListener('click', saveTemplate);
document.getElementById('tplDelete').addEventListener('click', deleteTemplate);
tplSelect.addEventListener('change', () => useTemplate(state.templates.find((t) => t.id === tplSelect.value)));
for (const [key, el] of Object.entries(fields)) {
  el.addEventListener('input', () => {
    const t = state.template;
    if (key === 'gradient') t.background2 = el.checked ? fields.background2.value : null;
    else if (key === 'background2') t.background2 = fields.gradient.checked ? el.value : null;
    else if (key === 'padding') t.padding = Number(el.value);
    else t[key] = el.value;
    state.template = normalizeTemplate(t);
    syncFields();
    schedule();
  });
}

// Resolves to the created item, or null when cancelled.
export async function openCompose(reviews) {
  const images = await Promise.all(reviews.map((r) => loadImage(r.screenshot)));
  const templates = await allTemplates();
  const first = templates.find((t) => t.count === reviews.length);
  return new Promise((resolve) => {
    state = { reviews: [...reviews], images, templates, template: null, resolve };
    document.getElementById('composeTitle').textContent = `Combine ${reviews.length} images`;
    renderTemplateOptions(first.id);
    useTemplate(first);
    dialog.showModal();
  });
}

function finish(created) {
  if (!state) return;
  const { resolve } = state;
  state = null;
  resolve(created);
}

function renderTemplateOptions(selectedId) {
  const n = state.reviews.length;
  const option = (t) => {
    const o = h('option', { value: t.id }, t.count === n ? t.name : `${t.name} (needs ${t.count})`);
    o.disabled = t.count !== n;
    return o;
  };
  const builtIn = state.templates.filter((t) => t.builtIn);
  const mine = state.templates.filter((t) => !t.builtIn);
  tplSelect.replaceChildren(
    h('optgroup', { label: 'Built-in' }, ...builtIn.map(option)),
    ...(mine.length ? [h('optgroup', { label: 'My templates' }, ...mine.map(option))] : []),
  );
  tplSelect.value = selectedId;
}

function useTemplate(t) {
  state.template = normalizeTemplate(structuredClone(t));
  document.getElementById('tplDelete').hidden = t.builtIn;
  syncFields();
  renderSlots();
  schedule();
}

function syncFields() {
  const t = state.template;
  fields.labelPosition.value = t.labelPosition;
  fields.labelStyle.value = t.labelStyle;
  fields.labelStyle.disabled = t.labelPosition === 'none';
  fields.connector.value = t.connector;
  fields.connector.querySelector('[value="arrow"]').disabled = t.count === 4;
  fields.padding.value = t.padding;
  fields.background.value = t.background;
  fields.gradient.checked = Boolean(t.background2);
  fields.background2.value = t.background2 ?? t.background;
  fields.background2.disabled = !t.background2;
}

// One row per position: the image there, its label and color, and "move up".
function renderSlots() {
  const t = state.template;
  slotsEl.replaceChildren(
    ...state.reviews.map((r, i) => {
      const text = h('input', { type: 'text', value: t.labels[i].text, placeholder: `Label ${i + 1}`, 'aria-label': `Label ${i + 1}` });
      text.addEventListener('input', () => {
        state.template.labels[i].text = text.value;
        schedule();
      });
      const color = h('input', { type: 'color', value: t.labels[i].color, 'aria-label': `Label ${i + 1} color` });
      color.addEventListener('input', () => {
        state.template.labels[i].color = color.value;
        schedule();
      });
      const up = h('button', { type: 'button', class: 'icon-btn', title: 'Move up', 'aria-label': `Move image ${i + 1} up` });
      up.innerHTML = UP;
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        for (const list of [state.reviews, state.images]) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        renderSlots();
        schedule();
      });
      return h(
        'li',
        {},
        h('img', { src: r.screenshot, alt: '', title: r.title || r.url }),
        text,
        color,
        up,
      );
    }),
  );
}

function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}

function draw() {
  if (!state) return null;
  const ctx = canvas.getContext('2d');
  const measure = (text, size) => {
    ctx.font = `600 ${size}px ${FONT_FAMILY}`;
    return ctx.measureText(text).width;
  };
  const sizes = state.images.map((img) => ({ w: img.naturalWidth, h: img.naturalHeight }));
  const layout = layoutComposition(state.template, sizes, measure);
  canvas.width = layout.width;
  canvas.height = layout.height;
  drawComposition(ctx, layout, state.images, state.template);
  return layout;
}

const createBtn = document.getElementById('composeCreate');

async function create() {
  if (!state || state.creating) return; // a double click must not make two items
  state.creating = true;
  createBtn.disabled = true;
  try {
    await createItem();
  } finally {
    createBtn.disabled = false;
    if (state) state.creating = false;
  }
}

async function createItem() {
  cancelAnimationFrame(frame);
  const current = state;
  const layout = draw();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const screenshot = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  const item = compositeReview({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    template: current.template,
    sources: current.reviews,
    screenshot,
    width: layout.width,
    height: layout.height,
  });
  if (state !== current) return; // the dialog was closed meanwhile
  await chrome.storage.local.set({ [`review:${item.id}`]: item });
  state = null;
  dialog.close();
  current.resolve(item);
  exportReview(item); // to the Downloads folder or the local server, per the storage setting
}

async function saveTemplate() {
  const current = state.template;
  const name = prompt('Template name', current.builtIn ? '' : current.name);
  if (!name?.trim()) return;
  const saved = await saveUserTemplate({ ...current, name });
  state.templates = await allTemplates();
  renderTemplateOptions(saved.id);
  state.template = normalizeTemplate(structuredClone(saved));
  document.getElementById('tplDelete').hidden = false;
}

async function deleteTemplate() {
  const current = state.template;
  if (current.builtIn || !confirm(`Delete the template "${current.name}"?`)) return;
  await deleteUserTemplate(current.id);
  state.templates = await allTemplates();
  const first = state.templates.find((t) => t.count === state.reviews.length);
  renderTemplateOptions(first.id);
  useTemplate(first);
}
