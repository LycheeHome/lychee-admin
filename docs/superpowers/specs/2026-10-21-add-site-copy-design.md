# The add-site page says only what is true

Date: 2026-10-21 · Source: critique 2026-10-21 (`.impeccable/critique/2026-10-21T09-41-09Z__src-views.md`), its P1 "The add-site copy contradicts how Next.js sites work" and its P2 "The add-site error is said twice, differently". Routed through `/impeccable clarify`.

## Problem

1. **The framework option promises files nobody writes.** It reads `Next.js — generates a Dockerfile + docker-compose.yml` (`src/views/html.ts`, `renderAddSite`). Add-site writes no files for a Next.js site. The scaffold, shown on the new site's page to copy into its own repository, is a `Dockerfile`, a `.dockerignore` and `.github/workflows/release.yml`. There is no compose file.
2. **The reverse-proxy description is wrong for Next.js.** It reads: "Routes to a process you already run and manage yourself on a local port (e.g. `next start`). lychee-admin only wires up the routing — it won't start, stop, or restart that process for you." That's true for a plain proxy. It stays on screen when Next.js is chosen, although for Next.js the reconciler runs the container.
3. **A port conflict is described twice, differently.**
   - **The field**, client-side, from a route-built map of owners, shows `Already in use by reserved (Caddy admin API)`, which is ungrammatical.
   - **The preview panel**, from the shared validator, shows `Port 2019 is reserved (used by lychee-admin itself or Caddy's admin API)`. It hedges between two owners because `SiteEnv.reservedPorts` is an unlabelled list.

## Goal

Every sentence on the add-site page is true for the choice on screen, and a port conflict reads as one sentence that names its one owner, identical in the field and the panel.

## Decisions

### 1. One sentence per port conflict

A pure function in `src/lib/siteValidation.ts`:

```ts
export type PortOwner =
  | { kind: "reserved"; who: string }   // who: "Caddy's admin API" | "lychee-admin itself"
  | { kind: "site"; hostname: string }
  | { kind: "declared"; name: string };
export function portConflictMessage(port: number, owner: PortOwner): string
```

It produces exactly these sentences:

| Owner | Sentence |
|---|---|
| `reserved` | `Port <port> is reserved for <who>.` |
| `site` | `Port <port> is already used by <hostname>.` |
| `declared` | `Port <port> is already claimed by <name> in lychee-resources.` |

**`SiteEnv.reservedPorts`** becomes `ReadonlyMap<number, string>`, mapping each port to who reserves it.

- `src/routes/sites.ts` builds it as `RESERVED_PORTS` → `"Caddy's admin API"`, then `config.port` → `"lychee-admin itself"`.
- The app's own port wins if the two collide.
- Every reader changes from `.includes` to `.has`: the validator, and the Attach route's reserved-port refusal.

**The validator** (`validateAgainstExisting`) returns `portConflictMessage(...)` for all three of its port checks: reserved, declared and existing site.

**The field map** (`computePortOwners` in `src/routes/sites.ts`) maps each port to the **finished sentence**, `portConflictMessage(port, owner)`, built from the same reserved map and the parsed sites.

**`public/app.js`'s `validatePortField`** sets both the visible `#port-error` text and `setCustomValidity` to that sentence, unchanged. The client composes no wording of its own.

The field and the panel therefore show the identical sentence. The panel still carries it, because `#preview-error` is what the blocked Add site button's `aria-describedby` points to.

### 2. The framework option

`<option value="nextjs">` reads exactly: `Next.js — built from its own repository; the reconciler runs it`.

### 3. The reverse-proxy description follows the framework

- `renderAddSite` renders a second description, `#type-proxy-description-nextjs`, immediately after `#type-proxy-description`. It has the same classes and starts with the `hidden` class. Its text is exactly:

  > Routes to a container the reconciler runs on this port, built from the site's own repository. After you add it, the site's page has the steps to attach and deploy.

- `syncFrameworkFields` in `public/app.js` is the existing function that toggles the healthcheck field. When the framework is `nextjs` it now also:
  - shows `#type-proxy-description-nextjs`;
  - hides `#type-proxy-description`;
  - sets the reverse-proxy radio's `aria-describedby` to `type-proxy-description-nextjs`.
- For any other framework value it restores the original description and `aria-describedby="type-proxy-description"`.
- The original description's text is unchanged.

## Out of scope

- `declarationWriter.ts`'s own reserved-port reason. It's shown only at Attach, and it has no owner to name without more plumbing.
- Every other add-site copy.

## Testing

- **`src/lib/siteValidation.test.ts`:**
  - `portConflictMessage` returns each of the three exact sentences.
  - The validator, given `reservedPorts: new Map([[2019, "Caddy's admin API"], [8787, "lychee-admin itself"]])`, returns `Port 2019 is reserved for Caddy's admin API.` for 2019 and `Port 8787 is reserved for lychee-admin itself.` for 8787.
  - The existing-site and declared-claim checks return the table's sentences.
  - Existing tests that build a `SiteEnv` switch to the map.
- **`src/views/html.test.ts`:**
  - The Next.js option has the exact text.
  - `#type-proxy-description` keeps its text.
  - `#type-proxy-description-nextjs` exists with the exact text and the `hidden` class.
  - Neither description contains `docker-compose`.
- **Route test (`src/routes/sites.test.ts`):** `GET /sites/new`'s `port-owners-data` JSON maps 2019 to `Port 2019 is reserved for Caddy's admin API.`, and a seeded proxy's port to `Port <port> is already used by <hostname>.`
- **Playwright against `npm run dev:mock`:**
  - Choose Reverse proxy, then type `2019`: `#port-error` and `#preview-error` show the identical sentence.
  - Pick Next.js: the Next.js description is visible, the original is hidden, and the radio's `aria-describedby` names the Next.js one.
  - Pick None: the original description is back.
- Run `npm run typecheck`, `lint`, `test` and `build`, then run the detector by hand on `src/views`.
