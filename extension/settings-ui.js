// Settings view: avatar, storage, and the instructions for an AI agent.
import { agentInstructions } from './lib/agent.js';
import { serverHealth } from './lib/server.js';
import { getSettings, updateSettings } from './lib/settings.js';
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

  for (const radio of document.querySelectorAll('input[name="storage"]')) {
    radio.addEventListener('change', () => save({ storage: radio.value }));
  }
  $('downloadsFolder').addEventListener('change', () => save({ downloadsFolder: $('downloadsFolder').value }));
  $('serverUrl').addEventListener('change', async () => {
    const wanted = $('serverUrl').value.trim().replace(/\/+$/, '');
    const next = await save({ serverUrl: wanted });
    if (next.serverUrl !== wanted) toast('Only http://localhost or http://127.0.0.1 addresses work.');
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

async function save(patch) {
  settings = await updateSettings(patch);
  render(); // storage.onChanged re-renders too; this keeps the form in step right away
  return settings;
}

async function load() {
  settings = await getSettings();
  render();
  // Server status is only needed (and only fetched) in server mode.
  health = settings.storage === 'server' ? await serverHealth() : null;
  render();
}

function render() {
  const preview = $('avatarPreview');
  preview.replaceChildren(settings.avatar ? h('img', { src: settings.avatar, alt: 'Your avatar' }) : '');
  preview.classList.toggle('empty', !settings.avatar);
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
