# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is a fresh scaffold — no source code exists yet. There is no package.json, build tooling, or commit history. The content below is the project spec this app should be built against; update this file with real commands (build/lint/test/run) as soon as the project is scaffolded.

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
- Cloudflare Tunnel is named `lychee-ssh`, ID `1e9fc42a-0c25-4e64-b5c5-1e229f82a126`. Its ingress config is at `~/.cloudflared/config.yml` — confirm the actual path (`/home/byron/.cloudflared/config.yml` vs `/etc/cloudflared/config.yml`) when implementing, this is not yet confirmed.
- Site files are served from `/var/www/<hostname>/`, owned by a dedicated non-login service user `web` (`-s /usr/sbin/nologin`).
- Shared group `webdeploy` (members: `web`, `caddy`, `github-runner`) gives read/write access to site directories. New static site directories should be created with `web:webdeploy` ownership and `2775` permissions (setgid, so new files inherit the group).
- Other users on the box: `byron` (personal/admin), `steam` (Palworld server), `github-runner` (CI) — not directly relevant to this app but useful context for permission decisions.
- Changing `cloudflared`'s ingress config requires a full restart (`systemctl restart cloudflared`), not a reload — reload does not pick up ingress changes.

## Core v1 feature flow

1. **List sites** — parse `/etc/caddy/Caddyfile` into site blocks (hostname, type: static/reverse-proxy, local path or port), and show live status (`systemctl status caddy` / a health-check `curl`).
2. **Add a site** — hostname (validated as `*.lyly.dev`) + type (static or reverse proxy w/ port). On submit, in this order: back up configs → append Caddyfile block → if static, create `/var/www/<hostname>/` (`web:webdeploy`, `2775`) with a placeholder `index.html` → append tunnel ingress rule (inserted before the catch-all `http_status:404` line, pointing at `service: http://localhost:80`) → `caddy validate` (abort on failure, no reload) → `systemctl reload caddy` → `systemctl restart cloudflared` → show a reminder to manually run `cloudflared tunnel route dns 1e9fc42a-0c25-4e64-b5c5-1e229f82a126 <hostname>`.
3. **Remove a site** — remove the Caddyfile block and matching ingress line → validate + reload Caddy → restart cloudflared → confirm before deleting `/var/www/<hostname>/` contents → remind the user to remove the DNS record manually.

## Open questions to resolve while implementing

- Exact path of `cloudflared`'s `config.yml` on `lychee`.
- Whether `cloudflared` runs under `byron` or `root`, which determines what the sudo rules need to cover.
- Final choice of the dedicated low-privilege user this Express app runs as.
