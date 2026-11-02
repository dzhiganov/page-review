// User settings, kept in chrome.storage.local under "settings".

export const STORAGE_MODES = ['browser', 'downloads', 'server'];
export const DEFAULT_SERVER_URL = 'http://localhost:47615';

export const DEFAULTS = {
  // browser: reviews stay in chrome.storage only.
  // downloads: each review is also written to Downloads/<downloadsFolder>/reviews/<id>/.
  // server: each review is sent to the local page-review server (npm run serve / the MCP server).
  storage: 'browser',
  downloadsFolder: 'page-review',
  serverUrl: DEFAULT_SERVER_URL,
  avatar: null, // data URL of a small square image, shown on comment cards
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

export async function updateSettings(patch) {
  const { settings } = await chrome.storage.local.get('settings');
  const next = normalizeSettings({ ...settings, ...patch });
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function normalizeSettings(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!STORAGE_MODES.includes(s.storage)) s.storage = DEFAULTS.storage;
  s.downloadsFolder = cleanFolder(s.downloadsFolder);
  if (folderError(s.downloadsFolder)) s.downloadsFolder = DEFAULTS.downloadsFolder;
  if (typeof s.serverUrl !== 'string' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s.serverUrl.replace(/\/+$/, ''))) {
    s.serverUrl = DEFAULTS.serverUrl;
  }
  s.serverUrl = s.serverUrl.replace(/\/+$/, '');
  if (typeof s.avatar !== 'string' || !s.avatar.startsWith('data:image/')) s.avatar = null;
  return s;
}

// chrome.downloads only accepts relative paths inside the Downloads folder:
// no "..", no leading slash, no characters Windows refuses.
export function cleanFolder(value) {
  return String(value ?? '')
    .split(/[\\/]+/)
    .map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, '').trim().replace(/^\.+$/, '').replace(/[. ]+$/, ''))
    .filter(Boolean)
    .join('/');
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_PART = 64;
const MAX_FOLDER = 120;

// Why a (cleaned) folder name can't be used, or null when it's fine.
export function folderError(folder) {
  if (!folder) return 'Enter a folder name.';
  if (folder.length > MAX_FOLDER) return `Keep the folder path under ${MAX_FOLDER} characters.`;
  for (const part of folder.split('/')) {
    // Windows refuses these names even with an extension ("nul.txt").
    if (RESERVED.test(part.split('.')[0])) return `"${part}" is a reserved name on Windows. Choose another one.`;
    if (part.length > MAX_PART) return `Keep each folder name under ${MAX_PART} characters.`;
  }
  return null;
}

// Whether reviews go to the local server (the AGENT_SYNC flag still forces it on for tests).
export function sendsToServer(settings, flag = false) {
  return flag || settings.storage === 'server';
}
