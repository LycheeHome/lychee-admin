# Modal-based site removal flow (no page navigation)

## Problem

Removing a static site with "Also delete files" checked currently does two full-page
navigations after the initial remove-site modal confirm:

1. `POST /sites/:hostname/delete` → server responds with a full HTML page,
   `renderConfirmDeleteFiles`, asking the user to confirm permanent file deletion.
2. `POST /sites/:hostname/delete-files` → server responds with another full HTML page,
   `renderFilesDeletedResult`.

The initial "Remove site?" confirmation was already converted from `confirm()` to a
`<dialog>` modal (see commit `7ff4616`), but the file-deletion confirmation and both
result pages still navigate the user away from the site list (`/`).

## Goal

The whole remove flow — including the optional file-deletion confirmation and the
success/error outcome — happens without leaving `/`. The user never sees an
intermediate page; they see modals and a transient banner, and the removed site's
card disappears from the list in place.

## Design

### Endpoints become JSON APIs

`POST /sites/:hostname/delete` and `POST /sites/:hostname/delete-files` stop
rendering full HTML pages. They return JSON instead:

- `delete`:
  - Success: `{ removed: true, needsFileConfirm: boolean, sitePath?: string }`
  - Failure: `{ error: string }` with the existing status code (500)
- `delete-files`:
  - Success: `{ deleted: true }`
  - Failure: `{ error: string }` with the existing status code (400/500)

All existing server-side logic (backup → edit Caddyfile/tunnel config → validate →
reload Caddy → restart cloudflared-sites, and the actual `fs.rmSync` for file
deletion) is unchanged — only the response shape changes, and the second-page
`res.send(renderConfirmDeleteFiles(...))` branch is replaced with a JSON response.

`renderConfirmDeleteFiles`, `renderFilesDeletedResult`, and `renderRemoveResult`
are deleted from `src/views/html.ts` — they become unused. `renderError` stays,
since it's still used by the add-site flow (out of scope for this change).

### Client flow (`public/app.js`)

1. Click **Remove** → existing `confirm-remove-dialog` opens (unchanged).
2. Confirm → instead of `form.submit()`, issue
   `fetch(POST /sites/:hostname/delete, { deleteFiles })`.
3. On success:
   - If `needsFileConfirm` is `true` → open a new `confirm-delete-files-dialog`
     (same visual pattern as the existing dialogs: dark panel, danger button,
     cancel button), showing `sitePath` and a warning that this permanently
     deletes the directory. Cancel just closes the dialog — the site is already
     removed from Caddy/tunnel config at this point; only the on-disk files are
     left behind.
   - Confirm on that dialog → `fetch(POST /sites/:hostname/delete-files)`.
4. On any successful terminal step (file delete confirmed, or no file delete was
   requested): remove that site's `<article>` card from the DOM (if the grid
   becomes empty, show the existing "No sites configured yet." placeholder), and
   show a transient success banner, e.g. "Removed blog.lyly.dev — remember to
   remove the DNS record in Cloudflare manually."
5. On any fetch error (network failure, non-2xx response, or `{ error }` body):
   show an error banner. The site card is left untouched in both failure cases
   (Caddy/tunnel edit failed, or file deletion failed after the site was already
   removed from config — these are already distinguishable failure states from
   the existing route logic, and the error message text carries that context).

### Banner/flash element

A single `<div id="flash-banner">` is added to the page layout (empty by default,
`aria-live="polite"`), styled with the same red banner classes the current
`?error=` query-param banner in `renderSiteList` uses for errors, and a
rose/success variant for success messages.

- Only one banner is shown at a time — showing a new one clears/replaces any
  banner currently visible, so rapid or overlapping actions don't stack messages.
- **Success** banners auto-dismiss after ~4 seconds (fade out).
- **Error** banners stay until manually dismissed via an "×" button — error text
  may need to be read carefully or copied (e.g. a `caddy validate` failure
  message), so it shouldn't disappear on a timer.

The existing server-rendered `?error=` banner in `renderSiteList` (used by the
add-site flow) is untouched — this is a separate, JS-driven banner for the
remove/delete-files flow only.

### Out of scope

- The add-site flow and its error handling (`renderError`, the `?error=` query
  param banner) are untouched.
- No change to the Caddy/tunnel-config mutation logic itself — only how the
  result is communicated to the browser.
