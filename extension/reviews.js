import { openCompose } from './compose-ui.js';
import { AGENT_SYNC } from './lib/flags.js';
import { toMarkdown } from './lib/format.js';
import { fetchStatuses, pushReview, serverHealth } from './lib/server.js';
import { getSettings, sendsToServer } from './lib/settings.js';
import { removeExport } from './lib/storage.js';
import { initSettings } from './settings-ui.js';
import { button, h, saveFile, toast } from './ui.js';

const list = document.getElementById('list');
const settingsView = document.getElementById('settings');
const lightbox = document.getElementById('lightbox');
const serverEl = document.getElementById('server');
const selectionBar = document.getElementById('selection');
const POLL_MS = 5000;
const TRASH = '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/></svg>';
const DOWNLOAD = '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
const MAX_COMBINE = 4;
let statuses = null; // server mode only: Map id -> server summary, null when the server is offline
let serverMode = AGENT_SYNC;
let lastSignature = '';
const pushAttempted = new Set(); // server mode only: auto-resend each review at most once per page load
let refreshing = null;
let queued = null;
let reviewsById = new Map();
let selected = []; // ids, in the order they were picked
let dragId = null;

init();

function init() {
  lightbox.addEventListener('click', () => lightbox.close());
  chrome.storage.onChanged.addListener((changes) => {
    if (Object.keys(changes).some((k) => k.startsWith('review:') || k === 'synced' || k === 'settings')) refresh(true);
  });
  window.addEventListener('hashchange', showView);
  document.getElementById('combine').addEventListener('click', () => combine(selected.map((id) => reviewsById.get(id))));
  document.getElementById('clearSelection').addEventListener('click', () => setSelection([]));
  showView();
  initSettings();
  refresh(true);
  setInterval(() => serverMode && document.visibilityState === 'visible' && refresh(false), POLL_MS);
}

function showView() {
  const settings = location.hash === '#settings';
  list.hidden = settings;
  settingsView.hidden = !settings;
  serverEl.classList.toggle('off-view', settings);
  for (const a of document.querySelectorAll('.tabs a')) {
    a.toggleAttribute('aria-current', a.dataset.view === (settings ? 'settings' : 'reviews'));
  }
  updateSelectionBar();
}

// One refresh at a time; calls that arrive meanwhile collapse into one follow-up run.
function refresh(force) {
  if (refreshing) {
    queued = queued || force ? true : false;
    return refreshing;
  }
  refreshing = doRefresh(force).finally(() => {
    refreshing = null;
    if (queued !== null) {
      const again = queued;
      queued = null;
      refresh(again);
    }
  });
  return refreshing;
}

async function doRefresh(force) {
  const reviews = await loadReviews();
  serverMode = sendsToServer(await getSettings(), AGENT_SYNC);
  serverEl.hidden = !serverMode;
  if (serverMode) {
    const health = await serverHealth();
    renderServer(health);
    statuses = health ? await fetchStatuses() : null;
    // The server lost a review (or it was saved while offline): send it again.
    if (statuses) {
      const missing = reviews.filter((r) => !statuses.has(r.id) && !pushAttempted.has(r.id));
      missing.forEach((r) => pushAttempted.add(r.id));
      if (missing.length) {
        for (const r of missing) await pushReview(r).catch(() => {});
        return doRefresh(true);
      }
    }
  } else {
    statuses = null;
  }
  // Re-render only when something visible changed, so polling doesn't flicker.
  const signature = JSON.stringify([
    reviews.map((r) => r.id),
    serverMode,
    statuses && [...statuses.values()].map((s) => s.open),
  ]);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;
  reviewsById = new Map(reviews.map((r) => [r.id, r]));
  selected = selected.filter((id) => reviewsById.has(id));
  render(reviews);
}

function renderServer(health) {
  serverEl.className = `server${health ? ' online' : ''}${location.hash === '#settings' ? ' off-view' : ''}`;
  serverEl.textContent = health ? 'Connected to Claude Code' : 'Claude Code not running';
}

async function loadReviews() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith('review:'))
    .map(([, v]) => v)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function render(reviews) {
  if (!reviews.length) {
    list.replaceChildren(
      h('p', { class: 'empty' }, 'No reviews yet. Open any page, click the Page Review icon (or Alt+Shift+R), draw, and Save.'),
    );
    updateSelectionBar();
    return;
  }
  const groups = new Map();
  for (const r of reviews) {
    const label = dayLabel(new Date(r.createdAt));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(r);
  }
  list.replaceChildren(
    ...[...groups].flatMap(([label, items]) => [
      h('h2', { class: 'day' }, label),
      h('div', { class: 'grid' }, ...items.map((r) => card(r, statuses?.get(r.id)))),
    ]),
  );
  updateSelectionBar();
}

// "Today", "Yesterday", a weekday within the last week, then the date.
function dayLabel(date) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

function card(r, remote) {
  const shot = h('button', { class: 'shot', title: 'View full size', draggable: 'true' }, h('img', { src: r.screenshot, alt: 'Annotated screenshot' }));
  shot.addEventListener('click', () => {
    lightbox.querySelector('img').src = r.screenshot;
    lightbox.showModal();
  });

  let host = r.url;
  try {
    host = new URL(r.url).host || r.url;
  } catch {}
  const time = new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const noun = r.composite ? 'image' : 'review';

  const del = button('', 'icon-btn danger', async () => {
    if (!confirm(`Delete this ${noun}?`)) return;
    await removeExport(r.id);
    await chrome.storage.local.remove(`review:${r.id}`);
  });
  del.innerHTML = TRASH;
  del.title = 'Delete';
  del.setAttribute('aria-label', `Delete ${noun}`);

  const download = button('', 'icon-btn', () => saveFile(r.screenshot, `${slug(r.title || host || 'review')}-${r.id}.png`));
  download.innerHTML = DOWNLOAD;
  download.title = 'Download image';
  download.setAttribute('aria-label', 'Download image');

  const pick = h('input', { type: 'checkbox', 'aria-label': 'Select to combine' });
  pick.checked = selected.includes(r.id);
  pick.addEventListener('change', () =>
    setSelection(pick.checked ? [...selected.filter((id) => id !== r.id), r.id] : selected.filter((id) => id !== r.id)),
  );

  const titleEl = r.composite
    ? h('span', { class: 'title', title: r.title }, r.title)
    : h('a', { class: 'title', href: r.url, target: '_blank', rel: 'noreferrer', title: r.title || r.url }, r.title || host);
  const meta = r.composite ? `Combined from ${r.composite.sources.length} reviews · ${time}` : `${host} · ${time}`;

  const info = [
    h('div', { class: 'title-row' }, h('div', {}, titleEl, h('div', { class: 'meta' }, meta)), download, del),
  ];
  if (serverMode) {
    info.push(
      remote
        ? h('div', { class: 'sync sent' }, remote.open ? `Sent to Claude · ${remote.open} of ${remote.total} open` : 'All addressed ✓')
        : h('div', { class: 'sync' }, 'Not sent to Claude yet'),
    );
  }
  info.push(
    h(
      'div',
      { class: 'actions' },
      button('Copy as image', '', async () => {
        const blob = await (await fetch(r.screenshot)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(r.composite ? 'Image copied.' : 'Screenshot copied.');
      }),
      button('Copy as Markdown', '', async () => {
        await navigator.clipboard.writeText(toMarkdown(r));
        toast('Markdown copied.');
      }),
    ),
  );

  const article = h(
    'article',
    { class: `review${selected.includes(r.id) ? ' selected' : ''}`, 'data-id': r.id },
    h('div', { class: 'shot-wrap' }, shot, h('label', { class: 'pick', title: 'Select to combine' }, pick)),
    h('div', { class: 'info' }, ...info),
  );
  enableDrop(article, shot, r);
  return article;
}

// Drag one screenshot onto another to combine the two.
function enableDrop(article, shot, r) {
  shot.addEventListener('dragstart', (e) => {
    dragId = r.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', r.id);
    document.body.classList.add('dragging');
  });
  shot.addEventListener('dragend', () => {
    dragId = null;
    document.body.classList.remove('dragging');
    for (const el of list.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
  });
  article.addEventListener('dragover', (e) => {
    if (!dragId || dragId === r.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    article.classList.add('drop-target');
  });
  article.addEventListener('dragleave', (e) => {
    if (!article.contains(e.relatedTarget)) article.classList.remove('drop-target');
  });
  article.addEventListener('drop', (e) => {
    e.preventDefault();
    article.classList.remove('drop-target');
    const dragged = reviewsById.get(dragId || e.dataTransfer.getData('text/plain'));
    if (!dragged || dragged.id === r.id) return;
    // Older first, so "Before" is the earlier screenshot.
    combine([dragged, r].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });
}

function setSelection(ids) {
  selected = ids;
  for (const article of list.querySelectorAll('article.review')) {
    const on = selected.includes(article.dataset.id);
    article.classList.toggle('selected', on);
    article.querySelector('.pick input').checked = on;
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  const n = selected.length;
  selectionBar.hidden = n === 0 || location.hash === '#settings';
  document.body.classList.toggle('selecting', n > 0);
  const combineBtn = document.getElementById('combine');
  combineBtn.disabled = n < 2 || n > MAX_COMBINE;
  document.getElementById('selectionCount').textContent =
    n < 2 ? `${n} selected. Pick 2 to ${MAX_COMBINE}.` : n > MAX_COMBINE ? `${n} selected. Up to ${MAX_COMBINE} can be combined.` : `${n} selected`;
}

async function combine(reviews) {
  const created = await openCompose(reviews.filter(Boolean));
  if (created) {
    setSelection([]);
    toast('Combined image created.');
  }
}

function slug(s) {
  return (
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'review'
  );
}
