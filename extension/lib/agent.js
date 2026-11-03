// Instructions for a local AI agent (Claude Code etc.): where the reviews are and how
// to read them. Built from the storage setting, as a SKILL.md or a plain prompt.

// storage: the setting ('browser' | 'downloads' | 'server'); root: absolute path of the folder
// that holds reviews/, or null when not known yet (then rootGuess is shown with a caveat).
export function agentInstructions({ format = 'skill', storage, root = null, rootGuess = null, folder = 'page-review' }) {
  const body =
    storage === 'browser' ? browserBody() : filesBody({ storage, root: root ?? rootGuess, known: Boolean(root), folder });
  if (format === 'prompt') {
    return `I review web pages with the Page Review Chrome extension. Use the notes below to read my reviews and fix what I marked.\n\n${body}`;
  }
  return `---
name: page-review
description: Read the user's web page reviews from the Page Review Chrome extension (annotated screenshots plus comments linked to the DOM elements they point at) and fix what they marked. Use when the user mentions a page review, review comments, an annotated screenshot of their site, or asks to fix what they marked on a page.
---

# Page reviews

${body}`;
}

// Windows paths (Chrome on Windows) as seen from WSL.
export function wslPath(p) {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p ?? '');
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : null;
}

// Inline Markdown code that survives backticks in the text (a folder may contain them).
export function code(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((run) => run.length));
  if (!longest) return `\`${text}\``;
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}

const INTRO =
  'The user marks up web pages in Chrome with the Page Review extension: arrows, boxes, freehand marks and ' +
  'comment cards. Each saved review is an annotated screenshot plus a description of every comment and the page ' +
  'element it points at.';

function filesBody({ storage, root, known, folder }) {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const dir = `${root}${sep}reviews`;
  const wsl = wslPath(root);
  const where = [];
  if (storage === 'server') {
    where.push(
      `Reviews are in ${code(dir)}, written by the local page-review server (\`npm run serve\` in the page-review ` +
        'repo, or its MCP server inside Claude Code). Reviews saved while the server was down arrive within ' +
        'about 30 seconds of it starting.',
    );
    where.push(
      '',
      'If the `page-review` MCP server is connected, prefer its tools: `list_reviews`, `get_review` (Markdown ' +
        'plus the screenshot) and `set_comment_status`. After fixing a comment, call `set_comment_status` with ' +
        "`resolved` and a one-line note; the user sees it in the extension. Without the tools, read the files below; " +
        "each comment in `review.json` also has `status` (`open`, `resolved`, `wontfix`) and `note`.",
    );
  } else {
    where.push(
      `Reviews are in ${code(dir)}, written there by Chrome as downloads. Treat the folder as read-only: ` +
        "the extension doesn't read it back, and deleting a review in the extension deletes its files.",
    );
    if (!known) {
      where.push(
        '',
        "That's Chrome's default Downloads folder. If it isn't there, the user changed Chrome's download " +
          `location: look for the ${code(folder)} folder there instead.`,
      );
    }
  }
  if (wsl) where.push('', `From WSL the same folder is ${code(`${wsl}/reviews`)}.`);

  return `${INTRO}

## Where reviews are

${where.join('\n')}

One folder per review, \`reviews/<id>/\`:

- \`review.md\`: the comments, numbered to match the badges in the screenshot, then any steps. Start here.
- \`screenshot.png\`: the visible part of the page as the user saw it (or the area they framed), with their drawings and numbered badges baked in.
- \`review.json\`: the same data, structured (fields below).

Ids start with a base-36 timestamp, so they sort by time. The newest review is the last id in sorted order
(or the one with the latest \`createdAt\`). When the user says "the review" or "my last review", use the newest.

${READING}`;
}

function browserBody() {
  return `${INTRO}

## Where reviews are

The extension keeps reviews inside Chrome only, so you can't read them from disk. Ask the user to open the
reviews page and use **Copy as Markdown** and **Copy as image** on the review, then paste both into the chat.
(If they want you to read reviews yourself, they can switch Settings → Storage to the Downloads folder or the
local server, then give you the updated instructions.)

${READING}`;
}

const READING = `## Reading a review

1. Read \`review.md\` (or the pasted Markdown), then look at the screenshot. Badge numbers match comment numbers.
2. For each comment, the **target** is the DOM element the extension linked it to. Use it to find the code that
   renders that element.
3. A comment without text means the drawing itself is the feedback (for example, an element circled or crossed out):
   infer the intent from the screenshot.
4. **Steps** (filled purple number badges, listed under "Steps") are an ordered sequence the user marked, such as
   the clicks to reproduce a bug or a flow to build. Follow them in order; each is linked to the element under its
   pin. Step numbers are separate from comment numbers.

## How comments map to elements

- **Arrow** (\`kind: "arrow"\`): the element under the arrow tip, or just past it if the arrow stops short.
- **Box** or **freehand** mark: the element that best matches the drawn area. An underline points at the text above it.
- **Comment on its own** (\`kind: "text"\`): the element under the comment card's pin (its sharp corner).
- Marks that touch (a circle plus an underline, an arrow into a circle) are one comment; \`marks\` lists them.
- \`target\` is null when no element was found; rely on the screenshot and \`region\` then.

## review.json

- \`id\`, \`url\`, \`title\`, \`createdAt\` (ISO time).
- \`viewport\`: \`width\`, \`height\` in CSS px and \`devicePixelRatio\`. Screenshot pixels = CSS px × devicePixelRatio.
- \`scroll\`: page scroll position at capture time.
- \`frame\` (only when the user framed part of the page): \`x\`, \`y\`, \`w\`, \`h\` in viewport CSS px. The screenshot
  shows only that area, and all other coordinates are relative to its top-left corner.
- \`comments[]\`:
  - \`n\`: number shown on the badge. \`text\`: the comment (may be empty).
  - \`kind\`: \`arrow\`, \`box\`, \`freehand\` or \`text\`. \`marks\`: drawing types that make up the comment.
  - \`region\`, \`badge\`: where the marks and the number are, in viewport CSS px.
  - \`target\`: \`selector\` (CSS path, unique on the page at capture time), \`tag\`, \`id\`, \`classes\`, \`role\`,
    \`ariaLabel\`, \`text\` (first 200 characters), \`label\` (\`role\`: Link, Button, Input, Image, Heading, Text,
    Card, Section or Element; \`text\`: visible text, placeholder or alt, up to 60 characters; missing in older
    reviews), \`rect\` (\`x\`, \`y\`, \`w\`, \`h\` in viewport CSS px),
    \`styles\` (computed: font, color, spacing, size), \`ancestors\` (nearest first), \`html\` (outerHTML, truncated).
- \`steps[]\` (may be missing): \`n\` (the step number), \`kind: "step"\`, \`text\`, \`region\`, \`badge\` and \`target\` as
  for comments.
- \`shapes\`: the raw drawings. Rarely needed.
- \`composite\` (combined images only, see below).

## Combined images

Some items combine several reviews into one image with a template (for example Before / After, Expected /
Actual, Desktop / Mobile). They have no comments of their own; \`composite.sources\` lists each panel in order
(left to right, then top to bottom in a 2×2 grid) with its \`label\`, page \`url\`, review \`id\` and comments.
Each panel's \`label\` says what it shows (Before, After, Expected, Actual, Mobile...). Go by the labels,
not by the panel order, and don't guess which panel is right: the user's comments say what to change.
Read the source reviews by id for full element details. A source review may have been deleted since the
image was made; then use the comments copied into \`composite.sources\` and the image itself.

## Finding the code

- Search the project for the target's text, \`id\`, \`data-testid\`, \`aria-label\` and distinctive class names.
  Generated class names (CSS modules, CSS-in-JS) won't match the source; use the text and structure instead.
- \`ancestors\` and \`html\` show the surrounding component; \`styles\` show the current computed values, which
  helps when the comment is about size, color or spacing.
- Coordinates and computed styles describe the page at capture time. Check the current code before assuming they
  still hold.
- If a comment is unclear or the element isn't in this codebase, say so instead of guessing.`;
