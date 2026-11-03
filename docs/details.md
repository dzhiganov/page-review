# Page Review: details

The [README](../README.md) is the overview. This page has the rest: how each tool behaves, the
keys, how comments find their element, the storage options and the limitations.

While review mode is on the page can't scroll, because the drawings belong to the current viewport.

## Draw

Arrows, boxes, freehand pen and an eraser, in six colors (red, orange, blue, green,
grey, black). Arrows come out slightly curved, with open, Figma-style heads.

With the Select tool you can drag any mark. A selected arrow has handles at both ends
and a dot in the middle that bends it; drag the dot flat to straighten the arrow. A
selected box has handles at its corners. **Ctrl/Cmd+Z** undoes any change.

## Comments

Finishing an arrow or a box opens a comment at its tail: type and press **Enter**, or
**Esc** to skip it. The comment is about that mark's element, wherever you move the
card. **T** adds a comment on its own, about the element under its pin.

Drag a comment with any tool. If it belongs to an arrow, the arrow's tail comes along
and the head stays on its target. Double-click a comment to edit it.

Click a comment for its style bar: font (sans, serif, mono), size, bold, text color
and delete. Your avatar (see [Settings](#settings)) shows on each card.

## Steps

**S**, then click: a step is a card like a comment, with a purple number instead of
your avatar. Use them for an ordered sequence, such as the clicks to reproduce a bug.
Numbers follow the order you added them, and deleting a step renumbers the rest. Steps
are saved as their own list, after the comments.

## Show elements

The Show elements button in the toolbar keeps the elements your marks point at
outlined, each with a tag badge, and outlines the element under the cursor. Use it to
check that a comment is attached to the right thing. Outlines never end up in the
screenshot.

## Frame

**F**, then drag a rectangle: Save and Copy image capture only that area, and the rest
of the page is dimmed. Drag inside the frame to move it, or its corners to resize it.
**Esc** (with the Frame tool) or the reset button above it goes back to the whole
visible page. The frame lasts until you exit review mode.

## Save and copy

**Ctrl/Cmd+S** saves the review. The copy button next to Save opens a menu:

- **Copy image** puts the annotated screenshot on the clipboard (https pages only).
- **Copy for agent** copies the comments and steps as Markdown, each with its element,
  ready to paste into an AI agent.

Neither one saves a review. If you saved first and reviews are written as files (see
[Settings](#settings)), the Markdown names the screenshot file.

Each element is named by its role and visible text, then its CSS selector, so an agent
can search the source for it:

```markdown
## Page feedback
Northwind: analytics for small teams — http://localhost:4311/   (viewport 1440×900)

Screenshot: not attached (this text doesn't include the image).

### 1. Button "Start free trial" — span.btn.primary:nth-of-type(1)
Use the brand indigo

### 2. Element — div.ic.odd
Different icon style

### Steps

1. Click Book a demo — Button "Book a demo" (span.btn.ghost:nth-of-type(2))
```

## Reviews page

The folder button in the toolbar, or right-click the icon → *Open saved reviews*.
Reviews are grouped by day. Each card has **Copy as image**, **Copy as Markdown**
(the full description: every comment with its element's selector, text, position,
computed styles and HTML, numbered to match the screenshot), download and delete.
Click a screenshot to see it full size.

## Combine screenshots

Drag one screenshot onto another, or tick 2 to 4 cards and press **Combine**, to make
one image from them with a template: Before / After, Expected / Actual,
Desktop / Mobile, Light / Dark, Step 1 → 2 → 3 (3 images) or a 2×2 grid (4 images).
You can change the labels, their position and style, the background, the padding and
what goes between the images (arrow, divider), and save that as your own template. The
new image is a card like any other.

The result:

## Settings

Open **Settings** on the reviews page.

- **Avatar**: an image (upload or URL) shown on your comment cards.
- **Storage**: where reviews go, see below.
- **AI agent**: a Claude Code skill (`SKILL.md`) or a plain prompt that tells your
  agent where your reviews are and how to read them. Copy or download it.

### Storage

Reviews always stay in the browser. They can also be written as files:

- **Browser only** (default): copy reviews from the reviews page when you need them.
- **Downloads folder**: Chrome writes each review to `Downloads/<folder>/reviews/<id>/`.
- **Local server**: each review is sent to `npm run serve` (or the MCP server,
  `npm run mcp`, in Claude Code), which writes `~/.page-review/reviews/<id>/` and lets
  the agent mark comments as resolved.

Chrome asks for its Downloads or localhost permission when you pick one of these options.

Both file options write `screenshot.png`, `review.json` and `review.md` per review.

### Working with an agent

1. Pick Downloads folder or Local server, so the agent can read the files.
2. Save the generated `SKILL.md` (or prompt) from the AI agent section.
3. Review a page and save it, then ask the agent to fix what you marked.

For a quick one-off, **Copy for agent** in the editor and paste it into the chat.

## How comments find their element

- **Comment on its own**: the element under the comment's pin (the card's sharp corner).
- **Step**: the same, the element under its pin.
- **Arrow**: the element under the arrow tip, or something just past it if the
  arrow stops a little short.
- **Box or freehand circle**: the element that best matches the drawn area.
- **Underline**: the text just above it.
- **Comment on an arrow or box** (the one that opens when you finish drawing it): it is
  about that mark's element, wherever you move the card.
- **Marks that touch** (a circle plus an underline, an arrow pointing into a circle)
  count as one comment.

After each mark or standalone comment, a dashed outline briefly shows which element it picked.

## Keys

| Action | Keys |
| --- | --- |
| Start / stop reviewing | Click the icon or **Alt+Shift+R** |
| Tools | **V** select · **P** pen · **A** arrow · **R** box · **T** comment · **S** step · **E** eraser · **F** frame |
| Colors | **1–6** (also recolors the selected mark) |
| Nudge the selection | Arrow keys (**Shift** for 10px) |
| Delete | **Delete** or **Backspace** with the Select tool, or the eraser |
| Undo / redo | **Ctrl/Cmd+Z** · **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** (any keyboard layout) |
| Save | **Ctrl/Cmd+S** |
| Exit | **Esc** (the first Esc deselects) |

## Develop

```bash
npm install
npm test             # unit tests, then headless Chromium: loads the extension, draws, saves, checks the reviews page
npm run icons        # regenerate extension/icons/
npm run screenshots  # regenerate docs/screenshots/ from the demo page in docs/demo/
npm run gifs         # regenerate docs/gifs/ (needs ffmpeg)
npm run store-images # regenerate store/images/ for the Chrome Web Store (needs ffmpeg)
npm run build:store  # dist/page-review-<version>.zip for the store, checked in Chromium
```

After changing the code, click ↻ on the extension in `chrome://extensions` and
refresh the page you're reviewing.

## Limitations

- Captures the visible part of the page (or a framed part of it) only, no full-page reviews yet.
- Saved reviews can't be reopened for editing.
- Content inside iframes isn't detected.
- Doesn't run on `chrome://` pages, the Chrome Web Store or the PDF viewer.
