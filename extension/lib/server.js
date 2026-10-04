// Client for the local page-review server (runs inside the MCP server or `npm run serve`).

const DEFAULT_URL = 'http://localhost:47615';

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ?? {};
}

export async function updateSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

async function call(path, init = {}) {
  const base = (await getSettings()).serverUrl ?? DEFAULT_URL;
  const res = await fetch(base + path, { signal: AbortSignal.timeout(init.timeout ?? 5000), ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `server responded ${res.status}`);
  return body;
}

export async function serverHealth() {
  try {
    return await call('/health', { timeout: 1500 });
  } catch {
    return null;
  }
}

export async function pushReview(review) {
  await call(`/reviews/${review.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(review),
    timeout: 15000,
  });
  const { synced = {} } = await chrome.storage.local.get('synced');
  await chrome.storage.local.set({ synced: { ...synced, [review.id]: new Date().toISOString() } });
}

// Map of review id -> summary with per-comment status, or null when the server is down.
export async function fetchStatuses() {
  try {
    const list = await call('/reviews', { timeout: 3000 });
    return new Map(list.map((r) => [r.id, r]));
  } catch {
    return null;
  }
}

export async function deleteRemote(id) {
  await call(`/reviews/${id}`, { method: 'DELETE' }).catch(() => {});
  const { synced = {} } = await chrome.storage.local.get('synced');
  delete synced[id];
  await chrome.storage.local.set({ synced });
}
