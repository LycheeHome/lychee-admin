# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Deployed and verified working end-to-end on `lychee` — add-site, remove-site, and the reverse-proxy port-conflict check have all been exercised for real through the UI, with every affected file (Caddyfile, tunnel config, `/var/www/<hostname>`, audit log) confirmed to change correctly on add and fully revert on remove. The remove-site UI has since been reworked to modals/`fetch` instead of full-page navigation, and the delete-files confirmation was folded into the initial remove-site modal (see Core v1 feature flow below) — not yet re-verified live on `lychee`.

Commands: `npm run dev` (tsx watch), `npm run build` (tsc), `npm run typecheck`, `npm run lint`, `npm start` (runs `dist/server.js`).

## Purpose

`lyly-admin` is a small local web app that runs on a host named `lychee` (Ubuntu Server, `192.168.1.10`) and automates adding/removing subdomains for an existing Caddy + Cloudflare Tunnel setup. It replaces manually editing the Caddyfile and tunnel ingress config by hand.

**Tier 1 scope**: this app does not touch Cloudflare DNS. Creating a hostname's DNS record stays a manual, deliberate step (Cloudflare dashboard or `cloudflared tunnel route dns`). The app only manages the local side: Caddy config, tunnel ingress config, `/var/www` directories, and service reloads/restarts.

## Stack

- Backend: Node.js + TypeScript + Express
- Frontend: server-rendered HTML/vanilla JS — no frontend framework, this is a single-purpose internal tool
- Auth: Basic auth, single user, bcrypt-hashed password stored in `.env` or a local config file (never plaintext)
- Process management: runs as its own systemd service on `lychee`

## Critical safety/security constraints

These are non-negotiable properties of the design — preserve them in any implementation:

- **Never expose this app through the Cloudflare Tunnel.** Bind Express to `127.0.0.1` or the LAN interface (`192.168.1.10`) only. No tunnel ingress rule should ever point at this app's own port.
- **Never run the Express process as root.** It should run as a dedicated low-privilege user with narrowly scoped `sudo` rights (via `visudo`) for exactly: `systemctl reload caddy`, `systemctl restart cloudflared`, and `caddy validate`. Nothing broader.
- **Always validate before reload.** Run `caddy validate --config /etc/caddy/Caddyfile` before every `systemctl reload caddy`. If validation fails, abort and surface the exact error — never reload a broken config.
- **Always back up before editing.** Copy the Caddyfile and tunnel `config.yml` to a timestamped backup (e.g. `/etc/caddy/Caddyfile.bak.<timestamp>`) before any mutation.
- **Fail closed, in order.** If any step in the add/remove flow fails, stop immediately, show the exact error, and do not proceed to later steps (e.g. don't reload Caddy if validation failed; don't restart cloudflared if the Caddyfile edit failed).
- **Never silently delete site files.** Removing `/var/www/<hostname>/` contents requires explicit user confirmation in the flow.
- **Log every mutating action** (what was added/removed, when) to a local log file for auditing.

## Environment this app manages

- Domain: `lyly.dev`; all managed hostnames are subdomains, `*.lyly.dev` — validate new hostnames against this pattern.
- Caddy config lives at `/etc/caddy/Caddyfile`. Existing site blocks use explicit `http://` prefixes (Caddy defaults to binding 443 otherwise), and the Caddyfile has a global `auto_https off` since TLS terminates at Cloudflare's edge, not on `lychee`. New site blocks must follow this same `http://` pattern.
- There are now **two** Cloudflare Tunnels on `lychee`, split deliberately so lyly-admin's restarts never interrupt SSH:
  - `lychee-ssh` (ID `1e9fc42a-0c25-4e64-b5c5-1e229f82a126`), config at `/etc/cloudflared/config.yml`, service `cloudflared.service`. Carries `ssh.lyly.dev` only. **lyly-admin must never touch this tunnel, its config, or its service.**
  - `lychee-sites` (ID `c7081f91-61c2-476b-8505-42d219bb6d7e`), config at `/etc/cloudflared/sites-config.yml`, service `cloudflared-sites.service` (`deploy/cloudflared-sites.service`, `TimeoutStopSec=10` so restarts don't hang ~90s the way the original service's default 90s stop timeout did). Carries `lyly.dev` and every hostname lyly-admin manages. This is the one `src/lib/exec.ts`'s `restartCloudflared()` restarts and `writeManagedConfig()`/`TUNNEL_CONFIG_PATH` edit.
  - A stale copy at `/home/byron/.cloudflared/config.yml` from initial setup was deleted; `cert.pem`/credentials for both tunnels live transiently in `~/.cloudflared` only during `cloudflared tunnel login`/`create`, then get copied to `/etc/cloudflared/` and the home copy is deleted again. Both tunnels run as root (no `User=` in either unit file).
- `/etc/caddy/Caddyfile` and `/etc/cloudflared/sites-config.yml` are both root:root, mode 644, in root:root 755 directories — the dedicated low-privilege app user has no direct write access to either. Config edits go through `deploy/lyly-admin-write-config.sh` (installed as `/usr/local/sbin/lyly-admin-write-config`, root:root, mode 0700), invoked via `sudo` with the target path pinned to one of exactly these two files in `deploy/sudoers.example`. `src/lib/exec.ts`'s `writeManagedConfig()` pipes new file content to it over stdin; never write these files with plain `fs.writeFileSync`.
- Site files are served from `/var/www/<hostname>/`, owned by a dedicated non-login service user `web` (`-s /usr/sbin/nologin`).
- Shared group `webdeploy` (members: `web`, `caddy`, `github-runner`) gives read/write access to site directories. New static site directories should be created with `web:webdeploy` ownership and `2775` permissions (setgid, so new files inherit the group).
- Other users on the box: `byron` (personal/admin), `steam` (Palworld server), `github-runner` (CI) — not directly relevant to this app but useful context for permission decisions.
- Changing `cloudflared`'s ingress config requires a full restart (`systemctl restart cloudflared`), not a reload — reload does not pick up ingress changes.

## Core v1 feature flow

1. **List sites** — parse `/etc/caddy/Caddyfile` into site blocks (hostname, type: static/reverse-proxy, local path or port), and show live status (`systemctl status caddy` / a health-check `curl`).
2. **Add a site** — hostname (validated as `*.lyly.dev`) + type (static or reverse proxy w/ port). Reverse-proxy ports are checked for conflicts first: rejected if another reverse-proxy site already uses that port, or if it's a reserved port (`lyly-admin`'s own `PORT`, or Caddy's admin API on `2019`). On submit, in this order: back up configs → append Caddyfile block → if static, create `/var/www/<hostname>/` (`web:webdeploy`, `2775`, via `deploy/lyly-admin-create-site-dir.sh`) with a placeholder `index.html` → append tunnel ingress rule to the `lychee-sites` tunnel's config (inserted before the catch-all `http_status:404` line, pointing at `service: http://localhost:80`) → `caddy validate` (abort on failure, no reload) → `systemctl reload caddy` → `systemctl restart cloudflared-sites` → show a reminder to manually run `cloudflared tunnel route dns c7081f91-61c2-476b-8505-42d219bb6d7e <hostname>` (or the dashboard CNAME equivalent).
3. **Remove a site** — the UI is a single confirm-remove modal; for static sites it includes an "also delete site files" checkbox showing the exact path. Confirming does, in order: remove the Caddyfile block and matching ingress line → validate + reload Caddy → restart `cloudflared-sites` (`POST /sites/:hostname/delete`, returns JSON) → if the checkbox was checked, immediately follow with a second, separate POST to `/sites/:hostname/delete-files` that performs the actual `rm -rf`. The two are always distinct requests, never one atomic operation — if the first fails, the second is never attempted, so a failed Caddy/tunnel removal can never cascade into deleted files. The client then reminds the user to remove the DNS record manually.

## Deployment

CI/CD runs via the existing self-hosted `github-runner` on `lychee` — see `.github/workflows/deploy.yml`. It builds, syncs everything except `.env`/`node_modules` into `/opt/lyly-admin`, installs production deps there, restarts the `lyly-admin` systemd service, and health-checks it (expects a `401` from `/`, since that's proof Express bound its port and basic-auth middleware ran — `systemctl is-active` alone only proves systemd thinks the process is running, not that it's serving traffic). `github-runner`'s sudo scope for this is in `deploy/sudoers-github-runner.example`, separate from the app's own scope in `deploy/sudoers.example`.

One-time host setup this assumes, not done by CI:
- `/opt/lyly-admin` created, owned `lyly-admin:webdeploy`, mode `2775` (so both the app's own user and `github-runner`, already a `webdeploy` member, can write).
- `.env` placed there manually once, readable by the `webdeploy` group (e.g. `chown lyly-admin:webdeploy .env && chmod 640 .env`) so the workflow's health-check step can read `HOST`/`PORT` from it — never written or overwritten by CI.
- A branch protection rule on `main` (require PR + review, disallow direct/force pushes) — the workflow triggers on every push to `main`, which only means "gated behind PR merge" if direct pushes are actually blocked at the repo settings level.

## Reverse-proxy sites

Choosing "reverse proxy" instead of "static" means `lyly-admin` only wires up Caddy/tunnel routing to `localhost:<port>` — it does not run, deploy, or supervise whatever's listening there. You're responsible for keeping that process alive yourself (its own systemd unit, PM2, Docker, etc.), the same way the Palworld server and `swee` bot are managed independently of this app. This is how you'd host something like a Next.js app: run `next start` (or equivalent) on a local port, then add it here as a reverse-proxy site pointing at that port.

## Resolved questions from initial spec

- `cloudflared`'s config path: confirmed via SSH — see the two-tunnel setup above.
- `cloudflared` runs as root (no `User=` in either tunnel's unit file).
- Dedicated low-privilege user is `lyly-admin` (system user, member of `webdeploy`), created and running in production.
