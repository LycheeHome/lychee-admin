# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user: the owner and administrator of `lychee`, the Ubuntu Server box at
`192.168.1.10` that hosts every `*.lyly.dev` site. Not a customer, not an
operator following a runbook someone else wrote — the person who built the
Caddy + Cloudflare Tunnel setup this app edits, and who will be the one
debugging it at 11pm when a site is down.

They reach it from a **desktop browser only**, on the LAN or through a
forwarded port, behind single-user basic auth. Phone use is not a real
scenario; there is one wide viewport to design for.

Two jobs of roughly equal weight, and they are different in kind:

- **Mutate** — wire up a new subdomain or tear one down. Rare, deliberate,
  irreversible in places, and touching root-owned config on a live host.
- **Read** — see whether the sites are up, and when one is not, find the hop
  that broke. Quick, frequent, no consequences.

Neither may be buried behind the other.

## Product Purpose

Replace hand-editing `/etc/caddy/Caddyfile` and the sites tunnel's
`/etc/cloudflared/sites-config.yml` with a web UI that performs the same
edits in a safe, fixed order: back up → edit → validate → reload → restart,
stopping at the first failure.

Success is narrow and checkable: a subdomain goes live (or goes away) without
anyone opening a config file by hand, and without ever leaving the host in a
half-applied state. Second, when a site is down, the app names which of the
four hops — DNS, tunnel, Caddy, the site's files or container — is failing,
instead of only saying that something is.

## Positioning

This is not a general reverse-proxy panel. It knows *this* host: that
the sites tunnel is deliberately its own service, a boundary drawn so
restarting it never dropped `ssh.lyly.dev` and kept after that tunnel
was retired; that `/etc/caddy/Caddyfile` uses explicit `http://`
prefixes because TLS terminates at Cloudflare's edge and `auto_https`
is off; that site directories are `web:webdeploy` `2775`; that the
app's own user cannot write either config file except through two
sudo-pinned wrapper scripts.

A generic tool (Nginx Proxy Manager, Caddy's admin API, the Cloudflare
dashboard) cannot encode those facts, and the safety ordering is not a
feature bolted on top of the editing — it *is* the product. The app is also
never reachable through the tunnel it manages, which no hosted panel can
claim.

## Operating Context

- **Host**: `lychee`, Ubuntu Server, `192.168.1.10`. The app runs as its own
  systemd service under a dedicated low-privilege user with narrowly scoped
  `sudo` (validate/reload Caddy, restart `cloudflared-sites`, write two
  pinned config paths, create a site directory, read a container's status).
- **Never exposed through the Cloudflare Tunnel.** Express binds loopback or
  the LAN interface only. This is a hard constraint, not a default.
- **Managed surface**: Caddy site blocks, the sites tunnel's ingress rules,
  `/var/www/<hostname>/` for static sites, service reloads/restarts, and —
  for a Next.js site — its declaration in `LycheeHome/lychee-resources`:
  created tagless by Attach, given a tag by Deploy, set `state: absent` by
  Remove. Those are requests, committed and pushed; the reconciler on
  `lychee` acts on them on its next tick. Nothing else.
- **Outside the app, by design**: creating the Cloudflare DNS record
  (dashboard or `cloudflared tunnel route dns <tunnel-id> <hostname>`);
  running whatever listens on a plain reverse-proxy port; and, for a Next.js
  site, its repository, its first tag and the image build, which happen in
  GitHub on GitHub's runners. The container itself is the reconciler's to
  pull, start and stop. This app **never invokes Docker** — it writes the
  request and the reconciler acts — and reads a container's state only
  through a sudo-pinned status wrapper. Pruning a retired declaration is also
  outside it: Remove retires, it never deletes the file.
- **Surfaces today**: the site list (`GET /`), a site's detail page
  (`GET /sites/:hostname`), add-site as its own page (`GET /sites/new`,
  `POST /sites`), which shows the exact Caddyfile block and tunnel route it is
  about to write in a panel beside the form, fed by `POST /sites/preview` — a
  read-only endpoint that calls the same writers the submit does, so the two
  cannot disagree, remove (`POST /sites/:hostname/delete`), then — each
  always its own request, sent only after the one before succeeded —
  retiring an attached site's declaration (`POST /sites/:hostname/detach`)
  and deleting its files (`POST /sites/:hostname/delete-files`); attaching a
  Next.js site to its repository (`POST /sites/:hostname/attach`); and a
  services board (`GET /services`) whose one action, Deploy a newer tag
  (`POST /services/:name/deploy`), is reused on a site's own page. A global header band (wordmark
  plus `sites`, `services` and `add site`) fronts every page; a site's detail
  page also carries a hostname dropdown on its breadcrumb for moving to another
  site without a round trip through the list. The list's cards carry a status
  pill for reverse-proxy sites.
- **The services board reads, and requests one thing.** It shows every
  declared long-lived process on the host — the reconciler, the services it
  deploys, the game server, Caddy and the sites tunnel — by joining a
  world-readable inventory the reconciler publishes each tick to live state.
  Its one action is Deploy: writing a newer tag the reconciler itself
  published as available into that resource's declaration, never a tag named
  by the request. Attached sites appear there too, because the reconciler
  publishes them like any other resource, but their home is still the site's
  own page, which carries the same offer line and the same Deploy control so
  the two can never disagree about what is on offer. This is the one surface that can show a deploy
  wedged at its retry cap, a state that otherwise only appears in a file on the
  host.
- **Development happens off-host**, on macOS, via `npm run dev:mock` against
  in-memory fakes (`src/dev/`) with seeded sites covering every parser
  branch. Sudoers scope, wrapper-script validation, real `caddy validate`,
  and `web:webdeploy` ownership are only verifiable on `lychee`.
- **Audit trail**: every mutating action is appended to a local log
  (`/var/log/lyly-admin/actions.log`).

## Capabilities and Constraints

- **Site kinds**: static (Caddy serves `/var/www/<hostname>/`) and reverse
  proxy (Caddy forwards to `localhost:<port>`). A reverse-proxy site may
  optionally pick a framework — currently only Next.js — which makes it a
  container resource: the site's page shows a `Dockerfile`, `.dockerignore`
  and GitHub-hosted release workflow to commit to the site's own repository,
  and the choice is recorded as a comment inside the Caddyfile block so it
  survives restarts. Nothing is written to the host for it.
- **Canonical status vocabulary**, shared by the header pill and the last
  hop of the request path: `running`, `unhealthy`, `starting`, `exited`,
  `restarting`, `paused`, `not deployed`, `awaiting image`, `unknown`, and
  `responding` / `not responding` for plain proxies. `starting`,
  `awaiting image` and `unknown` are neutral — not failures.
- **Terminology that must stay stable**: managed hostname; static vs
  reverse-proxy site; framework scaffold; healthcheck path; hop; attach /
  attached; site resource (`<label>-lyly-dev`); declaration; awaiting image; *the sites
  tunnel* (`cloudflared-sites`) as distinct from the SSH tunnel this app must
  never touch.
- **Hostnames are validated as `*.lyly.dev`.** Reverse-proxy ports are
  rejected on conflict with another site, with a port claimed by a declaration
  in `lychee-resources` (in any state, retired included), or with a reserved
  port (the app's own, and Caddy's admin API on 2019).
- **Server-rendered HTML plus vanilla JS, deliberately** — Express templates
  and Tailwind via its CLI, no frontend framework, no client-side routing.
  This is a single-purpose internal tool and that choice is durable.
- **Served over plain HTTP on the LAN**, so `navigator.clipboard` is
  unavailable. Any copy affordance needs a select-the-text fallback.
- **Single user, basic auth, bcrypt hash from the environment.** No roles, no
  invitations, no multi-tenancy — and nothing should be designed as if there
  were.
- **Open, confirmed as likely-later, not settled**: (1) creating the
  Cloudflare DNS record inside the app, and (2) container control beyond
  deploying a tag — restart, logs in the page. DNS is manual today; deploying
  a Next.js site is a request to the reconciler, and its logs are a copyable
  `docker compose -p <name> logs` command. Future
  design should leave room for them rather than treating the manual DNS
  reminder or read-only container status as permanent furniture.

## Brand Commitments

Product name: `lyly-admin`. Managed domain: `lyly.dev`; every managed
hostname is a subdomain of it.

Voice, as already practiced and worth preserving: copy states the mechanism
and the order it runs in. The remove flow lists its four steps in execution
order and says outright that a failed step stops the ones after it. Nothing
destructive is softened, and nothing manual is described as if the app had
done it.

## Evidence on Hand

- Real host facts, tunnel IDs, paths, ownership, and sudo layout —
  `CLAUDE.md`, and the `LycheeHome/lychee-ops` repo that now declares and
  reconciles them (the host files formerly in `deploy/`).
- Real seeded site data exercising every Caddyfile parser branch, including a
  deliberately unmanaged block that must never appear in the list —
  `src/dev/seed.ts`.
- Twelve prior design specs and plans recording decisions already made —
  `docs/superpowers/specs/`, `docs/superpowers/plans/`.
- A live audit log on the host.

Absent, and never to be invented: any user other than the operator, uptime or
traffic metrics, site counts beyond what the Caddyfile actually holds, and any
suggestion that the app manages DNS, TLS, or a process supervisor.

## Product Principles

1. **Show the mechanism, at full size.** The reader maintains this host, so
   the exact file, service, path, port, and command *are* the content — not
   detail to tuck away. Prefer showing a value over folding, capping, or
   truncating it; there is one operator and one wide viewport.
2. **Fail closed, in the stated order.** Every mutating flow names its steps
   in the order they run and stops at the first failure. Nothing in the UI may
   imply a later step ran when it did not.
3. **Destruction is always its own act.** Site files are never removed in the
   same request that removes the config, and never without showing the exact
   path being deleted.
4. **Two jobs, one front door.** A careful mutation and a five-second status
   glance carry equal weight; the design serves both without making either
   the detour.
5. **Never blur automated and manual.** What the app just did and what the
   operator must still do by hand stay visibly, structurally separate.
