// Service worker: injects the overlay, captures screenshots, stores reviews.
import { AGENT_SYNC } from './lib/flags.js';
import { pushReview, serverHealth } from './lib/server.js';
import { getSettings, sendsToServer } from './lib/settings.js';
import { exportReview, writePendingDownloads } from './lib/storage.js';

const REVIEWS_PAGE = 'reviews.html';
const SYNC_ALARM = 'sync-pending';

// Storage setting "server" (or the AGENT_SYNC flag): reviews saved while no Claude Code
// session is open wait in chrome.storage and go out on their own once the server is up.
// Storage setting "downloads": reviews not written yet (or written to another folder) are
// written when the setting changes.
async function applySettings() {
  const settings = await getSettings();
  if (sendsToServer(settings, AGENT_SYNC)) {
    chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 0.5 });
    syncPending();
  } else {
    chrome.alarms.clear(SYNC_ALARM);
  }
  if (settings.storage === 'downloads') await writePendingDownloads(settings);
}
applySettings();
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === SYNC_ALARM && syncPending());
chrome.storage.onChanged.addListener((changes) => changes.settings && applySettings());

let syncing = null;
function syncPending() {
  syncing ??= (async () => {
    const all = await chrome.storage.local.get(null);
    if (!sendsToServer(await getSettings(), AGENT_SYNC)) return 0;
    const synced = all.synced ?? {};
    const pending = Object.entries(all)
      .filter(([k]) => k.startsWith('review:'))
      .map(([, review]) => review)
      .filter((review) => !synced[review.id]);
    if (!pending.length || !(await serverHealth())) return 0;
    let sent = 0;
    for (const review of pending) {
      await pushReview(review).then(() => sent++, (err) => console.warn('Page Review: sync failed', review.id, err));
    }
    return sent;
  })().finally(() => (syncing = null));
  return syncing;
}
globalThis.syncPending = syncPending; // handy from the service worker console (and the E2E test)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'open-reviews',
    title: 'Open saved reviews',
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'open-reviews') openReviews();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // content.js toggles itself when injected a second time.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/notes.js', 'lib/smooth.js', 'content.js'],
    });
  } catch (err) {
    // chrome://, the Web Store, PDF viewer etc. can't be scripted.
    console.warn('Page Review: cannot run on this page', err);
    await chrome.action.setBadgeText({ tabId: tab.id, text: '✕' });
    await chrome.action.setTitle({ tabId: tab.id, title: 'Page Review cannot run on this page' });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'save') {
    saveReview(msg.review, sender.tab).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: err.message }),
    );
    return true; // async response
  }
  if (msg.type === 'open-reviews') {
    openReviews();
  }
  return false;
});

async function saveReview(review, tab) {
  // The overlay hides its toolbar before sending this message, so the capture
  // contains the page plus the reviewer's drawings and numbered badges only.
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const full = { ...review, screenshot };
  await chrome.storage.local.set({ [`review:${review.id}`]: full });
  // Hand it to the agent's local server right away (the alarm retries later if it's down),
  // or write it to the Downloads folder, per the storage setting.
  const settings = await getSettings();
  const exported = await exportReview(full, settings);
  // `synced` drives the overlay's "sent to Claude" message, so it's only set for the server.
  return { ok: true, id: review.id, synced: sendsToServer(settings, AGENT_SYNC) ? exported : null };
}

function openReviews() {
  return chrome.tabs.create({ url: chrome.runtime.getURL(REVIEWS_PAGE) });
}
