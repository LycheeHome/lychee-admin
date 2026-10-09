# Admin over HTTPS at admin.lychee.land — design

**Date:** 2026-10-09
**Repos:** `LycheeHome/lychee-ops` (all code); `LycheeHome/lychee-admin` (CLAUDE.md only)
**Status:** approved in conversation, section by section

## Goal

Reach lyly-admin at `https://admin.lychee.land` with a browser-trusted
certificate, from tailnet devices only. lychee-ops sets it up and keeps it set
up, renewal included. `http://lychee.local` keeps working unchanged. The app
never goes on the Cloudflare tunnel.

## Decisions, and what was rejected

- **Name: `admin.lychee.land`.** The apex was rejected because it would point
  the domain's front door at an unreachable address and block a future public
  homepage. A two-label name (`admin.lan.lychee.land`) was rejected as clumsier
  once the app-side reservation (below) closes the collision it was avoiding.
- **Certificate: Let's Encrypt via certbot's Cloudflare DNS plugin**
  (`python3-certbot-dns-cloudflare`, Ubuntu's own package). Rejected:
  - Tailscale Serve: free certificates, but only for `*.ts.net` names.
  - Cloudflare's proxy or Zero Trust: both put the app on Cloudflare's path,
    which "never expose this app through the tunnel" rules out.
  - Cloudflare Origin CA: browsers don't trust it.
  - A custom Caddy build with the DNS module: the distro package can't do this
    without it, and it adds a binary to maintain.
- **DNS record: created by hand**, in the dashboard, once: an A record,
  `admin` → the tailnet address, DNS-only. The reconciler only checks it and
  never writes DNS. This is the same Tier 1 rule as for sites.
- **Caddy config lives in a file the app never reads.** lyly-admin parses only
  `http://<host> {` blocks in `/etc/caddy/Caddyfile`, and edits that file as
  text: remove cuts exactly its own block, add appends. lychee-ops therefore
  owns `/etc/caddy/conf.d/admin.caddy` outright, and the Caddyfile carries one
  line, `import /etc/caddy/conf.d/*.caddy`. The app can't list or remove the
  admin block, and the app's own `caddy validate` still covers it.
- **The app-side reservation is NOT part of this project.** Today
  `DOMAIN=lyly.dev`, so the add-site form cannot produce `admin.lychee.land`.
  The name becomes creatable only when `DOMAIN` flips, so the
  `RESERVED_HOSTNAMES` check (add-site rejects it in both preview and submit,
  and the reconciler checks `.env` carries it) ships in the `lychee.land`
  domain-move project, before the flip. That project must not merge without it.

## lychee-ops: new role `admin_https`

**Placement: last in `playbook.yml`, after every app role.** A failing role
skips every role after it. Last means a certificate problem can never block an
app or resource deploy, while a failure still trips the unit's `OnFailure=`
Discord alert.

**New `group_vars/all.yml` values:**
- `admin_hostname: admin.lychee.land`
- `tailnet_address: <the tailnet address, from HOST.md>`
- `admin_upstream: 192.168.1.10:8787`

lychee-ops is private, so the address belongs there and not in this public
app repo; its value is in lychee-ops' `HOST.md`.

**Each tick, in order:**

1. **Packages:** install `certbot` and `python3-certbot-dns-cloudflare` (apt).
   The package cache is refreshed only on a tick where one of them is missing
   (checked with a read-only `dpkg-query`), so an installed host never runs
   `apt-get update` from the reconciler, and a mirror blip or the
   unattended-upgrades lock can't fail a tick over nothing.
2. **Credential:**
   - The token gates only this step and step 3. Everything from step 4 on runs
     whenever `/etc/letsencrypt/live/{{ admin_hostname }}/fullchain.pem`
     exists, token or not. Otherwise taking the token out of `secrets.yml`
     after issuance would silently stop the copy, validate, reload and expiry
     check while certbot's timer kept renewing `live/`, and Caddy would serve
     a stale copy until it expired, with every tick green.
   - If `cloudflare_dns_token` is empty or undefined after the reconciler's
     `include_vars` of `/etc/lychee-ops/secrets.yml`, print one line saying so.
     If there is also no certificate, end the role with `meta: end_role`
     (available in the pinned ansible-core 2.20.1) without failing.
   - With a token, write `/etc/letsencrypt/cloudflare-lychee-land.ini`
     (root:root `0600`, `no_log: true`) holding `dns_cloudflare_api_token`.
     The file stays after the token leaves `secrets.yml`, and certbot's
     renewals keep using it, so revoking the token means revoking it at
     Cloudflare and removing this file.
3. **Issue once** (only with a token):
   - **Command:** `certbot certonly --non-interactive --agree-tos
     --register-unsafely-without-email --dns-cloudflare
     --dns-cloudflare-credentials <ini> --cert-name {{ admin_hostname }}
     -d {{ admin_hostname }}`
   - **Runs only when** `/etc/letsencrypt/live/{{ admin_hostname }}/fullchain.pem`
     is missing (`creates:`).
   - **No email:** Let's Encrypt no longer sends expiry mail; step 7 is the
     expiry signal.
   - **Renewal** is certbot's own packaged systemd timer. The role never runs
     `renew`.
4. **Copy for Caddy:**
   - **What:** `fullchain.pem` and `privkey.pem` from `live/` to
     `/etc/caddy/certs/{{ admin_hostname }}/`, with `remote_src` and following
     symlinks.
   - **Ownership:** directory root:caddy `0750`, files root:caddy `0640`.
   - **Why a copy:** certbot's own key files are root-only, and Caddy runs as
     `caddy`.
   - **Why every tick:** a renewal reaches Caddy within one tick, with no
     certbot hook to maintain.
5. **Caddy config:**
   - **The file:** template `/etc/caddy/conf.d/admin.caddy`
     (root:root `0644`; directory `0755`), with `validate: caddy validate
     --adapter caddyfile --config %s`. The fragment is a complete Caddyfile on
     its own and its certificate was copied in step 4, so a broken fragment is
     never written. Under `--check` the template module neither writes nor
     validates:
     ```
     https://{{ admin_hostname }} {
         tls /etc/caddy/certs/{{ admin_hostname }}/fullchain.pem /etc/caddy/certs/{{ admin_hostname }}/privkey.pem
         reverse_proxy {{ admin_upstream }}
     }
     ```
   - **The import line:** `lineinfile` ensures `import /etc/caddy/conf.d/*.caddy`
     is in `/etc/caddy/Caddyfile`, inserted after the global options block.
   - **Order:** this step runs only after steps 3–4 succeed, because Caddy
     rejects config that names a missing certificate.
6. **Validate, then reload:**
   - **Validate:** on every tick where the certificate exists (not under
     `--check`), run `caddy validate --config /etc/caddy/Caddyfile`. A
     failure fails the tick, every tick, until fixed.
   - **Reload:** a change in step 4 or 5 leaves a marker,
     `/var/lib/lychee-ops/admin_https.reload-pending`. After a successful
     validate, if the marker is present, run `systemctl reload caddy` and then
     remove the marker. A reload that failed or never ran is therefore retried
     on the next tick, and a reload never happens without a validate just
     before it, as CLAUDE.md requires of the app.
   - **Why every tick, not only on change** (amended during review): with
     validate-on-change, a failed validate left a broken Caddyfile on disk
     while later ticks passed. Caddy keeps its running config, but the app's
     own `caddy validate` and any Caddy restart would then fail.
   - **Run inline, not as a handler,** so the sequence completes within this
     role.
7. **Expiry check:** `openssl x509 -checkend 1209600 -noout -in <copied
   fullchain>`. A non-zero result fails the tick: less than 14 days left means
   renewal has stopped working, caught around day 76 of 90.
8. **DNS check:**
   - **What:** `getent ahosts {{ admin_hostname }}`.
   - **If it doesn't list `{{ tailnet_address }}`:** print a warning (debug)
     and don't fail. The record is a hand step, and "not yet created" is a
     normal state.

**Deliberately not done:**
- **No `bind {{ tailnet_address }}` in the block.** If `tailscaled` weren't up
  when Caddy started, Caddy would fail to start at all, taking `lychee.local`
  and every site with it. Tailnet-only reachability comes from the record
  pointing at a tailnet-only address.
- **The `lineinfile` race, accepted.** If lyly-admin writes the Caddyfile
  between the role's read and write, the app's write can drop the `import`
  line, or the reverse. The next tick restores it. The app's writes are rare
  and each is preceded by a backup.
- **The Caddyfile is touched, but only that one line.** The host role
  documents the Caddyfile as deliberately undeclared, because declaring it
  would revert every site the app adds. That stays true: `lineinfile` asserts
  one line and leaves the rest of the file alone. The host role's comment is
  updated to name this exception.
- **No http→https redirect.** The global `auto_https off` disables it, and
  `lychee.local` stays plain HTTP by design.

## Hand steps (operator, once)

1. **Cloudflare API token:**
   - **Permissions:** Zone → DNS → Edit, zone resources limited to
     `lychee.land`.
   - **Where it goes:** `cloudflare_dns_token: <value>` in
     `/etc/lychee-ops/secrets.yml` on lychee.
   - **Blast radius:** if it leaked, it could only touch `lychee.land` DNS.
2. **DNS record:** A record `admin` → the tailnet address (in lychee-ops'
   `HOST.md`), DNS only (grey cloud).

The order doesn't matter. Without the token the role waits; without the record
it warns.

## Docs

- **lychee-admin `CLAUDE.md`,** a paragraph beside the `lychee.local` mention:
  - **What it is:** `https://admin.lychee.land` is the tailnet-only HTTPS
    address, and lychee-ops owns `conf.d/admin.caddy`, outside anything the app
    parses.
  - **Why it's safe:** it never touches the tunnel, so the never-expose rule
    holds.
  - **Funnel:** `tailscale funnel` is never used for this app.
  - **Link:** the reservation ships with the domain move.
- **lychee-ops `HOST.md`:** the certificate paths and owner; the token's
  location and scope; the credential file, and that it outlives the token's
  removal from `secrets.yml`.

## Tests (off-host, `tests/run.sh`)

- **Template:** render `admin.caddy` from `group_vars` and assert its text: the
  `https://admin.lychee.land` header, the `tls` line naming the copied paths,
  `reverse_proxy 192.168.1.10:8787`, and nothing else.
  - **Why no `caddy validate` here:** neither the dev machine nor the CI runner
    has Caddy. Step 6 on the host is the real validation, and it fails closed.
- **Expiry predicate:** generate two throwaway self-signed certificates with
  `openssl`, one valid 30 days and one 5 days. Assert step 7's exact command
  passes the first and fails the second.
- **Syntax:** `--syntax-check` of `playbook.yml` with the new role.

## Verification on lychee (after merge and both hand steps)

1. **First tick:** the certificate is issued; `conf.d/admin.caddy` and the
   `import` line exist; Caddy was validated and reloaded; and
   `systemctl show caddy -p ActiveEnterTimestamp` is unchanged, meaning a
   reload, not a restart.
2. **From the Mac on the tailnet:** `curl https://admin.lychee.land/` returns
   `401` without `-k`, and the certificate issuer is Let's Encrypt.
3. **Unchanged:**
   - `http://lychee.local/` returns `401`;
   - `/etc/cloudflared/sites-config.yml` ingress is still only the 404
     catch-all;
   - lyly-admin's site list doesn't show `admin.lychee.land`.
4. **Off the tailnet:** with Tailscale off on the Mac, the name resolves and
   the connection fails.
5. **Next tick:** nothing in `admin_https` reports changed, and there's no
   reload.
6. **Renewal:** the operator runs `sudo certbot renew --dry-run`, and it
   passes.
