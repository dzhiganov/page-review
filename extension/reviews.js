import { AGENT_SYNC } from './lib/flags.js';
import { toMarkdown } from './lib/format.js';
import { deleteRemote, fetchStatuses, pushReview, serverHealth } from './lib/server.js';

const list = document.getElementById('list');
const lightbox = document.getElementById('lightbox');
const serverEl = document.getElementById('server');
const toastEl = document.getElementById('toast');
const POLL_MS = 5000;
const TRASH = '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14h10l1-14"/></svg>';
let toastTimer;
let statuses = null; // agent sync only: Map id -> server summary, null when the server is offline
let lastSignature = '';
const pushAttempted = new Set(); // agent sync only: auto-resend each review at most once per page load
let refreshing = null;
let queued = null;

init();

function init() {
  lightbox.addEventListener('click', () => lightbox.close());
  chrome.storage.onChanged.addListener((changes) => {
    if (Object.keys(changes).some((k) => k.startsWith('review:') || k === 'synced')) refresh(true);
  });
  refresh(true);
  if (AGENT_SYNC) setInterval(() => document.visibilityState === 'visible' && refresh(false), POLL_MS);
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
  if (AGENT_SYNC) {
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
  }
  // Re-render only when something visible changed, so polling doesn't flicker.
  const signature = JSON.stringify([
    reviews.map((r) => r.id),
    statuses && [...statuses.values()].map((s) => s.open),
  ]);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;
  render(reviews);
}

function renderServer(health) {
  serverEl.hidden = false;
  serverEl.className = `server${health ? ' online' : ''}`;
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
  const shot = h('button', { class: 'shot', title: 'View full size' }, h('img', { src: r.screenshot, alt: 'Annotated screenshot' }));
  shot.addEventListener('click', () => {
    lightbox.querySelector('img').src = r.screenshot;
    lightbox.showModal();
  });

  let host = r.url;
  try {
    host = new URL(r.url).host || r.url;
  } catch {}
  const time = new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const del = button('', 'icon-btn', async () => {
    if (!confirm('Delete this review?')) return;
    if (AGENT_SYNC) await deleteRemote(r.id);
    await chrome.storage.local.remove(`review:${r.id}`);
  });
  del.innerHTML = TRASH;
  del.title = 'Delete';
  del.setAttribute('aria-label', 'Delete review');

  const info = [
    h(
      'div',
      { class: 'title-row' },
      h(
        'div',
        {},
        h('a', { class: 'title', href: r.url, target: '_blank', rel: 'noreferrer', title: r.title || r.url }, r.title || host),
        h('div', { class: 'meta' }, `${host} · ${time}`),
      ),
      del,
    ),
  ];
  if (AGENT_SYNC) {
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
        toast('Screenshot copied.');
      }),
      button('Copy as Markdown', '', async () => {
        await navigator.clipboard.writeText(toMarkdown(r));
        toast('Markdown copied.');
      }),
    ),
  );

  return h('article', { class: 'review', 'data-id': r.id }, shot, h('div', { class: 'info' }, ...info));
}

function button(label, cls, onClick) {
  const b = h('button', cls ? { class: cls } : {}, label);
  b.addEventListener('click', onClick);
  return b;
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3000);
}
