# lyly-admin

A small local admin app for managing `*.lyly.dev` subdomains on `lychee`, an existing Caddy + Cloudflare Tunnel setup. It replaces manually editing the Caddyfile and tunnel ingress config by hand with a web UI to list, add, and remove sites.

**Scope:** this app manages the local side only — Caddy config, tunnel ingress config, `/var/www` directories, and service reloads/restarts. It does not touch Cloudflare DNS; creating a hostname's DNS record stays a manual step (Cloudflare dashboard or `cloudflared tunnel route dns`).

## Features

- **List sites** — parses the Caddyfile and shows every managed hostname, its type, and target (path or port). A fixed left rail on every page carries a switcher listing all of them, so moving between two sites no longer routes back through the dashboard.
- **Add a site** — a page of its own at `/sites/new`: static (serves `/var/www/<hostname>/`) or reverse proxy (forwards to a local port you run yourself, e.g. a Next.js app). Backs up configs, validates the Caddyfile before ever reloading, then lands you on the new site's page, which states the DNS record you still have to add yourself.
- **Remove a site** — reverses the Caddyfile/tunnel config changes, with an optional confirm-then-delete step for a static site's files (never deleted in the same request that removes the site).
- Every mutating action is logged to a local audit log.

## Stack

Node.js + TypeScript + Express, server-rendered HTML/vanilla JS (no frontend framework), single-user basic auth (bcrypt-hashed password).

## Local development

```bash
npm install
npm run dev:mock
```

Then open http://127.0.0.1:8787 and sign in with `dev` / `dev`.

`dev:mock` runs the app against in-memory fakes — no `.env`, no fixture
files, no sudo, and nothing on your machine is modified. Adding and removing
sites works fully, so the add page and the remove modal can both be exercised
locally; the state resets to a seeded set of sites on every restart.

`npm run dev` is the same thing wired to the real host: it expects a `.env`
and the actual Caddy/`cloudflared` files, so it only works on `lychee`.

Other scripts: `npm test` (`tsx --test`), `npm run build`, `npm run build:css`,
`npm run typecheck`, `npm run lint`, `npm start` (runs the built
`dist/server.js`).

## Deployment

Runs as its own systemd service (`deploy/lyly-admin.service`) under a dedicated low-privilege user with narrowly scoped `sudo` rights — see `deploy/sudoers.example` and the wrapper scripts in `deploy/` for exactly what it's allowed to do (validate/reload Caddy, restart the tunnel, write two specific config files, create site directories, check a Next.js site's container status). CI/CD (`.github/workflows/deploy.yml`) is split into two jobs: `test` runs on a GitHub-hosted runner for every pull request and push to `main`, and `deploy` runs on the self-hosted runner — builds, syncs, and restarts the service — only on `main` and only once `test` passes.

Full architecture notes, safety constraints, and host-specific details live in [`CLAUDE.md`](./CLAUDE.md).
