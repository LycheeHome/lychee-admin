# Container health check for Next.js-scaffolded sites

## Problem

The site detail page's live status (see
`docs/superpowers/specs/2026-08-11-site-detail-page-redesign-design.md`) is a
raw TCP check against `127.0.0.1:<port>`. For Next.js-scaffolded reverse-proxy
sites this conflates several different situations under one "not responding"
state: the container was never built/started, it started and then crashed,
it's stuck in a restart loop, or it's genuinely still booting. All of these
read identically on the page today, even though `docker compose ps` already
knows the difference for any site with a `docker-compose.yml` — because
lyly-admin scaffolds one for every Next.js site.

## Goal

For Next.js-scaffolded reverse-proxy sites only, replace the TCP check with a
real container status read from Docker: lifecycle state (running / exited /
restarting / not created yet) plus, once the generated Dockerfile defines a
`HEALTHCHECK`, Docker's own health verdict (healthy / unhealthy / starting).
The healthcheck's HTTP path is a new, user-customizable field on the add-site
form (default `/`), baked into the generated Dockerfile at creation time.
Plain (unscaffolded) reverse-proxy sites and static sites are unaffected —
they keep exactly today's behavior.

## Design

### Add-site form: healthcheck path field

In the add-site dialog (`src/views/html.ts`'s `renderSiteList`), a new text
input appears inside the existing framework-conditional area, shown only
when the framework select's value is `nextjs` (mirroring how `.port-input`
already shows/hides based on site type in `public/app.js`):

```html
<label class="${FORM_LABEL}" id="healthcheck-field-wrapper">
  Healthcheck path (optional)
  <input type="text" name="healthcheckPath" placeholder="/" class="${INPUT}" id="healthcheck-field" />
  <span class="text-[0.75rem] text-stone-400 leading-snug">Path Docker will poll inside the container to decide if it's healthy. Defaults to <code class="font-mono">/</code>.</span>
</label>
```

`public/app.js` gets a `syncFrameworkFields()` function paralleling
`syncPortField()`: toggles `#healthcheck-field-wrapper`'s visibility off the
framework select's `change` event (and on initial load), and includes
`healthcheckPath` in the `URLSearchParams` body the submit handler already
builds.

**Validation** (`src/routes/sites.ts`'s `POST /sites` handler): only checked
when `type === "reverse-proxy" && framework === "nextjs"`. Must start with
`/`, contain only `[A-Za-z0-9._~-]` and `/` beyond that, and be 200
characters or fewer:

```ts
const HEALTHCHECK_PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]{0,199}$/;
```

Blank input defaults to `/` before validation runs. A non-matching value
returns the same `400 { error }` shape as the existing hostname/port checks.
This is deliberately conservative — no query strings, no encoded characters —
because the value is embedded literally into a generated Dockerfile's
`HEALTHCHECK` instruction; anything permitting whitespace or shell/Dockerfile
metacharacters would let it break out of that one line.

### `src/routes/sites.ts`: `POST /sites`

Alongside the existing `hostname`/`type`/`port`/`framework` reads, the
handler reads and validates `healthcheckPath`:

```ts
const rawHealthcheckPath = String(req.body?.healthcheckPath ?? "").trim();
const healthcheckPath = framework === "nextjs" ? rawHealthcheckPath || "/" : undefined;

if (healthcheckPath && !HEALTHCHECK_PATH_PATTERN.test(healthcheckPath)) {
  res.status(400).json({ error: `"${healthcheckPath}" is not a valid healthcheck path` });
  return;
}
```

placed with the other `400`-returning validation, before the `try` block.
`healthcheckPath` then flows into both existing calls that need it:
`caddyfile.appendSite(caddyfileContent, { hostname, type, target, framework, healthcheckPath })`
(step 2) and `getFrameworkScaffold(framework, port, hostname, config.sitesRoot, healthcheckPath ?? "/")`
(step 3, only reached when `framework` is set, so `healthcheckPath` is
always defined there in practice).

### Persistence: new Caddyfile comment

Same mechanism as the existing `# lyly-admin-framework: <value>` comment.
`src/lib/caddyfile.ts`:

- `Site` gains `healthcheckPath?: string`.
- `renderReverseProxyBlock` gains a `healthcheckPath?: string` parameter;
  when `framework` is set, it also writes
  `\t# lyly-admin-healthcheck: ${healthcheckPath}\n` into the block (written
  whenever framework is written — always paired, never one without the
  other).
- `appendSite`'s input type gains the matching optional field.
- `parseSites` gains a second comment regex,
  `/#\s*lyly-admin-healthcheck:\s*(\S+)/`, read the same way the framework
  comment already is.

Sites created before this feature has no `# lyly-admin-healthcheck:` comment
and no `HEALTHCHECK` baked into their already-built image — `healthcheckPath`
comes back `undefined` for them, which the status check (below) treats as
"no health data available," not an error.

### Dockerfile: `HEALTHCHECK` instruction

`src/lib/frameworkScaffold.ts`:

- `getFrameworkScaffold(framework, port, hostname, sitesRoot, healthcheckPath)`
  gains a fifth parameter, `healthcheckPath: string` (callers always pass a
  resolved value — `"/"` when the site has no custom path — never
  `undefined`, keeping the scaffold builder itself free of defaulting logic).
- `nextjsDockerfile` appends one line to the runner stage, before `CMD`:

  ```
  HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q --spider "http://localhost:3000${healthcheckPath}" || exit 1
  ```

  `wget` (not `curl`) because BusyBox — already present in the `node:20-alpine`
  base image — provides it; `curl` would need an extra `apk add` layer.
  Targets container-internal port `3000` (matching the Dockerfile's
  `EXPOSE 3000`), independent of the host-mapped port in `docker-compose.yml`.

### New privileged status check

**`deploy/lyly-admin-docker-status.sh`** (new file, installed at
`/usr/local/sbin/lyly-admin-docker-status`, owned root:root, mode 0700 —
same convention as the two existing wrapper scripts):

```sh
#!/bin/sh
# Installed at /usr/local/sbin/lyly-admin-docker-status, owned root:root, mode 0700.
# Invoked via sudo with no argument restriction in sudoers.example, for the
# same reason lyly-admin-create-site-dir.sh is: sudo's wildcard argument
# matching isn't available on every build. This script does hostname
# validation and hardcodes the /var/www prefix itself.
#
# Usage: sudo /usr/local/sbin/lyly-admin-docker-status <hostname>
set -eu

hostname="$1"

case "$hostname" in
  *[!a-zA-Z0-9.-]* | .* | *..* | *.)
    echo "lyly-admin-docker-status: invalid hostname: $hostname" >&2
    exit 1
    ;;
esac

case "$hostname" in
  *.lyly.dev)
    ;;
  *)
    echo "lyly-admin-docker-status: refusing non-lyly.dev hostname: $hostname" >&2
    exit 1
    ;;
esac

compose_file="/var/www/$hostname/docker-compose.yml"

if [ ! -f "$compose_file" ]; then
  # No scaffold on disk (shouldn't happen — the caller only invokes this for
  # framework-scaffolded sites — but fail closed with empty output rather
  # than an ambiguous error) so the caller reads it as "not created."
  exit 0
fi

docker compose -f "$compose_file" ps --format json
```

**`deploy/sudoers.example`** gains one more pinned command:

```
Cmnd_Alias LYLY_ADMIN_CMDS = \
    ...(existing entries)..., \
    /usr/local/sbin/lyly-admin-docker-status
```

with the same "no argument restriction, script validates instead" note
already documented for `lyly-admin-create-site-dir`.

This is a one-time manual host-setup step (installing the script + editing
`sudoers.d`), the same as the two existing wrapper scripts — not something
CI can do, since it's root-owned system configuration outside
`/opt/lyly-admin`. `CLAUDE.md`'s "One-time host setup this assumes, not done
by CI" list gains this line. Once installed, it's generic across every
current and future site — no per-site setup.

### Parsing: `src/lib/containerStatus.ts` (new file)

Pure, testable parsing logic, kept separate from the privileged exec call —
same split `portStatus.ts` already models (network/parsing logic separate
from the privileged commands in `exec.ts`):

```ts
export type ContainerState = "not-created" | "running" | "exited" | "restarting" | "paused" | "unknown";
export type ContainerHealth = "healthy" | "unhealthy" | "starting";

export interface ContainerStatus {
  state: ContainerState;
  health?: ContainerHealth;
}

const STATE_MAP: Record<string, ContainerState> = {
  running: "running",
  exited: "exited",
  restarting: "restarting",
  paused: "paused",
};

const HEALTH_MAP: Record<string, ContainerHealth> = {
  healthy: "healthy",
  unhealthy: "unhealthy",
  starting: "starting",
};

/**
 * Parses `docker compose ps --format json` output. Compose versions differ
 * on whether this is a single JSON array or newline-delimited JSON objects
 * (NDJSON) — this handles both rather than assuming a specific Compose
 * version is installed on the host.
 */
export function parseComposePsOutput(raw: string): ContainerStatus {
  const trimmed = raw.trim();
  if (!trimmed) return { state: "not-created" };

  let entries: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(trimmed);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      entries = trimmed.split("\n").map((line) => JSON.parse(line));
    } catch {
      return { state: "unknown" };
    }
  }

  if (entries.length === 0) return { state: "not-created" };

  const entry = entries[0];
  const rawState = String(entry.State ?? "").toLowerCase();
  const rawHealth = String(entry.Health ?? "").toLowerCase();

  return {
    state: STATE_MAP[rawState] ?? "unknown",
    health: HEALTH_MAP[rawHealth],
  };
}
```

### `src/lib/exec.ts`: `checkContainerStatus`

New export, following the existing privileged-command pattern exactly
(including the `MOCK_SYSTEM` escape hatch every other function here has):

```ts
export async function checkContainerStatus(hostname: string): Promise<ContainerStatus> {
  if (MOCK_SYSTEM) {
    return { state: "running", health: "healthy" };
  }
  try {
    const { stdout } = await run("sudo", ["/usr/local/sbin/lyly-admin-docker-status", hostname]);
    return parseComposePsOutput(stdout);
  } catch {
    return { state: "unknown" };
  }
}
```

Unlike every other function in `exec.ts`, failures here are swallowed into
`{ state: "unknown" }` rather than thrown — a status check is inherently
best-effort display data, not a mutating action where the caller needs to
detect and roll back a failure. No raw stderr reaches the page.

### `src/routes/sites.ts`: `GET /sites/:hostname`

Replaces the existing `checkPortOpen`-only branch with one that checks
`site.framework` first:

```ts
const status: SiteStatus | undefined =
  site.type === "static"
    ? undefined
    : site.framework
      ? { kind: "container", ...(await checkContainerStatus(hostname)) }
      : { kind: "tcp", responding: port >= 1 && port <= 65535 ? await checkPortOpen(port) : false };
```

`getFrameworkScaffold`'s call in this same handler (used only to regenerate
`buildCommand`/`runCommand`/`deployWorkflow` text for the Deploy card, never
to rewrite files) passes `site.healthcheckPath ?? "/"` as its new fifth
argument — the returned `scaffold.dockerfile` value (now containing a
`HEALTHCHECK` line) is still never rendered on the page, unchanged from the
existing spec's "no raw Dockerfile display" rule.

### `src/views/html.ts`: `renderSiteDetail`

`respondingOnPort?: boolean` is replaced by a discriminated union,
`status?: SiteStatus`:

```ts
export type SiteStatus =
  | { kind: "tcp"; responding: boolean }
  | { kind: "container"; state: ContainerState; health?: ContainerHealth };
```

- `status` is `undefined` → same as today: static sites, no pill, no Status
  card content beyond Overview.
- `status.kind === "tcp"` → unchanged rendering from the just-shipped
  redesign (green "live" / red "down" pill, matching Status card sentence).
  This is the path unscaffolded reverse-proxy sites still take.
- `status.kind === "container"` → new rendering:

  **Header pill:** green "live" only when `state === "running"` and
  `health` is `undefined` or `"healthy"`. Every other combination (including
  `"starting"`, to avoid the pill overclaiming an app that hasn't passed its
  own health check yet) renders red "down" — keeping the pill strictly
  binary, matching the `tcp` case's vocabulary instead of introducing a
  third color.

  **Status card**, one sentence per state (all still prefixed with the
  `●` bullet, colored to match the pill — green for the live case, red for
  every other):

  | state | health | Status card text |
  |---|---|---|
  | `not-created` | — | "Not deployed yet on localhost:`<port>`." + existing docker-compose hint |
  | `running` | none / `healthy` | "Running on localhost:`<port>`." (add " Healthy." when `health === "healthy"`) |
  | `running` | `starting` | "Running on localhost:`<port>`, health check still starting." |
  | `running` | `unhealthy` | "Running on localhost:`<port>`, but unhealthy." + "The health check at `<healthcheckPath>` is failing — check `docker compose logs` in `<path>/`." |
  | `exited` | — | "Exited on localhost:`<port>`." + "The container stopped unexpectedly — check `docker compose logs` in `<path>/`." |
  | `restarting` | — | "Restarting on localhost:`<port>`." + "The container is crash-looping — check `docker compose logs` in `<path>/`." |
  | `paused` | — | "Paused on localhost:`<port>`." |
  | `unknown` | — | "Unable to check container status." (no hint — cause unknown) |

  All hint text reuses the same `filesPath`-derived directory string the
  existing not-responding hint already computes; no new path-resolution
  logic.

### `CLAUDE.md` updates

- "One-time host setup this assumes, not done by CI" gains the
  `lyly-admin-docker-status` script + sudoers line.
- "Reverse-proxy sites" section gains a paragraph describing the healthcheck
  path field and what it changes about the generated Dockerfile.

### Out of scope

- No editing the healthcheck path after site creation (confirmed earlier in
  this session) — to change it, remove and re-add the site, same as changing
  framework or port today.
- No retrofitting already-created sites with a `HEALTHCHECK` — this only
  applies to sites created after this feature ships. An existing site's
  Status card falls back to `health: undefined` forever unless the site is
  removed and re-added.
- No configurable healthcheck interval/timeout/start-period — fixed at
  `30s`/`3s`/`10s`.
- No healthcheck support for any framework other than Next.js, since that's
  the only framework `getFrameworkScaffold` supports today.
- No change to plain (unscaffolded) reverse-proxy sites or static sites —
  both keep exactly their current behavior.
- No Docker socket / `docker` group access — the wrapper script + pinned
  sudoers entry is the only new privilege, following the same
  narrowly-scoped pattern as every existing privileged command.
