// Settings view: avatar, storage, and the instructions for an AI agent.
import { agentInstructions } from './lib/agent.js';
import { serverHealth } from './lib/server.js';
import { STORAGE_PERMISSIONS, cleanFolder, folderError, getSettings, hasStoragePermission, updateSettings } from './lib/settings.js';
import { h, loadImage, saveFile, toast } from './ui.js';

const AVATAR_PX = 128;
const $ = (id) => document.getElementById(id);
let settings = null;
let health = null;

export async function initSettings() {
  $('avatarUpload').addEventListener('click', () => $('avatarFile').click());
  $('avatarFile').addEventListener('change', async () => {
    const file = $('avatarFile').files[0];
    $('avatarFile').value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    await setAvatarFrom(url, false, "That file isn't an image Chrome can open.").finally(() => URL.revokeObjectURL(url));
  });
  $('avatarUrlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('avatarUrl').value.trim();
    if (!url) return;
    const ok = await setAvatarFrom(
      url,
      true,
      "Couldn't load that image. Some sites don't allow it to be used elsewhere: download it and upload the file instead.",
    );
    if (ok) $('avatarUrl').value = '';
  });
  $('avatarRemove').addEventListener('click', () => save({ avatar: null }));

  // "click", not "change": clicking the option that is already on asks for a permission
  // that was refused or removed since.
  for (const radio of document.querySelectorAll('input[name="storage"]')) {
    radio.addEventListener('click', () => pickStorage(radio.value));
  }
  $('downloadsFolder').addEventListener('change', () => {
    const folder = cleanFolder($('downloadsFolder').value);
    if (!storageError(folderError(folder))) save({ downloadsFolder: folder });
  });
  $('serverUrl').addEventListener('change', async () => {
    const wanted = $('serverUrl').value.trim().replace(/\/+$/, '');
    const ok = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(wanted);
    if (!storageError(ok ? null : 'Only http://localhost or http://127.0.0.1 addresses work.')) save({ serverUrl: wanted });
  });

  for (const radio of document.querySelectorAll('input[name="agentFormat"]')) radio.addEventListener('change', renderAgent);
  $('agentCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('agentText').textContent);
    toast('Copied.');
  });
  $('agentDownload').addEventListener('click', () => {
    const text = $('agentText').textContent;
    const href = `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`;
    saveFile(href, agentFormat() === 'skill' ? 'SKILL.md' : 'page-review-prompt.md');
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings || changes.downloadsRoot) load();
  });
  await load();
}

// Shows (or clears) a problem with a storage field; returns whether there is one.
function storageError(message) {
  $('storageError').textContent = message ?? '';
  $('storageError').hidden = !message;
  return Boolean(message);
}

// Downloads folder and Local server need an optional Chrome permission. It is requested
// here, inside the click, because Chrome only shows the prompt for a user action.
async function pickStorage(mode) {
  storageError(null);
  const wanted = STORAGE_PERMISSIONS[mode];
  const granted = wanted ? await chrome.permissions.request(wanted).catch(() => false) : true;
  if (!granted) {
    render(); // back to the option that was on
    storageError("Chrome didn't allow it, so this option is off. Reviews stay in the browser.");
    return;
  }
  if (mode !== settings.storage) await save({ storage: mode });
  else load();
}

async function save(patch) {
  settings = await updateSettings(patch);
  render(); // storage.onChanged re-renders too; this keeps the form in step right away
  return settings;
}

async function load() {
  settings = await getSettings();
  render();
  // The permission may be missing: removed in chrome://extensions, or never granted to this install.
  if (!(await hasStoragePermission(settings.storage))) {
    storageError("Chrome's permission for this option is off, so reviews only stay in the browser. Click the option to allow it.");
  }
  // Server status is only needed (and only fetched) in server mode.
  health = settings.storage === 'server' ? await serverHealth() : null;
  render();
}

const PERSON_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>';

function render() {
  const preview = $('avatarPreview');
  if (settings.avatar) preview.replaceChildren(h('img', { src: settings.avatar, alt: 'Your avatar' }));
  else preview.innerHTML = PERSON_ICON;
  // Not "empty": that class belongs to the empty reviews list and adds padding.
  preview.classList.toggle('no-image', !settings.avatar);
  $('avatarRemove').hidden = !settings.avatar;

  for (const radio of document.querySelectorAll('input[name="storage"]')) radio.checked = radio.value === settings.storage;
  for (const el of document.querySelectorAll('.option-detail')) el.hidden = el.dataset.for !== settings.storage;
  if (document.activeElement !== $('downloadsFolder')) $('downloadsFolder').value = settings.downloadsFolder;
  if (document.activeElement !== $('serverUrl')) $('serverUrl').value = settings.serverUrl;
  renderStatus();
  renderAgent();
}

let root = null; // absolute path of the folder that holds reviews/, when known

async function renderStatus() {
  const status = $('storageStatus');
  root = null;
  status.className = 'status';
  if (settings.storage === 'downloads') {
    const { downloadsRoot } = await chrome.storage.local.get('downloadsRoot');
    if (downloadsRoot?.folder === settings.downloadsFolder) root = downloadsRoot.path;
    status.textContent = root
      ? `Saving to ${root}`
      : `Saving to Downloads/${settings.downloadsFolder}. The full path shows here once a review is written.`;
  } else if (settings.storage === 'server') {
    root = health?.dataDir ?? null;
    status.classList.add(health ? 'online' : 'offline');
    status.textContent = health
      ? `Connected. Reviews are saved in ${health.dataDir}`
      : 'Server not running. Start it with npm run serve in the page-review repo, or open Claude Code with the MCP server. Reviews are sent once it is up.';
  } else {
    status.textContent = '';
  }
  renderAgent();
}

function agentFormat() {
  return document.querySelector('input[name="agentFormat"]:checked').value;
}

function renderAgent() {
  const format = agentFormat();
  const rootGuess = settings.storage === 'server' ? '~/.page-review' : `~/Downloads/${settings.downloadsFolder}`;
  $('agentText').textContent = agentInstructions({
    format,
    storage: settings.storage,
    root,
    rootGuess,
    folder: settings.downloadsFolder,
  });
  const where =
    format === 'skill'
      ? 'Save it as ~/.claude/skills/page-review/SKILL.md (or in your project\'s .claude/skills/page-review/).'
      : 'Paste it into your agent at the start of a session, or add it to CLAUDE.md or AGENTS.md.';
  $('agentWhere').textContent =
    settings.storage === 'browser'
      ? `${where} With Browser only storage your agent can't open reviews by itself; it will ask you to paste them.`
      : where;
}

// Loads an image, crops it to a centered square and stores it as a small PNG data URL.
async function setAvatarFrom(src, crossOrigin, message) {
  $('avatarError').hidden = true;
  try {
    const img = await loadImage(src, crossOrigin);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = c.height = AVATAR_PX;
    c.getContext('2d').drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_PX,
      AVATAR_PX,
    );
    await save({ avatar: c.toDataURL('image/png') }); // throws if the image was cross-origin without CORS
    return true;
  } catch {
    $('avatarError').textContent = message;
    $('avatarError').hidden = false;
    return false;
  }
}
