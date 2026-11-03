# Privacy policy

Page Review is a Chrome extension for marking up web pages and saving the result as a review.
This page explains what it records, where that goes, and how to delete it.

Last updated: 3 November 2026.

## The short version

Everything Page Review records stays on your computer. The extension does not send anything to
the developer or to any third party. It has no analytics, no tracking, no ads and no account.

## What it records

Only when you start review mode on a page (by clicking the toolbar icon or pressing the shortcut)
and only on that page:

- **Screenshots** of the visible part of the tab, taken when you save a review or use Copy image.
  The screenshot includes your drawings and comments.
- **Page details**: the page's address (URL) and title, the window size and the scroll position.
- **Your marks and comments**: what you drew and typed, where on the page, and their style.
- **The element each comment points at**: its CSS selector, tag, id and classes, role and
  accessible label, up to 200 characters of its visible text, its position and size, a few
  computed styles (such as font and color), the names of up to five parent elements and up to
  800 characters of its HTML.

The extension cannot see a page until you start review mode on it, and it does not record
anything in the background.

It also stores:

- **Your avatar**, if you set one in Settings: a 128×128 copy of the image you upload or link.
  When you use an image URL, the browser downloads that image once from the address you gave.
- **Your settings, saved templates and editor preferences.**

## Where it is stored

- **In your browser** (`chrome.storage.local`). Every review is kept here, whatever the storage
  setting is.
- **In your Downloads folder**, only if you choose *Downloads folder* in Settings. Chrome then writes
  each review (`screenshot.png`, `review.json`, `review.md`) to `Downloads/<folder>/reviews/`.
  Chrome asks for the Downloads permission when you pick this option.
- **On a server on your own computer**, only if you choose *Local server* in Settings. Reviews
  are sent to `http://localhost` or `http://127.0.0.1` at the port you set, to the page-review
  server you run yourself from this repository. It saves them in `~/.page-review/` on your computer.
  Chrome asks for access to localhost when you pick this option. The extension only accepts
  localhost addresses for this setting.

Copy image and Copy for agent put the screenshot or the Markdown text on your clipboard. What
happens with it after that (for example, pasting it into an AI tool) is up to you.

## What is sent over the network

Nothing, apart from the two cases you set up yourself: the avatar image URL you enter, and the
local server on your own computer. The extension loads no remote code.

## How to delete it

- **One review**: the delete button on its card on the reviews page. This also deletes the copy
  the extension wrote to your Downloads folder or the local server, while it still has the
  permission for it.
- **Your avatar**: Settings → Remove.
- **Everything in the browser**: remove the extension from `chrome://extensions`. Chrome deletes
  all of its stored data.
- **Files outside the browser**: the review folders in your Downloads folder and in
  `~/.page-review/` are ordinary files. Delete them like any other files.

## Data sharing and sale

The developer never receives your data, so it is not sold, shared, used for advertising or used
to decide creditworthiness or lending.

## Changes

Changes to this policy are made in this file, and its history is public in the repository.

## Contact

Questions or problems: open an issue at https://github.com/dzhiganov/page-review/issues.
