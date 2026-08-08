# lyly-admin

A small local admin app for managing `*.lyly.dev` subdomains on `lychee`, an existing Caddy + Cloudflare Tunnel setup. It replaces manually editing the Caddyfile and tunnel ingress config by hand with a web UI to list, add, and remove sites.

**Scope:** this app manages the local side only — Caddy config, tunnel ingress config, `/var/www` directories, and service reloads/restarts. It does not touch Cloudflare DNS; creating a hostname's DNS record stays a manual step (Cloudflare dashboard or `cloudflared tunnel route dns`).

## Features

- **List sites** — parses the Caddyfile and shows every managed hostname, its type, and target (path or port).
- **Add a site** — static (serves `/var/www/<hostname>/`) or reverse proxy (forwards to a local port you run yourself, e.g. a Next.js app). Backs up configs, validates the Caddyfile before ever reloading, and shows a reminder to add the DNS record once done.
- **Remove a site** — reverses the Caddyfile/tunnel config changes, with an optional confirm-then-delete step for a static site's files (never deleted in the same request that removes the site).
- Every mutating action is logged to a local audit log.

## Stack

Node.js + TypeScript + Express, server-rendered HTML/vanilla JS (no frontend framework), single-user basic auth (bcrypt-hashed password).

## Local development

```bash
npm install
cp .env.example .env   # fill in ADMIN_PASSWORD_HASH at minimum
npm run dev
```

`npm run dev` runs the TypeScript server and the Tailwind CSS build in watch mode side by side. Other scripts: `npm run build` (also rebuilds `public/style.css`), `npm run build:css`, `npm run typecheck`, `npm run lint`, `npm start` (runs the built `dist/server.js`).

## Deployment

Runs as its own systemd service (`deploy/lyly-admin.service`) under a dedicated low-privilege user with narrowly scoped `sudo` rights — see `deploy/sudoers.example` and the wrapper scripts in `deploy/` for exactly what it's allowed to do (validate/reload Caddy, restart the tunnel, write two specific config files, create site directories). CI/CD is a self-hosted GitHub Actions runner (`.github/workflows/deploy.yml`) that builds, syncs, and restarts the service on push to `main`.

Full architecture notes, safety constraints, and host-specific details live in [`CLAUDE.md`](./CLAUDE.md).
