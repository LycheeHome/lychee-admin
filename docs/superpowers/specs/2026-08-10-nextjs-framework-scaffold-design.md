# Framework-aware scaffolding for reverse-proxy sites (Next.js)

## Problem

Adding a reverse-proxy site today only wires up Caddy/tunnel routing to
`localhost:<port>` — the user is entirely on their own for getting a process
listening there, including writing their own Dockerfile/compose file if they
want to run it in Docker. For a common case like a Next.js app, this is
boilerplate lyly-admin can generate.

## Goal

When adding a reverse-proxy site, the user can optionally pick a framework
(v1: Next.js only). If picked, lyly-admin generates a Dockerfile and
docker-compose.yml scaffold in the site's directory, wired to the chosen
port. The user still runs `docker compose up -d --build` themselves —
lyly-admin never invokes Docker. The framework choice is persisted (as a
Caddyfile comment) so it shows up on the site's card in the list, and the
existing "also delete files" remove flow is extended to cover these
directories too, with a warning about stopping the container first.

## Design

### Persisting the framework choice

`src/lib/caddyfile.ts`'s `Site` type gains an optional `framework?: string`,
populated only for reverse-proxy sites. It's stored as a plain Caddy comment
inside the block body — Caddy ignores `#`-prefixed lines, so this is
invisible to actual routing and requires no Caddyfile format change:

```
http://blog.lyly.dev {
	# lyly-admin-framework: nextjs
	reverse_proxy localhost:3000
}
```

- `parseSites` extracts it via `/# lyly-admin-framework:\s*(\S+)/` against
  each block's body and attaches it as `Site.framework` when present.
- `renderReverseProxyBlock(hostname, port, framework?)` emits the comment as
  the block's first line when a framework is given.
- `appendSite` accepts an optional `framework` in its site argument and
  threads it through to `renderReverseProxyBlock`.
- `removeSite` needs **no changes** — it already deletes the whole raw block
  (comment included) as one unit via string replacement on `block.raw`.
- This choice means the framework metadata automatically benefits from every
  existing backup/validate/reload/rollback mechanism already built for the
  Caddyfile, with zero new failure modes to reason about. No second file or
  data store is introduced.

### Scaffold file generation

New file `src/lib/frameworkScaffold.ts`:

```ts
export type Framework = "none" | "nextjs";

export interface Scaffold {
  dockerfile: string;
  compose: string;
}

export function getFrameworkScaffold(framework: Framework, port: string): Scaffold | null {
  if (framework !== "nextjs") return null;
  return { dockerfile: NEXTJS_DOCKERFILE, compose: nextjsCompose(port) };
}
```

**Dockerfile** (standard multi-stage Next.js production build):

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
```

**docker-compose.yml:**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:<port>:3000"
```

The container always listens on 3000 internally (Next.js's default); only
the host-side published port (the one chosen in the add-site form) is
configurable, and it's bound to `127.0.0.1` only — never exposed beyond
localhost, matching the project's existing "backend never directly
reachable" posture (same as Caddy's admin API and lyly-admin's own port).

This module has no knowledge of HTTP routes, config paths, or the rest of
the app — it's a pure function from `(framework, port)` to file contents,
easy to extend with a second framework later without touching anything else.

### Add-site flow (`src/routes/sites.ts`)

- `framework` is read from the request body and normalized: any value other
  than `"nextjs"`, or any value at all when `type !== "reverse-proxy"`,
  collapses to `"none"`. This is not a rejection path — an unrecognized
  `framework` is silently ignored, the same way `port` is already ignored
  for static sites.
- When `framework === "nextjs"`: the existing `createSiteDirectory(hostname)`
  call (currently gated to `type === "static"`) also runs for this
  reverse-proxy site, and both scaffold files are written into it via plain
  `fs.writeFileSync` — the same mechanism already used for the static
  placeholder `index.html`, since `/var/www/<hostname>/` is
  `web:webdeploy` group-writable and needs no sudo round-trip.
- `framework` is passed into `caddyfile.appendSite(...)`.
- The success JSON response includes `framework`, echoing back what was
  applied.
- **Timing/rollback:** scaffold creation happens at the same point as
  static's placeholder file (before `validate`/`reload`), and is **not**
  covered by the validate/reload rollback logic built previously — if
  validation or reload fails afterward, the Caddyfile edit (including the
  framework comment) is rolled back as usual, but the scaffold
  directory/files are left on disk. This is the same asymmetry that already
  exists for static sites' placeholder file today; not a new gap introduced
  by this feature.

### Add-site UI

- The reverse-proxy option card in the add-site dialog gains a
  `<select name="framework">` next to the port field, inside the same
  conditionally-shown wrapper (that wrapper becomes a `<div>` holding two
  labeled fields instead of a single `<label>`). Options: `none` (default,
  selected) and `nextjs` ("Next.js").
- `public/app.js`: the existing port-field visibility toggle also drives the
  framework select (same wrapper, no new toggle logic needed). The add-site
  submit handler includes `framework` in the POST body.
- Success banner text branches on `result.framework`: when `"nextjs"`, it
  reads *"Added blog.lyly.dev with a Next.js scaffold at
  `/var/www/blog.lyly.dev/`. Add your app source and run
  `docker compose up -d --build` there. Don't forget to add the DNS record:
  ..."* — folding the scaffold location and next step into the existing
  reminder banner rather than adding a second banner.

### Site list display

`renderSiteList` gains a new `sitesRoot` parameter (it currently only
receives `domain`; it needs `sitesRoot` to compute each framework site's
scaffold path — see remove flow below). A reverse-proxy card's detail line
changes from `localhost:<port>` to `localhost:<port> · Next.js` when
`site.framework` is set, using a small display-name lookup (`nextjs` →
`"Next.js"`), the same pattern already used for the type badge's `"proxy"`
label.

### Remove-site flow

The "also delete files" checkbox's condition changes from "site is static"
to "the site has a files path at all," computed per-site in
`renderSiteList`:

```ts
const filesPath =
  site.type === "static"
    ? site.target
    : site.type === "reverse-proxy" && site.framework === "nextjs"
      ? path.posix.join(sitesRoot, site.hostname)
      : null;
```

(`html.ts` gains a `import path from "node:path"` for this — `sitesRoot` is
env-configurable via `SITES_ROOT` and isn't guaranteed to lack a trailing
slash, so plain string concatenation would be fragile. `path.posix.join` is
already the convention used everywhere else in the codebase for this exact
join, e.g. in the `/delete-files` route.)

This value becomes the card's `data-site-path` attribute (empty string when
`null`). Client-side, `wireDeleteForms` replaces its current
`trigger.dataset.siteType === "static"` check with
`Boolean(trigger.dataset.sitePath)` — one condition now correctly covers
both static sites and Next.js-scaffolded reverse-proxy sites, and correctly
excludes plain reverse-proxy sites with no framework (empty path).

The card's delete-trigger button also gets a new `data-framework` attribute
(`site.framework ?? ""`). The confirm-remove-dialog's checkbox section
becomes a wrapping `<div>` containing the existing checkbox/path label *and*
a new conditionally-shown warning paragraph, toggled independently by
whether `data-framework` is set:

> ⚠ If a Docker container is running from this directory, stop it first
> with `docker compose down` — deleting the files won't stop it.

The warning never shows for static sites (which never have a running
container). The `POST /sites/:hostname/delete` handler's existing
`wantsFileDelete && existingSite?.type === "static"` gate becomes the same
`filesPath`-based check used in the view, computed server-side the same way,
and the returned `sitePath` in the `needsFileConfirm` response uses that
computed path instead of `existingSite.target` (which is a port number, not
a path, for reverse-proxy sites — using it directly would be a bug).

**`POST /sites/:hostname/delete-files` requires no changes.** It already
deletes `path.posix.join(config.sitesRoot, hostname)` unconditionally,
regardless of site type — the same convention this design reuses for
framework scaffold directories. Once the checkbox correctly appears and
sends the right path, deletion already works with the existing endpoint.

### Out of scope / assumptions

- Docker and the `docker compose` plugin must already be installed on
  `lychee` — lyly-admin never invokes Docker itself, only writes files.
- Only Next.js is supported in this pass. `getFrameworkScaffold`'s
  structure (one function, one case per framework) leaves room to add more
  later without redesigning anything.
- No validation that the user's actual app source builds or runs —
  `docker compose up -d --build` is a manual step entirely outside
  lyly-admin's visibility, same as how it already doesn't supervise
  reverse-proxy backends today.
- No new sudo scope is needed: scaffold files are written the same way the
  static placeholder is (plain `fs.writeFileSync` into the group-writable
  site directory), not through `lyly-admin-write-config` (which stays
  pinned to exactly the Caddyfile and tunnel config, per
  `deploy/sudoers.example`).
