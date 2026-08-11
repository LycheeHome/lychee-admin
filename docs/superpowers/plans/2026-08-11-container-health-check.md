# Container Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For Next.js-scaffolded reverse-proxy sites, replace the TCP-only "is anything listening on this port" status check with real `docker compose` container state + health, and add a user-customizable healthcheck HTTP path (baked into the generated Dockerfile's `HEALTHCHECK` instruction) to the add-site form. Plain reverse-proxy sites and static sites are untouched.

**Architecture:** A new pure-parsing module (`src/lib/containerStatus.ts`) turns `docker compose ps --format json` output into a typed status; a new privileged wrapper script + sudoers entry (following the exact pattern of the two existing wrapper scripts) lets the low-privilege `lyly-admin` service account run that command; `src/lib/exec.ts` gains a `checkContainerStatus` export wrapping it; the healthcheck path threads through the add-site form → `caddyfile.ts` (new Caddyfile comment, same mechanism as the existing framework comment) → `frameworkScaffold.ts` (new `HEALTHCHECK` line in the generated Dockerfile); `src/routes/sites.ts` and `src/views/html.ts` are updated together so the detail page's status pill/card read from the new container status for scaffolded sites, while unscaffolded reverse-proxy sites keep the existing TCP check unchanged.

**Tech Stack:** TypeScript, Express, hand-written HTML template strings, Tailwind CSS v4, POSIX shell (wrapper script), sudoers.

## Global Constraints

- Never run `npm run dev` or start the app to verify — verify with `npm run typecheck`, `npm run lint`, and `npm run build` only, plus the throwaway `tsx` render/behavior-check scripts each task specifies.
- The healthcheck path regex is exactly `/^\/[A-Za-z0-9._~\-/]{0,199}$/` — must start with `/`, no whitespace, no query strings, no other characters. This value is embedded literally into a generated Dockerfile line; do not relax this pattern.
- Use `wget` (BusyBox, already in `node:20-alpine`), never `curl`, for the generated `HEALTHCHECK` command — no new `apk add` layer.
- The header status pill for container-backed sites stays strictly binary (green "live" / red "down") — do not introduce a third pill color for "starting" or any other state. The fuller nuance belongs in the Status card text only.
- No editing the healthcheck path after site creation, no retrofitting already-created sites with a `HEALTHCHECK`, no configurable interval/timeout, no support for any framework besides `nextjs` — all explicitly out of scope per the design spec.
- New privileged surface is exactly one new wrapper script (`deploy/lyly-admin-docker-status.sh`) + one new pinned `sudoers.example` line — never Docker group membership, never a broader sudo rule.
- `public/app.js` is plain JS with no test framework and is outside `npm run lint`'s scope (`"lint": "eslint src"` only covers `src/`) — there is no automated check available for Task 6's client-side changes; verify by careful reading of the diff, matching the existing style already in the file.

---

### Task 1: `src/lib/containerStatus.ts` — pure parsing module

**Files:**
- Create: `src/lib/containerStatus.ts`

**Interfaces:**
- Produces: `ContainerState` (`"not-created" | "running" | "exited" | "restarting" | "paused" | "unknown"`), `ContainerHealth` (`"healthy" | "unhealthy" | "starting"`), `ContainerStatus` (`{ state: ContainerState; health?: ContainerHealth }`), and `parseComposePsOutput(raw: string): ContainerStatus` — all consumed by Task 4 (`exec.ts`) and Task 5 (`html.ts`'s new `SiteStatus` type).

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Write a throwaway behavior-check script**

Create `C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\containerstatus-check.ts` (outside the repo, never committed):

```ts
import { parseComposePsOutput } from "C:/Users/byron/WebstormProjects/lyly-admin/.claude/worktrees/container-health-check/src/lib/containerStatus";

function assertEqual(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`FAIL (${label}): expected ${e}, got ${a}`);
}

assertEqual(parseComposePsOutput(""), { state: "not-created" }, "empty string");
assertEqual(parseComposePsOutput("   \n  "), { state: "not-created" }, "whitespace only");
assertEqual(parseComposePsOutput("not json at all"), { state: "unknown" }, "garbage input");

assertEqual(
  parseComposePsOutput(JSON.stringify([{ State: "running", Health: "healthy" }])),
  { state: "running", health: "healthy" },
  "JSON array, running+healthy",
);

assertEqual(
  parseComposePsOutput(JSON.stringify({ State: "exited", Health: "" })),
  { state: "exited" },
  "single JSON object (not array), exited, empty health",
);

const ndjson = `${JSON.stringify({ State: "running", Health: "starting" })}\n${JSON.stringify({ State: "running", Health: "healthy" })}`;
assertEqual(parseComposePsOutput(ndjson), { state: "running", health: "starting" }, "NDJSON takes first entry");

assertEqual(parseComposePsOutput(JSON.stringify([{ State: "dead" }])), { state: "unknown" }, "unrecognized state maps to unknown");

assertEqual(parseComposePsOutput(JSON.stringify([{ State: "restarting" }])), { state: "restarting" }, "restarting, no health field");

assertEqual(parseComposePsOutput(JSON.stringify([])), { state: "not-created" }, "empty array");

console.log("All containerStatus checks passed.");
```

- [ ] **Step 3: Run it**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\containerstatus-check.ts"`
Expected: `All containerStatus checks passed.`

Delete the scratchpad script after it passes.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck` — expect exit 0.
Run: `npm run lint` — expect exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/containerStatus.ts
git commit -m "$(cat <<'EOF'
Add containerStatus.ts to parse docker compose ps output

Pure parsing module, kept separate from the privileged exec call that
will invoke it, mirroring the existing portStatus.ts split.
EOF
)"
```

---

### Task 2: `src/lib/frameworkScaffold.ts` — `HEALTHCHECK` in the generated Dockerfile

**Files:**
- Modify: `src/lib/frameworkScaffold.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getFrameworkScaffold(framework: string, port: string, hostname: string, sitesRoot: string, healthcheckPath: string): Scaffold | null` — the signature gains a required fifth parameter. Consumed by Task 5 (`src/routes/sites.ts`, both the `POST /sites` creation path and the `GET /sites/:hostname` display path).

- [ ] **Step 1: Write a throwaway behavior-check script capturing current output**

Create `C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\scaffold-check.ts`:

```ts
import { getFrameworkScaffold } from "C:/Users/byron/WebstormProjects/lyly-admin/.claude/worktrees/container-health-check/src/lib/frameworkScaffold";

const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/api/health");
if (!scaffold) throw new Error("FAIL: expected a scaffold for nextjs");

const healthcheckLine = 'HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q --spider "http://localhost:3000/api/health" || exit 1';
if (!scaffold.dockerfile.includes(healthcheckLine)) {
  throw new Error(`FAIL: Dockerfile missing expected HEALTHCHECK line.\nGot:\n${scaffold.dockerfile}`);
}

const healthcheckIndex = scaffold.dockerfile.indexOf(healthcheckLine);
const cmdIndex = scaffold.dockerfile.indexOf('CMD ["npm","start"]');
if (cmdIndex === -1) throw new Error("FAIL: Dockerfile missing expected CMD line");
if (healthcheckIndex >= cmdIndex) throw new Error("FAIL: HEALTHCHECK line must come before CMD");

const defaultScaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
if (!defaultScaffold?.dockerfile.includes('CMD wget -q --spider "http://localhost:3000/" || exit 1')) {
  throw new Error(`FAIL: default "/" path not embedded correctly.\nGot:\n${defaultScaffold?.dockerfile}`);
}

console.log("All frameworkScaffold checks passed.");
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\scaffold-check.ts"`
Expected: a TypeScript error (too many arguments to `getFrameworkScaffold`) or a thrown `FAIL` — confirms the check exercises code that doesn't exist yet.

- [ ] **Step 3: Update `src/lib/frameworkScaffold.ts`**

Replace the `nextjsDockerfile` function (currently lines 22-45) with:

```ts
function nextjsDockerfile(buildCommand: string, runCommand: string, healthcheckPath: string): string {
  return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ${buildCommand}

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js* /app/next.config.mjs* ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -q --spider "http://localhost:3000${healthcheckPath}" || exit 1
CMD ${toExecForm(runCommand)}
`;
}
```

Replace `getFrameworkScaffold` (currently lines 94-105) with:

```ts
export function getFrameworkScaffold(
  framework: string,
  port: string,
  hostname: string,
  sitesRoot: string,
  healthcheckPath: string,
): Scaffold | null {
  if (framework !== "nextjs") return null;
  const deployPath = path.posix.join(sitesRoot, hostname);
  return {
    dockerfile: nextjsDockerfile(NEXTJS_BUILD_COMMAND, NEXTJS_RUN_COMMAND, healthcheckPath),
    compose: nextjsCompose(port),
    dockerignore: NEXTJS_DOCKERIGNORE,
    buildCommand: NEXTJS_BUILD_COMMAND,
    runCommand: NEXTJS_RUN_COMMAND,
    deployWorkflow: nextjsDeployWorkflow(hostname, deployPath),
  };
}
```

No other part of the file changes.

- [ ] **Step 4: Re-run the check script and confirm it passes**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\scaffold-check.ts"`
Expected: `All frameworkScaffold checks passed.`

Delete the scratchpad script after it passes.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck` — expect exit 0. This will also surface the two now-broken call sites in `src/routes/sites.ts` (missing the fifth argument) as compile errors — that's expected here; Task 5 fixes both. Confirm the *only* errors reported are in `src/routes/sites.ts` about `getFrameworkScaffold`'s argument count, nothing in `src/lib/frameworkScaffold.ts` itself.

Run: `npm run lint` — expect exit 0 (lint doesn't type-check call sites, so this should still pass).

- [ ] **Step 6: Commit**

```bash
git add src/lib/frameworkScaffold.ts
git commit -m "$(cat <<'EOF'
Add HEALTHCHECK instruction to the generated Next.js Dockerfile

getFrameworkScaffold now takes a healthcheckPath, embedded into a
wget-based HEALTHCHECK line so Docker can report container health,
not just lifecycle state. Callers are updated in a later commit.
EOF
)"
```

This task's `npm run typecheck` step is expected to show pre-existing errors in `src/routes/sites.ts` — that is normal and will be resolved by Task 5, not a regression introduced here.

---

### Task 3: `src/lib/caddyfile.ts` — persist the healthcheck path

**Files:**
- Modify: `src/lib/caddyfile.ts`

**Interfaces:**
- Produces: `Site.healthcheckPath?: string`; `appendSite`'s input type gains `healthcheckPath?: string`. Consumed by Task 5 (`src/routes/sites.ts` reads `site.healthcheckPath` and passes `healthcheckPath` into `appendSite`; `src/views/html.ts` doesn't touch this field directly).

- [ ] **Step 1: Write a throwaway round-trip check script**

Create `C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\caddyfile-healthcheck-check.ts`:

```ts
import { appendSite, parseSites } from "C:/Users/byron/WebstormProjects/lyly-admin/.claude/worktrees/container-health-check/src/lib/caddyfile";

const withHealthcheck = appendSite("", {
  hostname: "app.lyly.dev",
  type: "reverse-proxy",
  target: "3000",
  framework: "nextjs",
  healthcheckPath: "/api/health",
});

if (!withHealthcheck.includes("# lyly-admin-healthcheck: /api/health")) {
  throw new Error(`FAIL: expected healthcheck comment in block.\nGot:\n${withHealthcheck}`);
}

const parsedWith = parseSites(withHealthcheck);
if (parsedWith[0]?.healthcheckPath !== "/api/health") {
  throw new Error(`FAIL: round-trip mismatch, got ${JSON.stringify(parsedWith[0])}`);
}

const withoutFramework = appendSite("", {
  hostname: "plain.lyly.dev",
  type: "reverse-proxy",
  target: "4000",
});

if (withoutFramework.includes("lyly-admin-healthcheck")) {
  throw new Error(`FAIL: unscaffolded site should have no healthcheck comment.\nGot:\n${withoutFramework}`);
}

const parsedWithout = parseSites(withoutFramework);
if (parsedWithout[0]?.healthcheckPath !== undefined) {
  throw new Error(`FAIL: expected undefined healthcheckPath, got ${JSON.stringify(parsedWithout[0])}`);
}

console.log("All caddyfile healthcheck checks passed.");
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\caddyfile-healthcheck-check.ts"`
Expected: TypeScript error (`healthcheckPath` not assignable, since `appendSite`'s input type doesn't have that field yet) or a thrown `FAIL`.

- [ ] **Step 3: Update `src/lib/caddyfile.ts`**

In the `Site` interface (currently lines 5-12), add the field:

```ts
export interface Site {
  hostname: string;
  type: SiteType;
  /** local path for static sites, local port for reverse proxies */
  target: string;
  /** only set for reverse-proxy sites scaffolded with a known framework, e.g. "nextjs" */
  framework?: string;
  /** only set for reverse-proxy sites with a framework — HTTP path Docker polls for HEALTHCHECK */
  healthcheckPath?: string;
}
```

Replace `renderReverseProxyBlock` (currently lines 82-85) with:

```ts
function renderReverseProxyBlock(hostname: string, port: string, framework?: string, healthcheckPath?: string): string {
  const frameworkComment = framework
    ? `\t# lyly-admin-framework: ${framework}\n\t# lyly-admin-healthcheck: ${healthcheckPath ?? "/"}\n`
    : "";
  return `http://${hostname} {\n${frameworkComment}\treverse_proxy localhost:${port}\n}\n`;
}
```

Replace `appendSite` (currently lines 87-98) with:

```ts
export function appendSite(
  content: string,
  site: { hostname: string; type: SiteType; target: string; framework?: string; healthcheckPath?: string },
): string {
  const block =
    site.type === "static"
      ? renderStaticBlock(site.hostname, site.target)
      : renderReverseProxyBlock(site.hostname, site.target, site.framework, site.healthcheckPath);

  const trimmed = content.trimEnd();
  return `${trimmed}\n\n${block}`.trimEnd() + "\n";
}
```

In `parseSites` (currently lines 60-76), replace the `if (proxyMatch)` block with:

```ts
    if (proxyMatch) {
      const frameworkMatch = /#\s*lyly-admin-framework:\s*(\S+)/.exec(block.body);
      const healthcheckMatch = /#\s*lyly-admin-healthcheck:\s*(\S+)/.exec(block.body);
      return {
        hostname: block.hostname,
        type: "reverse-proxy",
        target: proxyMatch[1],
        ...(frameworkMatch ? { framework: frameworkMatch[1] } : {}),
        ...(healthcheckMatch ? { healthcheckPath: healthcheckMatch[1] } : {}),
      };
    }
```

- [ ] **Step 4: Re-run the check script and confirm it passes**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\caddyfile-healthcheck-check.ts"`
Expected: `All caddyfile healthcheck checks passed.`

Delete the scratchpad script after it passes.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck` — expect exit 0 for this file specifically; the pre-existing `sites.ts`/`frameworkScaffold.ts` errors from Task 2 are still expected at this point (Task 5 resolves all of them together).
Run: `npm run lint` — expect exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/caddyfile.ts
git commit -m "$(cat <<'EOF'
Persist the healthcheck path as a lyly-admin-healthcheck comment

Same mechanism as the existing lyly-admin-framework comment — always
written alongside it when a framework is set, parsed back the same way.
EOF
)"
```

---

### Task 4: `checkContainerStatus` — privileged docker status check

**Files:**
- Create: `deploy/lyly-admin-docker-status.sh`
- Modify: `deploy/sudoers.example`
- Modify: `src/lib/exec.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `ContainerStatus`, `parseComposePsOutput` from `../lib/containerStatus` (Task 1).
- Produces: `checkContainerStatus(hostname: string): Promise<ContainerStatus>` in `src/lib/exec.ts`. Consumed by Task 5 (`src/routes/sites.ts`).

- [ ] **Step 1: Write `deploy/lyly-admin-docker-status.sh`**

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

- [ ] **Step 2: Make it executable and syntax-check it**

Run: `chmod +x deploy/lyly-admin-docker-status.sh`
Run: `sh -n deploy/lyly-admin-docker-status.sh`
Expected: no output, exit 0 (syntax is valid — this only checks parsing, it does not execute the script, so no `docker` install is needed).

- [ ] **Step 3: Update `deploy/sudoers.example`**

Replace the entire file with:

```
# Install to /etc/sudoers.d/lyly-admin with `visudo -cf` to check syntax first.
# Grants the dedicated lyly-admin service user exactly the commands
# src/lib/exec.ts shells out to — nothing else. Do not broaden this to
# "ALL" for any of these commands.
#
# Also install these three wrapper scripts to /usr/local/sbin/ (owned root:root,
# mode 0700):
#   deploy/lyly-admin-write-config.sh      -> lyly-admin-write-config
#   deploy/lyly-admin-create-site-dir.sh   -> lyly-admin-create-site-dir
#   deploy/lyly-admin-docker-status.sh     -> lyly-admin-docker-status
#
# lyly-admin-write-config is the only way the lyly-admin user can write to the
# two root-owned config files below, since /etc/caddy and /etc/cloudflared are
# root:root 755. lyly-admin-create-site-dir and lyly-admin-docker-status are
# both invoked with NO argument restriction here deliberately — sudo's
# wildcard argument matching isn't available on every sudo build (and is
# bypassable regardless), so hostname validation happens inside each script
# instead of in this file.

Cmnd_Alias LYLY_ADMIN_CMDS = \
    /usr/bin/caddy validate --config /etc/caddy/Caddyfile, \
    /usr/bin/systemctl reload caddy, \
    /usr/bin/systemctl restart cloudflared-sites, \
    /usr/bin/systemctl status caddy --no-pager, \
    /usr/local/sbin/lyly-admin-create-site-dir, \
    /usr/local/sbin/lyly-admin-docker-status, \
    /usr/local/sbin/lyly-admin-write-config /etc/caddy/Caddyfile, \
    /usr/local/sbin/lyly-admin-write-config /etc/cloudflared/sites-config.yml

lyly-admin ALL=(root) NOPASSWD: LYLY_ADMIN_CMDS
```

- [ ] **Step 4: Write a throwaway MOCK_SYSTEM check script**

Create `C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\exec-container-status-check.ts`:

```ts
import { checkContainerStatus } from "C:/Users/byron/WebstormProjects/lyly-admin/.claude/worktrees/container-health-check/src/lib/exec";

const result = await checkContainerStatus("app.lyly.dev");
const expected = JSON.stringify({ state: "running", health: "healthy" });
const actual = JSON.stringify(result);
if (actual !== expected) {
  throw new Error(`FAIL: expected ${expected} under MOCK_SYSTEM, got ${actual}`);
}

console.log("checkContainerStatus MOCK_SYSTEM check passed.");
```

- [ ] **Step 5: Run it to confirm it fails**

Run (PowerShell): `$env:MOCK_SYSTEM='true'; npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\exec-container-status-check.ts"`
Expected: TypeScript error — `checkContainerStatus` doesn't exist yet on `exec.ts`'s exports.

- [ ] **Step 6: Update `src/lib/exec.ts`**

Add this import alongside the existing ones at the top of the file (after `import { config } from "../config";`):

```ts
import { parseComposePsOutput, type ContainerStatus } from "./containerStatus";
```

Add this function at the end of the file, after `writeManagedConfig`:

```ts

/**
 * Reads container lifecycle state + Docker health (if the image defines a
 * HEALTHCHECK) for a Next.js-scaffolded site via deploy/lyly-admin-docker-status.sh.
 * Unlike every other function in this file, failures are swallowed into
 * { state: "unknown" } rather than thrown — this is best-effort display
 * data for the detail page, not a mutating action a caller needs to detect
 * and roll back. No raw stderr reaches the page.
 */
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

- [ ] **Step 7: Re-run the check script and confirm it passes**

Run (PowerShell): `$env:MOCK_SYSTEM='true'; npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\exec-container-status-check.ts"`
Expected: `checkContainerStatus MOCK_SYSTEM check passed.`

Delete the scratchpad script after it passes.

- [ ] **Step 8: Update `CLAUDE.md`**

In the "Deployment" section's "One-time host setup this assumes, not done by CI" bullet list, add a new bullet after the existing `.env` bullet and before the branch-protection bullet:

```markdown
- `deploy/lyly-admin-docker-status.sh` installed at `/usr/local/sbin/lyly-admin-docker-status` (root:root, mode 0700) and the matching `sudoers.d/lyly-admin` line added — see `deploy/sudoers.example`. Enables the site detail page's container-status check for Next.js-scaffolded sites; without it, `checkContainerStatus` falls back to `{ state: "unknown" }` rather than failing the page.
```

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck` — expect exit 0 for `src/lib/exec.ts` and `src/lib/containerStatus.ts` specifically; the pre-existing `sites.ts` errors from Task 2 are still expected (Task 5 resolves them).
Run: `npm run lint` — expect exit 0.

- [ ] **Step 10: Commit**

```bash
git add deploy/lyly-admin-docker-status.sh deploy/sudoers.example src/lib/exec.ts CLAUDE.md
git commit -m "$(cat <<'EOF'
Add checkContainerStatus and its privileged wrapper script

New deploy/lyly-admin-docker-status.sh (root:root, 0700) runs
docker compose ps for a given site, pinned in sudoers.example the same
way the two existing wrapper scripts are. Failures degrade to
{ state: "unknown" } rather than throwing, since this is best-effort
display data. One-time host setup documented in CLAUDE.md.
EOF
)"
```

---

### Task 5: Wire container status into the detail route and page

**Files:**
- Modify: `src/views/html.ts`
- Modify: `src/routes/sites.ts`

**Interfaces:**
- Consumes: `ContainerState`, `ContainerHealth` from `../lib/containerStatus` (Task 1); `checkContainerStatus` from `../lib/exec` (Task 4); `getFrameworkScaffold`'s new five-argument signature (Task 2); `Site.healthcheckPath`, `appendSite`'s `healthcheckPath` field (Task 3).
- Produces: `SiteStatus` (exported from `src/views/html.ts`): `{ kind: "tcp"; responding: boolean } | { kind: "container"; state: ContainerState; health?: ContainerHealth }`. `renderSiteDetail`'s third parameter changes from `respondingOnPort?: boolean` to `status?: SiteStatus`.

This task resolves the `getFrameworkScaffold` and `renderSiteDetail` call-site errors left pending since Task 2 — after this task, `npm run typecheck` must be fully clean, no pending errors anywhere.

- [ ] **Step 1: Write a throwaway render-check script**

Create `C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\render-container-status-check.ts`:

```ts
import { renderSiteDetail } from "C:/Users/byron/WebstormProjects/lyly-admin/.claude/worktrees/container-health-check/src/views/html";

function assertContains(html: string, needle: string, label: string) {
  if (!html.includes(needle)) throw new Error(`FAIL (${label}): expected to find ${JSON.stringify(needle)}`);
}

const site = { hostname: "app.lyly.dev", type: "reverse-proxy" as const, target: "3000", framework: "nextjs" };

assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "not-created" }),
  "Not deployed yet on localhost:3000",
  "not-created",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "not-created" }),
  "text-red-300",
  "not-created is red",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "not-created" }),
  "down</span>",
  "not-created pill is down",
);

assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running" }),
  "text-green-300",
  "running, no health data, is green",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running" }),
  "live</span>",
  "running, no health data, pill is live",
);

assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running", health: "healthy" }),
  "Healthy.",
  "running+healthy shows Healthy",
);

assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running", health: "starting" }),
  "down</span>",
  "running+starting pill is down (binary pill, no third color)",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running", health: "starting" }),
  "health check still starting",
  "running+starting card text",
);

assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running", health: "unhealthy" }),
  "down</span>",
  "running+unhealthy pill is down",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "running", health: "unhealthy" }),
  "but unhealthy",
  "running+unhealthy card text",
);

assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "exited" }),
  "Exited on localhost:3000",
  "exited card text",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "restarting" }),
  "crash-looping",
  "restarting card text",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "paused" }),
  "Paused on localhost:3000",
  "paused card text",
);
assertContains(
  renderSiteDetail(site, "/var/www", { kind: "container", state: "unknown" }),
  "Unable to check container status",
  "unknown card text",
);

// Unscaffolded reverse-proxy site keeps the existing TCP-driven rendering.
const plainSite = { hostname: "plain.lyly.dev", type: "reverse-proxy" as const, target: "4000" };
assertContains(
  renderSiteDetail(plainSite, "/var/www", { kind: "tcp", responding: true }),
  "Responding on localhost:4000",
  "tcp responding",
);
assertContains(
  renderSiteDetail(plainSite, "/var/www", { kind: "tcp", responding: false }),
  "Not responding on localhost:4000",
  "tcp not responding",
);

// Static sites: no status argument at all, no pill, no Status card.
const staticSite = { hostname: "blog.lyly.dev", type: "static" as const, target: "/var/www/blog.lyly.dev" };
const staticHtml = renderSiteDetail(staticSite, "/var/www");
if (staticHtml.includes(">Status<")) throw new Error("FAIL: static site should have no Status card");

console.log("All container-status render checks passed.");
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\render-container-status-check.ts"`
Expected: TypeScript error — `renderSiteDetail`'s third parameter is still `respondingOnPort?: boolean`, not a `SiteStatus` object.

- [ ] **Step 3: Update `src/views/html.ts`**

Change the top import (currently line 1) to also import the container types:

```ts
import { computeFilesPath, type Site } from "../lib/caddyfile";
import type { ContainerHealth, ContainerState } from "../lib/containerStatus";
```

Add this type export and helper function immediately before `export function renderSiteDetail(` (currently line 176):

```ts
export type SiteStatus =
  | { kind: "tcp"; responding: boolean }
  | { kind: "container"; state: ContainerState; health?: ContainerHealth };

function renderContainerStatusLine(
  status: { kind: "container"; state: ContainerState; health?: ContainerHealth },
  site: Site,
  filesPath: string | null,
): string {
  const port = escapeHtml(site.target);
  const deployHint = filesPath
    ? `<br />
        <span class="text-[0.75rem] text-stone-400">Run <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">docker compose up -d --build</code> in <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(filesPath)}/</code> to deploy.</span>`
    : "";
  const logsHint = (reason: string) =>
    filesPath
      ? `<br />
        <span class="text-[0.75rem] text-stone-400">${reason} Check <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">docker compose logs</code> in <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(filesPath)}/</code>.</span>`
      : "";

  if (status.state === "not-created") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Not deployed yet on localhost:${port}.${deployHint}</p>`;
  }
  if (status.state === "exited") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Exited on localhost:${port}.${logsHint("The container stopped unexpectedly.")}</p>`;
  }
  if (status.state === "restarting") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Restarting on localhost:${port}.${logsHint("The container is crash-looping.")}</p>`;
  }
  if (status.state === "paused") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Paused on localhost:${port}.</p>`;
  }
  if (status.state === "unknown") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Unable to check container status.</p>`;
  }
  // status.state === "running"
  if (status.health === "unhealthy") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Running on localhost:${port}, but unhealthy.${logsHint("The health check is failing.")}</p>`;
  }
  if (status.health === "starting") {
    return `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Running on localhost:${port}, health check still starting.</p>`;
  }
  return `<p class="text-green-300 text-[0.85rem] leading-relaxed m-0">&#9679; Running on localhost:${port}.${status.health === "healthy" ? " Healthy." : ""}</p>`;
}
```

Replace the `renderSiteDetail` function signature and its `statusPill`/`statusCard` computation (currently lines 176-222) with:

```ts
export function renderSiteDetail(
  site: Site,
  sitesRoot: string,
  status?: SiteStatus,
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string },
): string {
  const filesPath = computeFilesPath(site, sitesRoot);
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;

  const isLive =
    status?.kind === "tcp"
      ? status.responding
      : status?.kind === "container"
        ? status.state === "running" && (status.health === undefined || status.health === "healthy")
        : undefined;

  const statusPill =
    isLive === undefined
      ? ""
      : isLive
        ? `<span class="${STATUS_PILL_LIVE}">&#9679; live</span>`
        : `<span class="${STATUS_PILL_DOWN}">&#9679; down</span>`;

  const overviewCard =
    site.type === "static"
      ? `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Overview</h3>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}</p>
      </section>`
      : `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Overview</h3>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">local port:</span> ${escapeHtml(site.target)}</p>
        ${frameworkLabel ? `<p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">framework:</span> ${escapeHtml(frameworkLabel)}</p>` : ""}
      </section>`;

  const statusCard =
    site.type === "static" || !status
      ? ""
      : status.kind === "tcp"
        ? `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Status</h3>
        ${
          status.responding
            ? `<p class="text-green-300 text-[0.85rem] leading-relaxed m-0">&#9679; Responding on localhost:${escapeHtml(site.target)}</p>`
            : `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Not responding on localhost:${escapeHtml(site.target)}${
                filesPath
                  ? `<br />
        <span class="text-[0.75rem] text-stone-400">Run <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">docker compose up -d --build</code> in <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(filesPath)}/</code> to deploy.</span>`
                  : ""
              }</p>`
        }
      </section>`
        : `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Status</h3>
        ${renderContainerStatusLine(status, site, filesPath)}
      </section>`;
```

The rest of `renderSiteDetail` (the `deployCard`, `deleteFilesSection`, and the final `return layout(...)` block, currently lines 224-303) is unchanged — leave it exactly as-is.

- [ ] **Step 4: Update `src/routes/sites.ts`**

Change the import block (currently lines 8-19) to:

```ts
import {
  CommandError,
  checkContainerStatus,
  createSiteDirectory,
  reloadCaddy,
  restartCloudflared,
  validateCaddyfile,
  writeManagedConfig,
} from "../lib/exec";
import { getFrameworkScaffold } from "../lib/frameworkScaffold";
import { logAction } from "../lib/logger";
import { checkPortOpen } from "../lib/portStatus";
import { renderSiteDetail, renderSiteList, renderSiteNotFound, type SiteStatus } from "../views/html";
```

Add a new constant near `hostnamePattern` (currently around line 27):

```ts
const HEALTHCHECK_PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]{0,199}$/;
```

Replace the body of the `GET /sites/:hostname` handler from the `const port = Number(site.target);` line through the `res.send(renderSiteDetail(...))` line (currently lines 86-93) with:

```ts
    const port = Number(site.target);
    const status: SiteStatus = site.framework
      ? { kind: "container", ...(await checkContainerStatus(hostname)) }
      : { kind: "tcp", responding: port >= 1 && port <= 65535 ? await checkPortOpen(port) : false };
    const scaffold = site.framework
      ? getFrameworkScaffold(site.framework, site.target, hostname, config.sitesRoot, site.healthcheckPath ?? "/")
      : null;
    const scaffoldCommands = scaffold
      ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand, deployWorkflow: scaffold.deployWorkflow }
      : undefined;

    res.send(renderSiteDetail(site, config.sitesRoot, status, scaffoldCommands));
```

In the `POST /sites` handler, change the field-reading block (currently lines 101-105) to:

```ts
  const hostname = String(req.body?.hostname ?? "").trim().toLowerCase();
  const type = req.body?.type === "reverse-proxy" ? "reverse-proxy" : "static";
  const port = String(req.body?.port ?? "").trim();
  const rawFramework = String(req.body?.framework ?? "").trim();
  const framework = type === "reverse-proxy" && rawFramework === "nextjs" ? "nextjs" : undefined;
  const rawHealthcheckPath = String(req.body?.healthcheckPath ?? "").trim();
  const healthcheckPath = framework === "nextjs" ? rawHealthcheckPath || "/" : undefined;
```

Add a new validation block immediately after the existing port-validation block (currently lines 112-115), before the `try` block starts:

```ts

  if (healthcheckPath && !HEALTHCHECK_PATH_PATTERN.test(healthcheckPath)) {
    res.status(400).json({ error: `"${healthcheckPath}" is not a valid healthcheck path` });
    return;
  }
```

Change the `appendSite` call (currently line 155) to:

```ts
      caddyfile.appendSite(caddyfileContent, { hostname, type, target, framework, healthcheckPath }),
```

Change the `getFrameworkScaffold` call inside the `else if (framework)` branch (currently line 167) to:

```ts
      const scaffold = getFrameworkScaffold(framework, port, hostname, config.sitesRoot, healthcheckPath ?? "/");
```

No other lines in `src/routes/sites.ts` change.

- [ ] **Step 5: Re-run the render-check script and confirm it passes**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\render-container-status-check.ts"`
Expected: `All container-status render checks passed.`

Delete the scratchpad script after it passes.

- [ ] **Step 6: Typecheck, lint, and build — must be fully clean**

Run: `npm run typecheck` — expect exit 0 with **no** errors anywhere, including the `sites.ts`/`frameworkScaffold.ts` errors that were expected (and OK) after Tasks 2-4.
Run: `npm run lint` — expect exit 0.
Run: `npm run build` — expect exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/views/html.ts src/routes/sites.ts
git commit -m "$(cat <<'EOF'
Wire container status into the site detail page

Scaffolded reverse-proxy sites now get their header pill and Status
card from docker compose container state + health via
checkContainerStatus, instead of the TCP-only check. Unscaffolded
reverse-proxy sites and static sites are unchanged. renderSiteDetail's
respondingOnPort parameter is replaced by a SiteStatus discriminated
union that carries both cases explicitly.
EOF
)"
```

---

### Task 6: Add-site form healthcheck field

**Files:**
- Modify: `src/views/html.ts`
- Modify: `public/app.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing new from earlier tasks (this is the form that produces the `healthcheckPath` value Task 5's `POST /sites` handler already validates).
- Produces: nothing consumed by a later task — this is the last task in the plan.

- [ ] **Step 1: Update `src/views/html.ts`**

In `renderSiteList`, inside the `.port-input` wrapper `<div>` (currently lines 148-161), add a new label after the existing framework `<select>` label, immediately before the closing `</div>`:

```html
          <label class="hidden flex-col gap-1.5 text-[0.85rem] text-stone-400" id="healthcheck-field-wrapper">
            Healthcheck path (optional)
            <input type="text" name="healthcheckPath" placeholder="/" class="${INPUT}" id="healthcheck-field" />
            <span class="text-[0.75rem] text-stone-400 leading-snug">Path Docker will poll inside the container to decide if it's healthy. Defaults to <code class="font-mono">/</code>.</span>
          </label>
```

So the full `.port-input` block (currently lines 148-161) reads:

```html
        <div class="port-input hidden flex-col gap-3 border-l-2 border-l-rose-800/70 pl-3 ml-1">
          <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
            Local port (reverse proxy only)
            <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" />
            <span class="port-error hidden text-red-300 text-[0.8rem]"></span>
          </label>
          <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
            Framework (optional)
            <select name="framework" class="${INPUT}" id="framework-field">
              <option value="none">None</option>
              <option value="nextjs">Next.js — generates a Dockerfile + docker-compose.yml</option>
            </select>
          </label>
          <label class="hidden flex-col gap-1.5 text-[0.85rem] text-stone-400" id="healthcheck-field-wrapper">
            Healthcheck path (optional)
            <input type="text" name="healthcheckPath" placeholder="/" class="${INPUT}" id="healthcheck-field" />
            <span class="text-[0.75rem] text-stone-400 leading-snug">Path Docker will poll inside the container to decide if it's healthy. Defaults to <code class="font-mono">/</code>.</span>
          </label>
        </div>
```

This label starts with the `hidden` utility class (`display: none`), toggled the same way `.port-input` itself is toggled — via `element.style.display` in JS, which overrides the class regardless of specificity (see Step 2).

- [ ] **Step 2: Update `public/app.js`**

Immediately after the existing `typeInputs.forEach((input) => input.addEventListener("change", syncPortField)); syncPortField();` lines (currently lines 113-114), add:

```js
const frameworkField = document.getElementById("framework-field");
const healthcheckFieldWrapper = document.getElementById("healthcheck-field-wrapper");

function syncFrameworkFields() {
  const isNextjs = frameworkField?.value === "nextjs";
  if (healthcheckFieldWrapper) healthcheckFieldWrapper.style.display = isNextjs ? "flex" : "none";
}

frameworkField?.addEventListener("change", syncFrameworkFields);
syncFrameworkFields();
```

In the dialog `close` handler (currently lines 138-143), add `syncFrameworkFields();` alongside the existing `syncPortField();` call:

```js
addSiteDialog?.addEventListener("close", () => {
  addSiteError?.classList.add("hidden");
  addSiteForm?.reset();
  syncPortField();
  syncFrameworkFields();
  validatePortField();
});
```

In the submit handler (currently lines 145-184), add a `healthcheckPath` read alongside the existing `framework` read, and include it in the `URLSearchParams` body:

```js
  const formData = new FormData(addSiteForm);
  const hostname = String(formData.get("hostname") ?? "").trim();
  const type = formData.get("type");
  const port = String(formData.get("port") ?? "").trim();
  const framework = String(formData.get("framework") ?? "").trim();
  const healthcheckPath = String(formData.get("healthcheckPath") ?? "").trim();

  addSiteInFlight = true;
  addSiteError?.classList.add("hidden");
  try {
    const response = await fetch("/sites", {
      method: "POST",
      body: new URLSearchParams({ hostname, type, port, framework, healthcheckPath }),
    });
```

No other lines in `public/app.js` change.

- [ ] **Step 3: Update `CLAUDE.md`**

In the "Reverse-proxy sites" section, immediately after the paragraph ending "...run `next start` (or equivalent) on a local port yourself, then add it here pointing at that port.", add a new paragraph:

```markdown

When Next.js is selected, an additional optional "Healthcheck path" field (default `/`) controls the `HEALTHCHECK` instruction baked into the generated Dockerfile — Docker polls this HTTP path inside the container on a fixed 30s interval to decide if it's healthy. For these sites, the detail page's status now comes from `docker compose ps` (container lifecycle state, plus Docker's own health verdict once the image has been rebuilt with the new Dockerfile) instead of a raw TCP check. This path is fixed at creation time — changing it means removing and re-adding the site, the same as changing framework or port today. Sites created before this feature has no healthcheck comment and no `HEALTHCHECK` in their already-built image, so their Status card simply shows container state with no health data until removed and re-added.
```

- [ ] **Step 4: Verify — no automated check available for `public/app.js`**

Per this plan's Global Constraints, `public/app.js` has no test framework and is outside `eslint`'s configured scope. Re-read the three edited sections of `public/app.js` from Step 2 against what's written above, confirming: `frameworkField`/`healthcheckFieldWrapper` are queried once at module load (matching the existing `portFieldWrapper`/`portField` pattern just above them), `syncFrameworkFields` is called both on `change` and once immediately (matching `syncPortField`'s call pattern), and the dialog's `close` handler calls it too so reopening the dialog resets the field. This is a manual read-back, not a runnable check.

- [ ] **Step 5: Typecheck, lint, and build**

Run: `npm run typecheck` — expect exit 0 (this task touches no `.ts` files besides none — `html.ts` is a template-string change with no new types, so this should already be clean from Task 5).
Run: `npm run lint` — expect exit 0.
Run: `npm run build` — expect exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts public/app.js CLAUDE.md
git commit -m "$(cat <<'EOF'
Add healthcheck path field to the add-site form

Shown only when Next.js is selected as the framework, mirroring how
the port field already shows/hides for reverse-proxy sites. Feeds the
validation and Dockerfile generation wired up in earlier commits.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** add-site healthcheck field + validation (Task 6 form, Task 5 `HEALTHCHECK_PATH_PATTERN`/`POST /sites`); Caddyfile persistence via `# lyly-admin-healthcheck:` comment (Task 3); `HEALTHCHECK` Dockerfile instruction using `wget` (Task 2); new privileged wrapper script + sudoers entry + `CLAUDE.md` one-time setup note (Task 4); `containerStatus.ts` parsing both JSON-array and NDJSON `docker compose ps` output (Task 1); detail page header pill (strictly binary) + Status card per-state text table (Task 5); unscaffolded reverse-proxy and static sites unchanged (Task 5's `status.kind === "tcp"` branch and `!status` branch, verified by the render-check script's `plainSite`/`staticSite` assertions) — every design-doc section maps to a task.
- **Placeholder scan:** no TBD/TODO; every step has literal, complete code — including the full replacement blocks for existing functions, not diffs described in prose.
- **Type consistency:** `getFrameworkScaffold`'s five-argument signature (Task 2) matches both call sites added in Task 5 exactly (`site.healthcheckPath ?? "/"` in the detail route, `healthcheckPath ?? "/"` in the add route). `ContainerState`/`ContainerHealth` (Task 1) are imported and used identically in `exec.ts` (Task 4) and `html.ts` (Task 5). `SiteStatus` is defined once in `html.ts` (Task 5) and imported by `sites.ts`, never redefined. `Site.healthcheckPath` (Task 3) is read in exactly one place (`sites.ts`'s `GET /sites/:hostname`, Task 5) with a consistent `?? "/"` default.
- **Sequencing note:** `npm run typecheck` is expected to show errors after Tasks 2, 3, and 4 individually (both call sites of `getFrameworkScaffold`, plus the not-yet-existing `checkContainerStatus`/`SiteStatus` symbols, live in files those tasks don't touch) — this is called out explicitly in each of those tasks' verification steps so it isn't mistaken for a regression. Task 5 is where the whole build becomes clean again; its Step 6 says so explicitly.
