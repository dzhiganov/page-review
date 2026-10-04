#!/usr/bin/env node
// MCP server (stdio) that gives an agent access to page reviews made with the extension.
// It also hosts the localhost receiver when no other page-review process holds the port.
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { toMarkdown } from '../extension/lib/format.js';
import { DEFAULT_PORT, startReceiver } from './http.js';
import { DATA_DIR, listReviews, readReview, reviewDir, screenshotPath, setCommentStatus } from './store.js';

// Claude rejects images over ~5 MB of base64; larger screenshots are referenced by path.
const MAX_INLINE_SCREENSHOT = 3.5 * 1024 * 1024;

const server = new McpServer(
  { name: 'page-review', version: '0.2.0' },
  {
    instructions:
      'The user reviews web pages in Chrome with the Page Review extension: they draw arrows, boxes and notes ' +
      'on the page, and each note is linked to the DOM element it points at. Use list_reviews to find reviews, ' +
      'get_review to read one (Markdown + annotated screenshot; numbered badges in the image match comment numbers). ' +
      'Each comment gives the target selector, text, computed styles and an HTML snippet. Use them to find the source ' +
      'code that renders the element. After addressing a comment, call set_comment_status so the user sees progress.',
  },
);

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

async function resolveId(id) {
  if (id !== 'latest') return id;
  const [latest] = await listReviews();
  if (!latest) throw new Error('No reviews yet.');
  return latest.id;
}

server.registerTool(
  'list_reviews',
  {
    title: 'List page reviews',
    description: 'List reviews made with the Page Review extension, newest first.',
    inputSchema: {
      status: z.enum(['open', 'all']).default('open').describe("'open' = only reviews with unresolved comments"),
      url: z.string().optional().describe('Only reviews whose page URL contains this text'),
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, url, limit }) => {
    let reviews = await listReviews();
    if (url) reviews = reviews.filter((r) => r.url.includes(url));
    if (status === 'open') reviews = reviews.filter((r) => r.comments.some((c) => c.status === 'open'));
    if (!reviews.length) {
      return text(
        `No ${status === 'open' ? 'open ' : ''}reviews found in ${DATA_DIR}. ` +
          'The extension sends saved reviews within ~30 seconds of this server starting; if the user just ' +
          'saved one, wait a moment and list again.',
      );
    }
    const lines = reviews.slice(0, limit).map((r) => {
      const open = r.comments.filter((c) => c.status === 'open').length;
      return `- ${r.id}: "${r.title || '(untitled)'}" ${r.url} (${r.createdAt}, ${open}/${r.comments.length} open)`;
    });
    return text(`${lines.join('\n')}\n\nUse get_review with an id (or "latest") to read one.`);
  },
);

server.registerTool(
  'get_review',
  {
    title: 'Get a page review',
    description:
      'Read one review: comments with their target elements (selector, text, styles, HTML) as Markdown, ' +
      'plus the annotated screenshot.',
    inputSchema: {
      id: z.string().describe('Review id from list_reviews, or "latest"'),
      include_screenshot: z.boolean().default(true).describe('Attach the annotated screenshot as an image'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ id, include_screenshot }) => {
    try {
      const review = await readReview(await resolveId(id));
      const shot = screenshotPath(review.id);
      const content = [
        {
          type: 'text',
          text: `Review id: ${review.id}\nFiles: ${reviewDir(review.id)}\n\n${toMarkdown(review, shot)}`,
        },
      ];
      if (include_screenshot) {
        const png = await fs.readFile(shot);
        if (png.length <= MAX_INLINE_SCREENSHOT) {
          content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
        } else {
          content.push({ type: 'text', text: `Screenshot is too large to inline. Read it from ${shot}` });
        }
      }
      return { content };
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerTool(
  'set_comment_status',
  {
    title: 'Set comment status',
    description:
      'Mark a review comment as resolved (or wontfix, or reopen it). Call after addressing a comment; ' +
      'the note is shown to the user in the extension.',
    inputSchema: {
      id: z.string().describe('Review id, or "latest"'),
      comment: z.number().int().min(1).describe('Comment number (the badge number)'),
      status: z.enum(['resolved', 'wontfix', 'open']),
      note: z.string().optional().describe('Short note on what was changed, or why not'),
    },
    annotations: { idempotentHint: true },
  },
  async ({ id, comment, status, note }) => {
    try {
      const review = await setCommentStatus(await resolveId(id), comment, status, note);
      const open = review.comments.filter((c) => c.status === 'open').map((c) => `#${c.n}`);
      return text(
        `Comment #${comment} of ${review.id} is now ${status}. ` +
          (open.length ? `Still open: ${open.join(', ')}.` : 'All comments in this review are addressed.'),
      );
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerPrompt(
  'address-review',
  {
    title: 'Address a page review',
    description: 'Fix everything the user marked up in a page review',
    argsSchema: { id: z.string().optional().describe('Review id (default: latest)') },
  },
  ({ id }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Use the page-review tools to read review "${id || 'latest'}" with its screenshot. ` +
            'For each open comment, find the code in this project that renders the target element and make the change. ' +
            'After each one, call set_comment_status with a one-line note. If a comment is unclear or does not ' +
            'belong to this codebase, leave it open and tell me why.',
        },
      },
    ],
  }),
);

// One receiver per machine is enough. If another session owns the port, check
// back later so reviews still arrive after that session exits.
async function claimReceiver() {
  try {
    const { status, dataDir } = await startReceiver(DEFAULT_PORT);
    if (status === 'listening') {
      console.error(`[page-review] receiver on 127.0.0.1:${DEFAULT_PORT}, data in ${DATA_DIR}`);
      return;
    }
    if (dataDir !== DATA_DIR) {
      console.error(`[page-review] warning: the receiver on port ${DEFAULT_PORT} stores reviews in ${dataDir}, not ${DATA_DIR}`);
    }
  } catch (err) {
    console.error(`[page-review] receiver not started: ${err.message}`);
  }
  setTimeout(claimReceiver, 30_000).unref();
}

if (process.env.PAGE_REVIEW_NO_HTTP !== '1') claimReceiver();
await fs.mkdir(path.join(DATA_DIR, 'reviews'), { recursive: true });
await server.connect(new StdioServerTransport());
