// Where reviews go besides chrome.storage, per the "storage" setting (lib/settings.js):
//   browser   - nowhere else
//   downloads - files in <Downloads>/<folder>/reviews/<id>/ via chrome.downloads
//   server    - the local page-review server (lib/server.js), which writes ~/.page-review/reviews/<id>/
// Both file layouts are the same: screenshot.png, review.json, review.md.
import { AGENT_SYNC } from './flags.js';
import { toMarkdown } from './format.js';
import { deleteRemote, pushReview } from './server.js';
import { getSettings, sendsToServer } from './settings.js';

// Returns true/false for whether the copy outside the browser was written, or null
// when the setting keeps reviews in the browser only.
export async function exportReview(review, settings) {
  settings ??= await getSettings();
  if (sendsToServer(settings, AGENT_SYNC)) {
    return pushReview(review).then(
      () => true,
      () => false,
    );
  }
  if (settings.storage === 'downloads') {
    return writeToDownloads(review, settings.downloadsFolder).then(
      () => true,
      (err) => {
        console.warn('Page Review: writing to Downloads failed', review.id, err);
        return false;
      },
    );
  }
  return null;
}

// Removes the copy outside the browser, wherever it was written.
export async function removeExport(id, settings) {
  settings ??= await getSettings();
  if (sendsToServer(settings, AGENT_SYNC)) await deleteRemote(id);
  await removeFromDownloads(id);
}

export function reviewPaths(folder, id) {
  const dir = `${folder}/reviews/${id}`;
  return { dir, screenshot: `${dir}/screenshot.png`, json: `${dir}/review.json`, md: `${dir}/review.md` };
}

// What review.json holds: the review as saved, with the screenshot as a file name
// (the same shape the local server writes).
export function storedReview(review) {
  const { screenshot, ...rest } = review;
  return { ...rest, screenshot: 'screenshot.png' };
}

async function writeToDownloads(review, folder) {
  const paths = reviewPaths(folder, review.id);
  const hideUi = chrome.downloads.setUiOptions ? (enabled) => chrome.downloads.setUiOptions({ enabled }).catch(() => {}) : () => {};
  // Three files per review would pop the downloads bubble every time.
  await hideUi(false);
  try {
    const png = await download(review.screenshot, paths.screenshot);
    // Chrome reports the absolute path, which the agent instructions use.
    const [item] = await chrome.downloads.search({ id: png });
    const root = item?.filename ? rootOf(item.filename, review.id) : null;
    const shotPath = item?.filename ?? 'screenshot.png';
    const json = await download(textUrl(JSON.stringify(storedReview(review), null, 2), 'application/json'), paths.json);
    const md = await download(textUrl(toMarkdown(review, shotPath), 'text/markdown'), paths.md);
    const { downloaded = {} } = await chrome.storage.local.get('downloaded');
    downloaded[review.id] = { folder, ids: [png, json, md] };
    await chrome.storage.local.set({ downloaded, ...(root ? { downloadsRoot: { folder, path: root } } : {}) });
  } finally {
    await hideUi(true);
  }
}

async function removeFromDownloads(id) {
  const { downloaded = {} } = await chrome.storage.local.get('downloaded');
  const entry = downloaded[id];
  if (!entry) return;
  if (chrome.downloads) {
    for (const dl of entry.ids) {
      await chrome.downloads.removeFile(dl).catch(() => {}); // already gone, or moved by the user
      await chrome.downloads.erase({ id: dl }).catch(() => {});
    }
  }
  delete downloaded[id];
  await chrome.storage.local.set({ downloaded });
}

// Writes the reviews that aren't in the current downloads folder yet (after switching
// to Downloads, changing the folder, or a failed write).
export async function writePendingDownloads(settings) {
  settings ??= await getSettings();
  if (settings.storage !== 'downloads') return 0;
  const all = await chrome.storage.local.get(null);
  const downloaded = all.downloaded ?? {};
  const pending = Object.entries(all)
    .filter(([k, r]) => k.startsWith('review:') && downloaded[r.id]?.folder !== settings.downloadsFolder)
    .map(([, r]) => r);
  let written = 0;
  for (const review of pending) {
    if (await writeToDownloads(review, settings.downloadsFolder).then(() => true, () => false)) written++;
  }
  return written;
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) return reject(new Error(chrome.runtime.lastError?.message ?? 'download failed'));
      const done = (delta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === 'complete') {
          chrome.downloads.onChanged.removeListener(done);
          resolve(id);
        } else if (delta.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(done);
          reject(new Error(`download interrupted: ${filename}`));
        }
      };
      chrome.downloads.onChanged.addListener(done);
      // It may have finished before the listener was attached.
      chrome.downloads.search({ id }).then(([item]) => {
        if (item?.state === 'complete') done({ id, state: { current: 'complete' } });
        if (item?.state === 'interrupted') done({ id, state: { current: 'interrupted' } });
      });
    });
  });
}

// Data URL with UTF-8 text; works in the service worker, which has no Blob URLs.
function textUrl(text, type) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};charset=utf-8;base64,${btoa(bin)}`;
}

// ".../Downloads/page-review/reviews/<id>/screenshot.png" -> ".../Downloads/page-review"
export function rootOf(filename, id) {
  const parts = filename.split(/[\\/]/);
  const sep = filename.includes('\\') && !filename.includes('/') ? '\\' : '/';
  const i = parts.lastIndexOf(id);
  return i >= 2 && parts[i - 1] === 'reviews' ? parts.slice(0, i - 1).join(sep) : null;
}
