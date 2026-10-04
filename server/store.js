// On-disk review store shared by the HTTP receiver and the MCP server.
// Layout: $PAGE_REVIEW_DIR/reviews/<id>/{review.json, review.md, screenshot.png}
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { toMarkdown } from '../extension/lib/format.js';

export const DATA_DIR = process.env.PAGE_REVIEW_DIR ?? path.join(os.homedir(), '.page-review');
const REVIEWS_DIR = path.join(DATA_DIR, 'reviews');
const ID_RE = /^[a-z0-9-]{4,40}$/;
export const STATUSES = ['open', 'resolved', 'wontfix'];

export function reviewDir(id) {
  if (!ID_RE.test(id)) throw new StoreError(400, `invalid review id: ${id}`);
  return path.join(REVIEWS_DIR, id);
}

export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Accepts a review as sent by the extension (screenshot as a PNG data URL).
// Re-sending a review keeps the statuses the agent already set.
export async function saveReview(review) {
  if (!review || typeof review !== 'object') throw new StoreError(400, 'body must be a review object');
  const { screenshot, ...rest } = review;
  if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/png;base64,')) {
    throw new StoreError(400, 'screenshot must be a PNG data URL');
  }
  if (
    typeof rest.url !== 'string' ||
    Number.isNaN(Date.parse(rest.createdAt)) ||
    typeof rest.viewport?.width !== 'number' ||
    !Array.isArray(rest.comments) ||
    !rest.comments.every((c) => Number.isInteger(c?.n))
  ) {
    throw new StoreError(400, 'review needs url, createdAt, viewport and numbered comments');
  }
  const dir = reviewDir(rest.id);
  const png = Buffer.from(screenshot.slice(screenshot.indexOf(',') + 1), 'base64');
  return withLock(rest.id, async () => {
    const existing = await readReview(rest.id).catch(() => null);
    const previous = new Map(existing?.comments.map((c) => [c.n, c]) ?? []);

    const stored = {
      ...rest,
      screenshot: 'screenshot.png',
      receivedAt: existing?.receivedAt ?? new Date().toISOString(),
      comments: rest.comments.map((c) => {
        const old = previous.get(c.n);
        return { ...c, status: old?.status ?? 'open', note: old?.note ?? null, statusAt: old?.statusAt ?? null };
      }),
    };
    await fs.mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, 'screenshot.png'), png);
    await writeReview(stored);
    return stored;
  });
}

export async function readReview(id) {
  const raw = await fs.readFile(path.join(reviewDir(id), 'review.json'), 'utf8').catch((err) => {
    throw err.code === 'ENOENT' ? new StoreError(404, `no review with id ${id}`) : err;
  });
  return JSON.parse(raw);
}

export async function listReviews() {
  const ids = await fs.readdir(REVIEWS_DIR).catch(() => []);
  const reviews = await Promise.all(ids.filter((id) => ID_RE.test(id)).map((id) => readReview(id).catch(() => null)));
  return reviews.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function setCommentStatus(id, n, status, note) {
  if (!STATUSES.includes(status)) throw new StoreError(400, `status must be one of ${STATUSES.join(', ')}`);
  return withLock(id, async () => {
    const review = await readReview(id);
    const comment = review.comments.find((c) => c.n === n);
    if (!comment) throw new StoreError(404, `review ${id} has no comment #${n}`);
    Object.assign(comment, { status, note: note || null, statusAt: new Date().toISOString() });
    await writeReview(review);
    return review;
  });
}

export async function deleteReview(id) {
  await withLock(id, () => fs.rm(reviewDir(id), { recursive: true, force: true }));
}

export function screenshotPath(id) {
  return path.join(reviewDir(id), 'screenshot.png');
}

export function summary(r) {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    createdAt: r.createdAt,
    total: r.comments.length,
    open: r.comments.filter((c) => c.status === 'open').length,
    comments: r.comments.map(({ n, text, status, note, statusAt }) => ({ n, text, status, note, statusAt })),
  };
}

async function writeReview(review) {
  const dir = reviewDir(review.id);
  await writeAtomic(path.join(dir, 'review.json'), JSON.stringify(review, null, 2));
  await writeAtomic(path.join(dir, 'review.md'), toMarkdown(review, path.join(dir, 'screenshot.png')));
}

// Read-modify-write of a review must not interleave: parallel tool calls in one
// process are chained, and other processes are kept out with a lock directory.
const chains = new Map();
const LOCK_STALE_MS = 10_000;

function withLock(id, fn) {
  const run = (chains.get(id) ?? Promise.resolve()).then(async () => {
    const lock = `${reviewDir(id)}.lock`;
    await fs.mkdir(REVIEWS_DIR, { recursive: true });
    for (const start = Date.now(); ;) {
      try {
        await fs.mkdir(lock);
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const age =
          Date.now() -
          (await fs.stat(lock).then(
            (s) => s.mtimeMs,
            () => Date.now(),
          ));
        if (age > LOCK_STALE_MS) await fs.rm(lock, { recursive: true, force: true });
        else if (Date.now() - start > 2 * LOCK_STALE_MS) throw new Error(`review ${id} is locked`);
        else await new Promise((r) => setTimeout(r, 25));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.rm(lock, { recursive: true, force: true });
    }
  });
  const tail = run.catch(() => {});
  chains.set(id, tail);
  tail.then(() => chains.get(id) === tail && chains.delete(id));
  return run;
}

// Several MCP processes may share the store, so never leave half-written files.
async function writeAtomic(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}
