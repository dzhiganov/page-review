# Chrome Web Store submission checklist

Texts are in [listing.md](listing.md), images in `images/`.

## Before uploading

- [ ] `extension/manifest.json` version is higher than the version live in the store (now 0.6.0).
- [ ] `npm test` passes.
- [ ] `npm run build:store` writes `dist/page-review-<version>.zip` and its check passes.
- [ ] PRIVACY.md is on `main` on GitHub, so the policy URL works.
- [ ] If the Local server option should work with the store build: add the store item's ID to
      `EXTENSION_IDS` in `server/http.js` (it only accepts the dev ID now), or start the server with
      `PAGE_REVIEW_EXTENSION_IDS=<store id>,lehkiologlmiimeklbeblhinfkldafmj`.

## Package

| Field | What to do |
| --- | --- |
| Upload new package | `dist/page-review-<version>.zip` |

## Store listing tab

| Field | Paste / upload |
| --- | --- |
| Description | listing.md → Detailed description (the text block) |
| Category | Developer Tools |
| Language | English |
| Store icon | `images/icon-128.png` |
| Global promo video | leave empty |
| Screenshots | `images/screenshot-1.png` … `screenshot-5.png`, in that order |
| Small promo tile | `images/promo-small.png` |
| Marquee promo tile | `images/promo-marquee.png` (optional) |
| Official URL | none (needs a verified domain), or skip |
| Homepage URL | https://github.com/dzhiganov/page-review |
| Support URL | https://github.com/dzhiganov/page-review/issues |
| Mature content | No |

The name and summary come from the manifest (`name`, `description`).

## Privacy tab

| Field | Paste |
| --- | --- |
| Single purpose description | listing.md → Single purpose |
| Permission justifications | listing.md → Permission justifications, one per field: `activeTab`, `scripting`, `storage`, `unlimitedStorage`, `contextMenus`, `alarms`, `downloads`, host permissions |
| Are you using remote code? | No, I am not using remote code |
| Data usage: data types | Website content, Web history (see listing.md for the reasoning) |
| Data usage: certifications | tick all three |
| Privacy policy URL | https://github.com/dzhiganov/page-review/blob/main/PRIVACY.md |

## Distribution tab

| Field | Choice |
| --- | --- |
| Payments | Free |
| Visibility | Public (or Unlisted while it's in beta) |
| Regions | All regions |

## After submitting

- [ ] Note the store's review result; broad permissions are not requested, so an in-depth review is
      not expected.
- [ ] Add the store link to the README's Install section.
