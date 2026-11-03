# Chrome Web Store listing: Page Review

Text to paste into the developer dashboard. Field-by-field order is in [CHECKLIST.md](CHECKLIST.md).

## Name

Page Review

## Summary (112 of 132 characters)

Draw and comment on any web page, then save the review as an annotated screenshot plus Markdown for an AI agent.

## Detailed description

```text
Review a web page the way you would mark up a screenshot, and hand the result to an AI agent or a ticket.

Click the toolbar icon (or press Alt+Shift+R) on any page and draw on top of it: arrows, boxes, freehand marks and comments, in six colors. Each comment knows which page element it is about, so the review says "the Start free trial button", not just "the green thing at the top".

What you can do
- Draw arrows, boxes and freehand marks; drag, bend and resize them; undo any change.
- Comment on a mark or on any element. Pick font, size and color for each comment.
- Add numbered steps, for example the clicks that reproduce a bug.
- Show elements: outline the element each comment points at, to check it picked the right one.
- Frame: capture only part of the page.
- Save with Ctrl/Cmd+S: an annotated screenshot plus a description of every comment and its element.
- Copy image, or Copy for agent: the comments and steps as Markdown, ready to paste into an AI agent.
- Reviews page: every saved review, grouped by day, with Copy as image and Copy as Markdown.
- Combine 2 to 4 screenshots into one image: Before / After, Expected / Actual, Desktop / Mobile and more.

Working with an AI agent
Settings can generate a skill file or a prompt that tells your agent where your reviews are and how to read them. Reviews can also be written as files your agent can open: to a folder in Downloads, or to a small server you run on your own computer.

Privacy
Reviews stay in your browser unless you choose to save them as files. Nothing is sent to the developer or anyone else. No analytics, no account.

Limitations
Captures the visible part of the page only. Doesn't run on chrome:// pages, the Chrome Web Store or the PDF viewer.

Source code and issues: https://github.com/dzhiganov/page-review
```

## Category

Developer Tools. (Alternative: Productivity → Workflow & Planning.)

## Language

English

## Single purpose

```text
Page Review lets the user mark up the web page they are looking at with drawings and comments, and save that review as an annotated screenshot plus a text description of each comment and the page element it refers to, so it can be passed to an AI agent or a colleague.
```

## Permission justifications

Required:

| Permission | Justification |
| --- | --- |
| `activeTab` | Gives access to the current tab only when the user clicks the toolbar icon or presses the shortcut, to show the review overlay and take its screenshot. |
| `scripting` | Injects the review overlay into the current tab when the user starts review mode. |
| `storage` | Keeps saved reviews, the user's settings, avatar and templates in the browser. |
| `unlimitedStorage` | Each saved review includes a full-size screenshot, which quickly passes the default storage quota. |
| `contextMenus` | Adds "Open saved reviews" to the toolbar icon's right-click menu. |
| `alarms` | Retries sending saved reviews to the user's local server when it was not running (Local server storage option only). |

Optional (requested at runtime, only when the user picks the matching option in Settings):

| Permission | Justification |
| --- | --- |
| `downloads` | "Downloads folder" storage option: writes each review as files (screenshot.png, review.json, review.md) to a folder in Downloads, and removes them when the review is deleted. |
| Host `http://localhost/*`, `http://127.0.0.1/*` | "Local server" storage option: sends reviews to the page-review server the user runs on their own computer. |

## Remote code

No, I am not using remote code. All JavaScript is in the package; no scripts are loaded from the network and there is no `eval` or `new Function`.

## Data usage (privacy practices form)

Data types the extension handles (all of it stays on the user's device; none is sent to the developer):

- **Website content**: tick. Screenshots of the visible tab, the text and HTML of the elements comments point at.
- **Web history**: tick. The URL and title of each page the user saves a review of.
- Personally identifiable information: leave unticked. (The optional avatar image is a picture the user chooses for their own comment cards; it stays in the browser.)
- Health, Financial and payment, Authentication, Personal communications, Location, User activity: leave unticked.

Why tick the two: the store's reviewers compare the form with what the code does, and the extension does read page content and URLs, even though it only stores them locally. Leaving everything unticked ("does not collect") is defensible too, since nothing leaves the device; that is the owner's call.

Certifications (tick all three):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Privacy policy URL: https://github.com/dzhiganov/page-review/blob/main/PRIVACY.md

## Images

All in `store/images/`, regenerated with `npm run store-images`:

| File | Use |
| --- | --- |
| `icon-128.png` | Store icon (128×128, 96×96 artwork) |
| `screenshot-1.png` … `screenshot-5.png` | Screenshots (1280×800) |
| `promo-small.png` | Small promo tile (440×280) |
| `promo-marquee.png` | Marquee promo tile (1400×560) |
