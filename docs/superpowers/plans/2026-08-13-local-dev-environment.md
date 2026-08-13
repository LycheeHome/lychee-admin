# Local Development Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lyly-admin` runnable on macOS and Windows with no sudo, systemd, Caddy, `cloudflared`, or fixture files, by replacing the `MOCK_SYSTEM` environment flag with dependency injection — and add the repository's first test suite, sequenced to prove behavior survived the refactor.

**Architecture:** Two narrow interfaces (`SystemCommands` for privileged shell-outs, `FileSystem` for disk access) get real implementations wired into `src/server.ts` and fake implementations wired into a new dev-only `src/dev/server.ts` that is excluded from both the build output and the deploy rsync. Route tests are written first against the current code using temp directories, then re-pointed at the in-memory fakes, so passing before *and* after is the evidence the rewrite was behavior-preserving.

**Tech Stack:** Node.js 24, TypeScript 5.5, Express 4, `tsx` 4.23 (already a devDependency — used as both the dev runner and the test runner), `node:test` (built in), `js-yaml`, `bcrypt`.

**Spec:** `docs/superpowers/specs/2026-08-13-local-dev-environment-design.md`

**Branch:** `local-dev-environment` (already created; the spec commit `730b50a` is on it)

## Global Constraints

- **No new dependencies.** Not for testing, not for anything. `tsx` and `node:test` cover it. Do not add `supertest`, `vitest`, `jest`, `cross-env`, or `ts-node`.
- **Cross-platform: macOS and Windows.** No shell globs in npm scripts, no `cp -r`/`rm -rf` in tooling, no POSIX-only path assumptions.
- **Production behavior must not change.** The real implementations are the current bodies verbatim. Control flow, ordering, validation, error handling, and every existing comment in `src/routes/sites.ts` stay exactly as they are.
- **Preserve the safety comments.** The doc comments in `src/lib/exec.ts` explaining the sudo boundary (why `createSiteDirectory` takes only a hostname, why `cloudflared-sites` and not `cloudflared`, why `writeManagedConfig` pipes over stdin) are the primary documentation of that boundary. They move with their functions; they are not rewritten or dropped.
- **Tests characterize; they do not fix.** These tests pin *current* behavior. If one surfaces a genuine bug, record it in the task's commit message and report it — do not change the implementation to suit a nicer assertion.
- **Every task ends green.** `npm test`, `npm run typecheck`, and `npm run lint` all pass before each commit.
- **Do not touch** `.env`, `.env.example`, `deploy/sudoers.example`, the `deploy/*.sh` wrapper scripts, or `deploy/lyly-admin.service`.

---

### Task 1: Test infrastructure and Caddyfile parser characterization

Sets up the test runner and the build/deploy exclusions that every later task depends on, proven by the first and largest characterization suite.

**Files:**
- Create: `tsconfig.build.json`
- Create: `src/lib/caddyfile.test.ts`
- Modify: `package.json:7-14` (scripts)
- Modify: `.github/workflows/deploy.yml:39-41` (rsync excludes)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `npm test` runs `tsx --test`; `npm run build` reads `tsconfig.build.json`, which excludes `src/dev` and `**/*.test.ts`

- [ ] **Step 1: Create the build tsconfig**

`tsconfig.json` stays exactly as it is, so WebStorm and `npm run typecheck` keep covering test files and (later) `src/dev`. Only the emit path narrows.

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/dev", "**/*.test.ts"]
}
```

`src/dev` does not exist yet — that is intentional. `tsc` ignores exclude entries that match nothing, and setting both exclusions once here means `.github/workflows/deploy.yml` and this file are each edited exactly once in the whole plan. Task 8 re-verifies the `src/dev` half once the directory exists.

- [ ] **Step 2: Update npm scripts**

In `package.json`, change the `build` script and add `test`. Leave `dev`, `build:css`, `start`, `typecheck`, and `lint` untouched:

```json
    "dev": "concurrently -n tsx,css \"tsx watch src/server.ts\" \"tailwindcss -i src/styles/tailwind.css -o public/style.css --watch\"",
    "build:css": "tailwindcss -i src/styles/tailwind.css -o public/style.css --minify",
    "build": "npm run build:css && tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "test": "tsx --test",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
```

`tsx --test` takes no path arguments deliberately. It auto-discovers `**/*.test.ts`, which avoids shell-glob differences between zsh and Windows `cmd`. It must be `tsx`, not bare `node --test`: Node's native TypeScript support resolves imports with ESM strictness and rejects the extensionless relative imports this codebase uses everywhere (`from "./config"`).

- [ ] **Step 3: Update the deploy rsync excludes**

In `.github/workflows/deploy.yml`, the `Sync app files` step currently reads:

```yaml
          rsync -rl --delete \
            --exclude='.git' --exclude='.env' --exclude='node_modules' \
            ./ /opt/lyly-admin/
```

Change it to:

```yaml
          rsync -rl --delete \
            --exclude='.git' --exclude='.env' --exclude='node_modules' \
            --exclude='src/dev' --exclude='*.test.ts' \
            ./ /opt/lyly-admin/
```

The workflow rsyncs the repository, not just `dist/`, so excluding these from the build output alone would still ship the TypeScript source to `lychee`. The existing `--delete` flag removes any previously synced copies on the next deploy.

- [ ] **Step 4: Write the Caddyfile characterization tests**

Create `src/lib/caddyfile.test.ts`. Note the literal tab characters inside the sample — `src/lib/caddyfile.ts` writes blocks with tabs (`renderStaticBlock`, `caddyfile.ts:83`), so the fixture uses `\t` to match what the app actually produces:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendSite, computeFilesPath, hostnameExists, parseSites, removeSite } from "./caddyfile";

const SAMPLE = `{
\tauto_https off
}

http://lyly.dev {
\troot * /var/www/lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}

http://app.lyly.dev {
\t# lyly-admin-framework: nextjs
\t# lyly-admin-healthcheck: /api/health
\treverse_proxy localhost:3000
}
`;

describe("parseSites", () => {
  test("skips the global options block and returns one entry per site", () => {
    const sites = parseSites(SAMPLE);
    assert.equal(sites.length, 3);
    assert.deepEqual(
      sites.map((s) => s.hostname),
      ["lyly.dev", "api.lyly.dev", "app.lyly.dev"],
    );
  });

  test("reads a static site's root path", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "lyly.dev");
    assert.deepEqual(site, { hostname: "lyly.dev", type: "static", target: "/var/www/lyly.dev" });
  });

  test("reads a plain reverse proxy's port and sets no framework", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "api.lyly.dev");
    assert.deepEqual(site, { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" });
  });

  test("reads the framework and healthcheck marker comments", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "app.lyly.dev");
    assert.deepEqual(site, {
      hostname: "app.lyly.dev",
      type: "reverse-proxy",
      target: "3000",
      framework: "nextjs",
      healthcheckPath: "/api/health",
    });
  });

  test("returns an empty array for content with no site blocks", () => {
    assert.deepEqual(parseSites("{\n\tauto_https off\n}\n"), []);
  });
});

describe("appendSite", () => {
  test("appends a static block with root and file_server", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lyly.dev",
      type: "static",
      target: "/var/www/new.lyly.dev",
    });
    assert.match(result, /http:\/\/new\.lyly\.dev \{\n\troot \* \/var\/www\/new\.lyly\.dev\n\tfile_server\n\}/);
    assert.equal(parseSites(result).length, 4);
  });

  test("appends a reverse-proxy block with no marker comments when no framework given", () => {
    const result = appendSite(SAMPLE, { hostname: "new.lyly.dev", type: "reverse-proxy", target: "5000" });
    assert.match(result, /http:\/\/new\.lyly\.dev \{\n\treverse_proxy localhost:5000\n\}/);
    assert.doesNotMatch(result, /new\.lyly\.dev[\s\S]*lyly-admin-framework/);
  });

  test("writes both marker comments when a framework is given", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lyly.dev",
      type: "reverse-proxy",
      target: "5000",
      framework: "nextjs",
      healthcheckPath: "/healthz",
    });
    assert.match(result, /\t# lyly-admin-framework: nextjs\n\t# lyly-admin-healthcheck: \/healthz\n/);
  });

  test("defaults the healthcheck comment to / when a framework has no path", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lyly.dev",
      type: "reverse-proxy",
      target: "5000",
      framework: "nextjs",
    });
    assert.match(result, /\t# lyly-admin-healthcheck: \/\n/);
  });

  test("ends with exactly one trailing newline", () => {
    const result = appendSite(SAMPLE, { hostname: "new.lyly.dev", type: "reverse-proxy", target: "5000" });
    assert.match(result, /\}\n$/);
    assert.doesNotMatch(result, /\n\n$/);
  });
});

describe("removeSite", () => {
  test("removes only the named block", () => {
    const result = removeSite(SAMPLE, "api.lyly.dev");
    assert.equal(hostnameExists(result, "api.lyly.dev"), false);
    assert.equal(hostnameExists(result, "lyly.dev"), true);
    assert.equal(hostnameExists(result, "app.lyly.dev"), true);
  });

  test("collapses the blank lines the removal leaves behind", () => {
    const result = removeSite(SAMPLE, "api.lyly.dev");
    assert.doesNotMatch(result, /\n{3,}/);
  });

  test("throws for a hostname with no block", () => {
    assert.throws(() => removeSite(SAMPLE, "absent.lyly.dev"), /No Caddyfile block found/);
  });
});

describe("hostnameExists", () => {
  test("is true for a present hostname and false for an absent one", () => {
    assert.equal(hostnameExists(SAMPLE, "app.lyly.dev"), true);
    assert.equal(hostnameExists(SAMPLE, "absent.lyly.dev"), false);
  });
});

describe("computeFilesPath", () => {
  test("returns sitesRoot/hostname for a static site", () => {
    const site = { hostname: "blog.lyly.dev", type: "static" as const, target: "/var/www/blog.lyly.dev" };
    assert.equal(computeFilesPath(site, "/var/www"), "/var/www/blog.lyly.dev");
  });

  test("returns sitesRoot/hostname for a scaffolded reverse proxy", () => {
    const site = {
      hostname: "app.lyly.dev",
      type: "reverse-proxy" as const,
      target: "3000",
      framework: "nextjs",
    };
    assert.equal(computeFilesPath(site, "/var/www"), "/var/www/app.lyly.dev");
  });

  test("returns null for a reverse proxy with no framework", () => {
    const site = { hostname: "api.lyly.dev", type: "reverse-proxy" as const, target: "4000" };
    assert.equal(computeFilesPath(site, "/var/www"), null);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 17 tests. These characterize code that already exists, so they pass on the first run — that is correct, not a mistake.

(Counts throughout this plan are the runner's leaf-test total — the `ℹ tests` line. `describe` blocks are reported separately as suites.)

- [ ] **Step 6: Prove the runner actually executes assertions**

Because the suite passed immediately, confirm it is genuinely wired up rather than silently discovering nothing. In `src/lib/caddyfile.test.ts`, temporarily change `assert.equal(sites.length, 3)` to `assert.equal(sites.length, 99)`.

Run: `npm test`
Expected: FAIL, 1 failing test, reporting `Expected values to be strictly equal: 3 !== 99`.

Then revert the change and re-run.

Run: `npm test`
Expected: PASS, 17 tests.

- [ ] **Step 7: Verify tests do not reach the build output**

Run: `npm run build`
Then run: `ls dist/lib/`

Expected: `caddyfile.js` is present and `caddyfile.test.js` is absent.

- [ ] **Step 8: Verify typecheck still covers the test file**

Run: `npm run typecheck`
Expected: PASS with no output. (This uses `tsconfig.json`, which has no exclusions, so a type error inside a `.test.ts` file would still fail CI even though it is never emitted.)

- [ ] **Step 9: Commit**

```bash
git add tsconfig.build.json package.json .github/workflows/deploy.yml src/lib/caddyfile.test.ts
git commit -m "Add test runner and characterize the Caddyfile parser"
```

---

### Task 2: Tunnel config characterization

**Files:**
- Create: `src/lib/tunnelConfig.test.ts`

**Interfaces:**
- Consumes: `npm test` from Task 1
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the tests**

Create `src/lib/tunnelConfig.test.ts`. The tests re-parse results with `js-yaml` (already a dependency) rather than string-matching, because ordering relative to the catch-all is the property that matters:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { addIngressRule, ingressExists, removeIngressRule } from "./tunnelConfig";

interface ParsedConfig {
  ingress: Array<{ hostname?: string; service: string }>;
}

const TUNNEL = `tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e
credentials-file: /etc/cloudflared/c7081f91-61c2-476b-8505-42d219bb6d7e.json
ingress:
  - hostname: lyly.dev
    service: http://localhost:80
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

const parse = (content: string) => yaml.load(content) as ParsedConfig;

describe("addIngressRule", () => {
  test("inserts immediately before the catch-all rule", () => {
    const result = parse(addIngressRule(TUNNEL, "new.lyly.dev", "http://localhost:80"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lyly.dev", "blog.lyly.dev", "new.lyly.dev", undefined],
    );
  });

  test("sets the supplied service on the new rule", () => {
    const result = parse(addIngressRule(TUNNEL, "new.lyly.dev", "http://localhost:80"));
    const added = result.ingress.find((rule) => rule.hostname === "new.lyly.dev");
    assert.equal(added?.service, "http://localhost:80");
  });

  test("preserves the tunnel id and credentials-file keys", () => {
    const result = yaml.load(addIngressRule(TUNNEL, "new.lyly.dev", "http://localhost:80")) as Record<string, unknown>;
    assert.equal(result.tunnel, "c7081f91-61c2-476b-8505-42d219bb6d7e");
    assert.equal(result["credentials-file"], "/etc/cloudflared/c7081f91-61c2-476b-8505-42d219bb6d7e.json");
  });

  test("appends at the end when there is no catch-all", () => {
    const noCatchAll = `ingress:
  - hostname: lyly.dev
    service: http://localhost:80
`;
    const result = parse(addIngressRule(noCatchAll, "new.lyly.dev", "http://localhost:80"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lyly.dev", "new.lyly.dev"],
    );
  });

  test("throws when the hostname already has a rule", () => {
    assert.throws(() => addIngressRule(TUNNEL, "blog.lyly.dev", "http://localhost:80"), /already exists/);
  });

  test("throws when the document has no ingress list", () => {
    assert.throws(() => addIngressRule("tunnel: abc-123\n", "new.lyly.dev", "http://localhost:80"), /missing an `ingress` list/);
  });
});

describe("removeIngressRule", () => {
  test("removes only the named rule and keeps the catch-all", () => {
    const result = parse(removeIngressRule(TUNNEL, "blog.lyly.dev"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lyly.dev", undefined],
    );
  });

  test("throws when no rule matches", () => {
    assert.throws(() => removeIngressRule(TUNNEL, "absent.lyly.dev"), /No ingress rule found/);
  });
});

describe("ingressExists", () => {
  test("is true for a present hostname and false for an absent one", () => {
    assert.equal(ingressExists(TUNNEL, "blog.lyly.dev"), true);
    assert.equal(ingressExists(TUNNEL, "absent.lyly.dev"), false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS, 26 tests total (17 from Task 1, 9 new).

- [ ] **Step 3: Commit**

```bash
git add src/lib/tunnelConfig.test.ts
git commit -m "Characterize tunnel ingress config editing"
```

---

### Task 3: Container status and framework scaffold characterization

**Files:**
- Create: `src/lib/containerStatus.test.ts`
- Create: `src/lib/frameworkScaffold.test.ts`

**Interfaces:**
- Consumes: `npm test` from Task 1
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the container status tests**

Create `src/lib/containerStatus.test.ts`. `parseComposePsOutput` handles both a JSON array and newline-delimited JSON because Compose versions differ; both shapes are covered:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseComposePsOutput } from "./containerStatus";

describe("parseComposePsOutput", () => {
  test("treats empty output as a container that was never created", () => {
    assert.deepEqual(parseComposePsOutput(""), { state: "not-created" });
    assert.deepEqual(parseComposePsOutput("   \n  "), { state: "not-created" });
  });

  test("reads state and health from a JSON array", () => {
    const raw = JSON.stringify([{ State: "running", Health: "healthy" }]);
    assert.deepEqual(parseComposePsOutput(raw), { state: "running", health: "healthy" });
  });

  test("reads state and health from a single JSON object", () => {
    const raw = JSON.stringify({ State: "running", Health: "starting" });
    assert.deepEqual(parseComposePsOutput(raw), { state: "running", health: "starting" });
  });

  test("reads the first entry of newline-delimited JSON", () => {
    const raw = `${JSON.stringify({ State: "restarting", Health: "unhealthy" })}\n${JSON.stringify({ State: "exited" })}`;
    assert.deepEqual(parseComposePsOutput(raw), { state: "restarting", health: "unhealthy" });
  });

  test("maps created to not-created and dead to exited", () => {
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "created" }])), {
      state: "not-created",
      health: undefined,
    });
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "dead" }])), {
      state: "exited",
      health: undefined,
    });
  });

  test("is case-insensitive about state and health", () => {
    const raw = JSON.stringify([{ State: "RUNNING", Health: "HEALTHY" }]);
    assert.deepEqual(parseComposePsOutput(raw), { state: "running", health: "healthy" });
  });

  test("returns unknown for an unrecognized state", () => {
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "confused" }])), {
      state: "unknown",
      health: undefined,
    });
  });

  test("returns unknown for unparseable output", () => {
    assert.deepEqual(parseComposePsOutput("not json at all"), { state: "unknown" });
  });

  test("treats an empty JSON array as not-created", () => {
    assert.deepEqual(parseComposePsOutput("[]"), { state: "not-created" });
  });

  test("omits health when Docker reports none", () => {
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "running" }])), {
      state: "running",
      health: undefined,
    });
  });
});
```

- [ ] **Step 2: Write the framework scaffold tests**

Create `src/lib/frameworkScaffold.test.ts`. The localhost-only port binding is a documented safety property of the generated compose file, so it gets an explicit assertion:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getFrameworkScaffold } from "./frameworkScaffold";

describe("getFrameworkScaffold", () => {
  test("returns null for an unknown framework", () => {
    assert.equal(getFrameworkScaffold("sveltekit", "3000", "app.lyly.dev", "/var/www", "/"), null);
    assert.equal(getFrameworkScaffold("", "3000", "app.lyly.dev", "/var/www", "/"), null);
  });

  test("binds the container to localhost only, never all interfaces", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.compose, /- "127\.0\.0\.1:3000:3000"/);
    assert.doesNotMatch(scaffold!.compose, /- "0\.0\.0\.0:/);
  });

  test("bakes the supplied healthcheck path into the Dockerfile", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/api/health");
    assert.match(scaffold!.dockerfile, /HEALTHCHECK .*http:\/\/localhost:3000\/api\/health/);
  });

  test("uses exec-form CMD rather than a shell string", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.dockerfile, /CMD \["npm","start"\]/);
  });

  test("points the deploy workflow at sitesRoot/hostname", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.deployWorkflow, /\/var\/www\/app\.lyly\.dev\//);
    assert.match(scaffold!.deployWorkflow, /name: Deploy app\.lyly\.dev/);
  });

  test("keeps the generated container files out of the deploy rsync", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    for (const excluded of ["Dockerfile", "docker-compose.yml", ".dockerignore"]) {
      assert.match(scaffold!.deployWorkflow, new RegExp(`--exclude='${excluded.replace(".", "\\.")}'`));
    }
  });

  test("reports the build and run commands it generated for", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.equal(scaffold!.buildCommand, "npm run build");
    assert.equal(scaffold!.runCommand, "npm start");
    assert.match(scaffold!.dockerfile, /RUN npm run build/);
  });

  test("ignores node_modules and .next in the dockerignore", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.dockerignore, /^node_modules$/m);
    assert.match(scaffold!.dockerignore, /^\.next$/m);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS, 44 tests total (26 from Tasks 1-2, 18 new).

- [ ] **Step 4: Commit**

```bash
git add src/lib/containerStatus.test.ts src/lib/frameworkScaffold.test.ts
git commit -m "Characterize container status parsing and framework scaffolding"
```

---

### Task 4: Route characterization tests against the current implementation

This is the safety net for the whole refactor. It must be written and green **before** any production file is restructured.

**Files:**
- Create: `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `npm test` from Task 1
- Produces: a route suite that Task 7 re-points at `createApp(deps)` and Task 8 re-points at `createFakes()`. The helper names `startServer`, `request`, and `writeFixtures` are relied on by both.

- [ ] **Step 1: Understand the two constraints this file works around**

Read these before writing, because both drive the file's odd shape:

1. `src/config.ts:15-16` calls `required()` at **module evaluation time**, and `import` declarations are hoisted above statements. A test file therefore cannot assign `process.env` and then statically import the route module. It must assign first, then `await import(...)`.
2. `src/config.ts:1` runs `import "dotenv/config"`, which loads the repository's real `.env`. `dotenv` does not overwrite variables already present in `process.env`, so values assigned before the dynamic import win. This is what makes the temp-directory redirection work at all.

Node's test runner isolates each test file in its own process, so the `config` singleton is fresh per file and these assignments do not leak.

- [ ] **Step 2: Write the route tests**

Create `src/routes/sites.test.ts`:

```ts
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";

// --- Fixture layout -------------------------------------------------------
// Every path config reads is redirected into one temp directory. This must
// happen before the app modules are imported, because src/config.ts reads
// process.env when it is evaluated (see Step 1).

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lyly-admin-test-"));
const CADDYFILE = path.join(TEMP_ROOT, "Caddyfile");
const TUNNEL_CONFIG = path.join(TEMP_ROOT, "sites-config.yml");
const SITES_ROOT = path.join(TEMP_ROOT, "www");
const PASSWORD = "test-password";

process.env.MOCK_SYSTEM = "true";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lyly.dev";
process.env.PORT = "8787";
process.env.CADDYFILE_PATH = CADDYFILE;
process.env.TUNNEL_CONFIG_PATH = TUNNEL_CONFIG;
process.env.SITES_ROOT = SITES_ROOT;
process.env.BACKUP_DIR = path.join(TEMP_ROOT, "backups");
process.env.LOG_FILE = path.join(TEMP_ROOT, "actions.log");

const SEED_CADDYFILE = `{
\tauto_https off
}

http://blog.lyly.dev {
\troot * ${SITES_ROOT}/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}

http://lychee.local {
\troot * /var/www/lychee.local
\tfile_server
}
`;

const SEED_TUNNEL = `tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e
ingress:
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - hostname: api.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

function writeFixtures(caddyfile = SEED_CADDYFILE, tunnel = SEED_TUNNEL): void {
  fs.rmSync(SITES_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SITES_ROOT, { recursive: true });
  fs.writeFileSync(CADDYFILE, caddyfile);
  fs.writeFileSync(TUNNEL_CONFIG, tunnel);
}

// --- Server harness -------------------------------------------------------

let server: Server;
let baseUrl: string;

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Authorization: AUTH, ...(init.headers ?? {}) },
  });
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

before(async () => {
  writeFixtures();

  // Dynamic imports: config must not be evaluated until the assignments
  // above have run. Task 7 replaces this block with createApp(deps).
  const express = (await import("express")).default;
  const { basicAuth } = await import("../middleware/auth");
  const { sitesRouter } = await import("./sites");

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(basicAuth);
  app.use(sitesRouter);

  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  writeFixtures();
});

// --- Tests ----------------------------------------------------------------

describe("authentication", () => {
  test("rejects an unauthenticated request", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 401);
  });
});

describe("GET /", () => {
  test("lists managed sites", async () => {
    const body = await (await request("/")).text();
    assert.match(body, /blog\.lyly\.dev/);
    assert.match(body, /api\.lyly\.dev/);
  });

  test("omits hostnames outside the managed domain", async () => {
    const body = await (await request("/")).text();
    assert.doesNotMatch(body, /lychee\.local/);
  });
});

describe("POST /sites — static", () => {
  test("adds a Caddyfile block, an ingress rule, a directory, and a placeholder page", async () => {
    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      added: true,
      hostname: "new.lyly.dev",
      type: "static",
      target: `${SITES_ROOT}/new.lyly.dev`,
      framework: "none",
      tunnelId: "c7081f91-61c2-476b-8505-42d219bb6d7e",
    });

    assert.match(fs.readFileSync(CADDYFILE, "utf8"), /http:\/\/new\.lyly\.dev \{/);
    assert.match(fs.readFileSync(TUNNEL_CONFIG, "utf8"), /hostname: new\.lyly\.dev/);
    assert.match(
      fs.readFileSync(path.join(SITES_ROOT, "new.lyly.dev", "index.html"), "utf8"),
      /Site created by lyly-admin/,
    );
  });

  test("rejects a hostname outside the managed domain", async () => {
    const response = await request("/sites", form({ hostname: "evil.example.com", type: "static" }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /must be a subdomain of lyly\.dev/);
  });

  test("rejects a hostname that already exists", async () => {
    const response = await request("/sites", form({ hostname: "blog.lyly.dev", type: "static" }));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /already exists in the Caddyfile/);
  });
});

describe("POST /sites — reverse proxy", () => {
  test("writes the Next.js scaffold and both marker comments", async () => {
    const response = await request(
      "/sites",
      form({ hostname: "app.lyly.dev", type: "reverse-proxy", port: "3000", framework: "nextjs", healthcheckPath: "/api/health" }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).framework, "nextjs");

    const caddyfile = fs.readFileSync(CADDYFILE, "utf8");
    assert.match(caddyfile, /# lyly-admin-framework: nextjs/);
    assert.match(caddyfile, /# lyly-admin-healthcheck: \/api\/health/);

    const siteDir = path.join(SITES_ROOT, "app.lyly.dev");
    assert.match(fs.readFileSync(path.join(siteDir, "Dockerfile"), "utf8"), /HEALTHCHECK .*\/api\/health/);
    assert.match(fs.readFileSync(path.join(siteDir, "docker-compose.yml"), "utf8"), /127\.0\.0\.1:3000:3000/);
    assert.ok(fs.existsSync(path.join(siteDir, ".dockerignore")));
  });

  test("creates no directory for a reverse proxy with no framework", async () => {
    const response = await request("/sites", form({ hostname: "plain.lyly.dev", type: "reverse-proxy", port: "5000" }));
    assert.equal(response.status, 200);
    assert.equal(fs.existsSync(path.join(SITES_ROOT, "plain.lyly.dev")), false);
  });

  test("rejects a port already used by another reverse-proxy site", async () => {
    const response = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy", port: "4000" }));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /already used by api\.lyly\.dev/);
  });

  test("rejects a reserved port", async () => {
    const response = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy", port: "2019" }));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /reserved/);
  });

  test("rejects a missing or out-of-range port", async () => {
    const missing = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy" }));
    assert.equal(missing.status, 400);
    const tooBig = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy", port: "70000" }));
    assert.equal(tooBig.status, 400);
  });

  test("rejects a malformed healthcheck path", async () => {
    const response = await request(
      "/sites",
      form({ hostname: "app.lyly.dev", type: "reverse-proxy", port: "3000", framework: "nextjs", healthcheckPath: "no-leading-slash" }),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /is not a valid healthcheck path/);
  });
});

describe("POST /sites/:hostname/delete", () => {
  test("removes the Caddyfile block and the ingress rule", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { removed: true, needsFileConfirm: false });

    assert.doesNotMatch(fs.readFileSync(CADDYFILE, "utf8"), /http:\/\/blog\.lyly\.dev \{/);
    assert.doesNotMatch(fs.readFileSync(TUNNEL_CONFIG, "utf8"), /hostname: blog\.lyly\.dev/);
  });

  test("reports the path to confirm when file deletion was requested", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));
    assert.deepEqual(await response.json(), {
      removed: true,
      needsFileConfirm: true,
      sitePath: `${SITES_ROOT}/blog.lyly.dev`,
    });
  });

  test("does not delete files as part of the same request", async () => {
    fs.mkdirSync(path.join(SITES_ROOT, "blog.lyly.dev"), { recursive: true });
    fs.writeFileSync(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));

    assert.equal(fs.existsSync(path.join(SITES_ROOT, "blog.lyly.dev", "index.html")), true);
  });
});

describe("POST /sites/:hostname/delete-files", () => {
  test("removes the site directory", async () => {
    fs.mkdirSync(path.join(SITES_ROOT, "blog.lyly.dev"), { recursive: true });
    fs.writeFileSync(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    const response = await request("/sites/blog.lyly.dev/delete-files", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.equal(fs.existsSync(path.join(SITES_ROOT, "blog.lyly.dev")), false);
  });

  test("refuses a hostname outside the managed domain", async () => {
    const response = await request("/sites/evil.example.com/delete-files", form({}));
    assert.equal(response.status, 400);
  });
});

describe("rollback", () => {
  test("restores the Caddyfile when the tunnel edit fails during add", async () => {
    // A tunnel config with no `ingress` key makes addIngressRule throw at
    // step 4 — after the Caddyfile has been written, before caddy validate.
    writeFixtures(SEED_CADDYFILE, "tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e\n");
    const before = fs.readFileSync(CADDYFILE, "utf8");

    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));

    assert.equal(response.status, 500);
    assert.equal(fs.readFileSync(CADDYFILE, "utf8"), before);
  });

  test("restores the Caddyfile when the tunnel edit fails during remove", async () => {
    // lychee.local has a Caddyfile block but deliberately no ingress rule,
    // so removeIngressRule throws after the Caddyfile has been rewritten.
    const before = fs.readFileSync(CADDYFILE, "utf8");

    const response = await request("/sites/lychee.local/delete", form({}));

    assert.equal(response.status, 500);
    assert.equal(fs.readFileSync(CADDYFILE, "utf8"), before);
  });
});

describe("audit log", () => {
  test("records a line for a successful add", async () => {
    await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
    const log = fs.readFileSync(path.join(TEMP_ROOT, "actions.log"), "utf8");
    const entry = JSON.parse(log.trim().split("\n").at(-1)!);
    assert.equal(entry.action, "add-site");
    assert.equal(entry.hostname, "new.lyly.dev");
    assert.ok(entry.timestamp);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS, 64 tests total (44 from Tasks 1-3, 20 new).

If any route test fails here, **stop**. A failure at this point means the test misdescribes current behavior, and the whole point of this task is to capture behavior accurately before changing it. Fix the test, not the implementation.

- [ ] **Step 4: Verify typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sites.test.ts
git commit -m "Characterize the add, remove, and rollback route flows"
```

---

### Task 5: Extract the FileSystem interface and convert backup/logger to factories

First production change. Behavior is identical; the tests from Task 4 are the proof.

**Files:**
- Create: `src/lib/fileSystem.ts`
- Modify: `src/lib/backup.ts` (whole file)
- Modify: `src/lib/logger.ts` (whole file)
- Modify: `src/routes/sites.ts:5`, `:18` (imports) and every `backupFile`/`logAction` call site

**Interfaces:**
- Consumes: the Task 4 route suite (must stay green)
- Produces:
  - `interface FileSystem` with `readFile(path): string`, `writeFile(path, content): void`, `mkdir(path): void`, `appendFile(path, content): void`, `copyFile(source, destination): void`, `rmRecursive(path): void`
  - `const realFileSystem: FileSystem`
  - `createBackup(fs: FileSystem): { backupFile(filePath: string): string }`
  - `createLogger(fs: FileSystem): { logAction(entry: AuditEntry): void }`
  - `AuditEntry` still exported from `src/lib/logger.ts`, unchanged

- [ ] **Step 1: Create the FileSystem module**

Create `src/lib/fileSystem.ts`:

```ts
import fs from "node:fs";

/**
 * The filesystem operations lyly-admin performs, narrowed to exactly what
 * the app uses. Injected rather than imported directly so the dev entry
 * point can substitute an in-memory implementation — see src/dev/fakes.ts.
 *
 * Every method is synchronous, matching the call sites it replaces:
 * logAction() and backupFile() are called from synchronous positions inside
 * async route handlers, and making these async would change error timing in
 * the add/remove rollback paths.
 *
 * mkdir is always recursive and rmRecursive always forces, because that is
 * what every existing call site passes. The options are not parameterized.
 */
export interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
  appendFile(path: string, content: string): void;
  copyFile(source: string, destination: string): void;
  rmRecursive(path: string): void;
}

export const realFileSystem: FileSystem = {
  readFile: (p) => fs.readFileSync(p, "utf8"),
  writeFile: (p, content) => {
    fs.writeFileSync(p, content);
  },
  mkdir: (p) => {
    fs.mkdirSync(p, { recursive: true });
  },
  appendFile: (p, content) => {
    fs.appendFileSync(p, content);
  },
  copyFile: (source, destination) => {
    fs.copyFileSync(source, destination);
  },
  rmRecursive: (p) => {
    fs.rmSync(p, { recursive: true, force: true });
  },
};
```

- [ ] **Step 2: Convert backup.ts to a factory**

Replace the whole of `src/lib/backup.ts`:

```ts
import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "./fileSystem";

/**
 * Copies filePath into config.backupDir with a timestamp suffix before any
 * mutating edit. Must be called before every Caddyfile / tunnel config write.
 */
export function createBackup(fs: FileSystem) {
  return {
    backupFile(filePath: string): string {
      fs.mkdir(config.backupDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(config.backupDir, `${path.basename(filePath)}.bak.${timestamp}`);
      fs.copyFile(filePath, backupPath);
      return backupPath;
    },
  };
}
```

- [ ] **Step 3: Convert logger.ts to a factory**

Replace the whole of `src/lib/logger.ts`. `AuditEntry` and its union of action names are unchanged:

```ts
import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "./fileSystem";

export interface AuditEntry {
  action:
    | "add-site"
    | "remove-site"
    | "add-site-failed"
    | "add-site-rolled-back"
    | "add-site-rollback-failed"
    | "remove-site-failed"
    | "remove-site-rolled-back"
    | "remove-site-rollback-failed"
    | "delete-site-files"
    | "delete-site-files-failed";
  hostname: string;
  detail?: string;
}

export function createLogger(fs: FileSystem) {
  return {
    logAction(entry: AuditEntry): void {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
      fs.mkdir(path.dirname(config.logFile));
      fs.appendFile(config.logFile, line + "\n");
    },
  };
}
```

- [ ] **Step 4: Update the route module's imports and call sites**

In `src/routes/sites.ts`, replace these two import lines:

```ts
import { backupFile } from "../lib/backup";
import { logAction } from "../lib/logger";
```

with:

```ts
import { createBackup } from "../lib/backup";
import { createLogger } from "../lib/logger";
import { realFileSystem } from "../lib/fileSystem";

const { backupFile } = createBackup(realFileSystem);
const { logAction } = createLogger(realFileSystem);
```

Place the two `const` lines immediately after the import block, above `export const sitesRouter = Router();`. Every existing `backupFile(...)` and `logAction(...)` call then keeps working untouched — this is deliberately a temporary module-level wiring that Task 7 replaces with injection.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 64 tests. Any failure means behavior changed — investigate before proceeding.

- [ ] **Step 6: Verify typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/fileSystem.ts src/lib/backup.ts src/lib/logger.ts src/routes/sites.ts
git commit -m "Extract a FileSystem interface and make backup/logger factories"
```

---

### Task 6: Extract the SystemCommands interface

**Files:**
- Create: `src/lib/systemCommands.ts`
- Delete: `src/lib/exec.ts`
- Modify: `src/routes/sites.ts:8-16` (imports)

**Interfaces:**
- Consumes: `FileSystem` from Task 5 (not used here, but `src/lib/fileSystem.ts` must exist)
- Produces:
  - `class CommandError extends Error` with `stdout` and `stderr` properties
  - `interface SystemCommands` with `validateCaddyfile(caddyfilePath: string): Promise<{stdout: string; stderr: string}>`, `reloadCaddy()`, `restartCloudflared()`, `createSiteDirectory(hostname: string)`, `writeManagedConfig(targetPath: string, content: string): Promise<void>`, `checkContainerStatus(hostname: string): Promise<ContainerStatus>`
  - `const realSystemCommands: SystemCommands`

- [ ] **Step 1: Create systemCommands.ts**

Create `src/lib/systemCommands.ts`. This is `src/lib/exec.ts` with three changes: `caddyStatus` is dropped, the methods are gathered into an object implementing an interface, and the `MOCK_SYSTEM` branches are kept **for now** (Task 8 removes them, once the fakes exist for the tests to switch to). Every doc comment is preserved verbatim:

```ts
import { execFile as execFileCb, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config";
import { parseComposePsOutput, type ContainerStatus } from "./containerStatus";

const execFile = promisify(execFileCb);

/**
 * Temporary: retained only until src/dev/ supplies fake implementations and
 * the route tests switch to them. Removed in the same change that adds
 * src/dev/fakes.ts — production mock behavior is then unreachable by
 * construction rather than guarded by an environment variable.
 */
const MOCK_SYSTEM = process.env.MOCK_SYSTEM === "true";

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/**
 * Runs a single privileged command via execFile (never a shell), so arguments
 * can't be reinterpreted by a shell. Every command here must have a matching
 * narrowly-scoped entry in the sudoers file — see deploy/sudoers.example.
 */
async function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFile(command, args);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    throw new CommandError(err.message, err.stdout ?? "", err.stderr ?? "");
  }
}

/**
 * The privileged operations lyly-admin performs on its host. Injected rather
 * than imported directly so the dev entry point can substitute fakes — see
 * src/dev/fakes.ts.
 */
export interface SystemCommands {
  validateCaddyfile(caddyfilePath: string): Promise<{ stdout: string; stderr: string }>;
  reloadCaddy(): Promise<{ stdout: string; stderr: string }>;
  restartCloudflared(): Promise<{ stdout: string; stderr: string }>;
  createSiteDirectory(hostname: string): Promise<{ stdout: string; stderr: string }>;
  writeManagedConfig(targetPath: string, content: string): Promise<void>;
  checkContainerStatus(hostname: string): Promise<ContainerStatus>;
}

export const realSystemCommands: SystemCommands = {
  validateCaddyfile(caddyfilePath) {
    if (MOCK_SYSTEM) {
      return Promise.resolve({ stdout: `[mock] validated ${caddyfilePath}`, stderr: "" });
    }
    return run("sudo", ["/usr/bin/caddy", "validate", "--config", caddyfilePath]);
  },

  reloadCaddy() {
    if (MOCK_SYSTEM) {
      return Promise.resolve({ stdout: "[mock] reloaded caddy", stderr: "" });
    }
    return run("sudo", ["/usr/bin/systemctl", "reload", "caddy"]);
  },

  /**
   * Restarts cloudflared-sites, not the box's original cloudflared.service —
   * lyly-admin only manages hostnames on the split-off "sites" tunnel
   * (see deploy/cloudflared-sites.service), so this never interrupts
   * ssh.lyly.dev, which stays on its own separate tunnel/service.
   */
  restartCloudflared() {
    if (MOCK_SYSTEM) {
      return Promise.resolve({ stdout: "[mock] restarted cloudflared-sites", stderr: "" });
    }
    return run("sudo", ["/usr/bin/systemctl", "restart", "cloudflared-sites"]);
  },

  /**
   * Creates /var/www/<hostname> owned web:webdeploy with the setgid bit so new
   * files inherit the group, via deploy/lyly-admin-create-site-dir.sh. That
   * script (not sudoers) validates the hostname and hardcodes the owner/group —
   * sudoers can't safely restrict install(1)'s arguments to "some path under
   * /var/www" without wildcards, which aren't supported on every sudo build.
   */
  createSiteDirectory(hostname) {
    if (MOCK_SYSTEM) {
      fs.mkdirSync(path.join(config.sitesRoot, hostname), { recursive: true });
      return Promise.resolve({ stdout: `[mock] created ${path.join(config.sitesRoot, hostname)}`, stderr: "" });
    }
    return run("sudo", ["/usr/local/sbin/lyly-admin-create-site-dir", hostname]);
  },

  /**
   * Writes `content` to a root-owned config file (the Caddyfile or the tunnel
   * config.yml) by piping it into deploy/lyly-admin-write-config.sh via sudo.
   * That script only accepts these two exact paths — see sudoers.example.
   * Needed because /etc/caddy and /etc/cloudflared are root:root 755, so the
   * dedicated low-privilege app user has no direct write access to either file.
   */
  writeManagedConfig(targetPath, content) {
    if (MOCK_SYSTEM) {
      fs.writeFileSync(targetPath, content);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const child = spawn("sudo", ["/usr/local/sbin/lyly-admin-write-config", targetPath]);

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (error) => reject(new CommandError(error.message, "", stderr)));

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new CommandError(`lyly-admin-write-config exited with code ${code}`, "", stderr));
        }
      });

      child.stdin.end(content);
    });
  },

  /**
   * Reads container lifecycle state + Docker health (if the image defines a
   * HEALTHCHECK) for a Next.js-scaffolded site via deploy/lyly-admin-docker-status.sh.
   * Unlike every other function in this file, failures are swallowed into
   * { state: "unknown" } rather than thrown — this is best-effort display
   * data for the detail page, not a mutating action a caller needs to detect
   * and roll back. No raw stderr reaches the page.
   */
  async checkContainerStatus(hostname) {
    if (MOCK_SYSTEM) {
      return { state: "running", health: "healthy" };
    }
    try {
      const { stdout } = await run("sudo", ["/usr/local/sbin/lyly-admin-docker-status", hostname]);
      return parseComposePsOutput(stdout);
    } catch {
      return { state: "unknown" };
    }
  },
};
```

- [ ] **Step 2: Delete the old module**

```bash
git rm src/lib/exec.ts
```

`caddyStatus` is deleted with it. It was exported from `exec.ts:71` and called from nowhere in `src/` or `public/`. Its sudoers entry in `deploy/sudoers.example` is deliberately left alone — narrowing production sudo scope is a host-config change with its own verification needs.

- [ ] **Step 3: Update the route module's imports**

In `src/routes/sites.ts`, replace this import block:

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
```

with:

```ts
import { CommandError, realSystemCommands } from "../lib/systemCommands";

const {
  checkContainerStatus,
  createSiteDirectory,
  reloadCaddy,
  restartCloudflared,
  validateCaddyfile,
  writeManagedConfig,
} = realSystemCommands;
```

Place the destructuring beside the `createBackup`/`createLogger` lines added in Task 5. All existing call sites keep working unchanged. Like Task 5's wiring, this is temporary and Task 7 replaces it.

Note: destructuring is safe here because none of these methods use `this`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, 64 tests.

- [ ] **Step 5: Verify typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 6: Verify no dangling references to the deleted module**

Run: `grep -rn "lib/exec\|caddyStatus" src/ .github/ deploy/`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Extract a SystemCommands interface and drop the dead caddyStatus"
```

---

### Task 7: Introduce Deps, createApp, and the router factory

**Files:**
- Create: `src/app.ts`
- Modify: `src/routes/sites.ts` (export shape and every injected call site)
- Modify: `src/server.ts` (whole file)
- Modify: `src/routes/sites.test.ts` (the `before` hook only)

**Interfaces:**
- Consumes: `SystemCommands` and `realSystemCommands` (Task 6); `FileSystem`, `realFileSystem`, `createBackup`, `createLogger` (Task 5)
- Produces:
  - `interface Deps { commands: SystemCommands; fs: FileSystem; backup: ReturnType<typeof createBackup>; logger: ReturnType<typeof createLogger> }` exported from `src/app.ts`
  - `createApp(deps: Deps): express.Express` exported from `src/app.ts`
  - `createSitesRouter(deps: Deps): Router` exported from `src/routes/sites.ts`, replacing the `sitesRouter` const

- [ ] **Step 1: Create src/app.ts**

Create `src/app.ts`:

```ts
import express from "express";
import path from "node:path";
import { basicAuth } from "./middleware/auth";
import { createSitesRouter } from "./routes/sites";
import type { FileSystem } from "./lib/fileSystem";
import type { SystemCommands } from "./lib/systemCommands";
import type { createBackup } from "./lib/backup";
import type { createLogger } from "./lib/logger";

/**
 * Everything the routes reach the outside world through. Assembled by
 * src/server.ts with real implementations, and by src/dev/server.ts with
 * in-memory fakes.
 */
export interface Deps {
  commands: SystemCommands;
  fs: FileSystem;
  backup: ReturnType<typeof createBackup>;
  logger: ReturnType<typeof createLogger>;
}

export function createApp(deps: Deps): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(createSitesRouter(deps));

  return app;
}
```

The `path.join(__dirname, "..", "public")` expression is copied unchanged from `src/server.ts:11`. It still resolves correctly: `src/app.ts` sits at the same depth as `src/server.ts`, so it is `dist/app.js` → `dist/../public` in production and `src/app.ts` → `src/../public` under `tsx`.

- [ ] **Step 2: Convert the route module to a factory**

In `src/routes/sites.ts`:

1. Delete the temporary wiring added in Tasks 5 and 6 — the `createBackup`/`createLogger`/`realSystemCommands` destructuring consts and the `realFileSystem` import.
2. Keep importing `CommandError` as a value (it is used in `instanceof` checks): `import { CommandError } from "../lib/systemCommands";`
3. Add `import type { Deps } from "../app";`
4. Replace `export const sitesRouter = Router();` with a factory that wraps every route registration:

```ts
export function createSitesRouter(deps: Deps): Router {
  const sitesRouter = Router();
  const { backupFile } = deps.backup;
  const { logAction } = deps.logger;

  // ... all existing sitesRouter.get(...) / sitesRouter.post(...) blocks,
  // unchanged except for the substitutions in step 3 below ...

  return sitesRouter;
}
```

Everything between `const sitesRouter = Router();` and the end of the file moves inside this function body. The module-level constants above it — `CADDY_ADMIN_PORT`, `hostnamePattern`, `HEALTHCHECK_PATH_PATTERN`, `escapeRegex`, `isValidHostname`, `isManagedHostname`, `PLACEHOLDER_INDEX_HTML` — stay at module level, outside the factory.

- [ ] **Step 3: Substitute the injected calls**

Inside the factory body, apply exactly these replacements and no others. Do not reorder statements, change error handling, or alter comments.

Filesystem reads — six sites (`sites.ts:52`, `:72`, `:143`, `:162`, `:256`, `:264`):

```ts
// before
const content = fs.readFileSync(config.caddyfilePath, "utf8");
// after
const content = deps.fs.readFile(config.caddyfilePath);
```

Filesystem writes — four sites (`sites.ts:181`, `:186`, `:187`, `:188`):

```ts
// before
fs.writeFileSync(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
// after
deps.fs.writeFile(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
```

Recursive delete — one site (`sites.ts:324`):

```ts
// before
fs.rmSync(sitePath, { recursive: true, force: true });
// after
deps.fs.rmRecursive(sitePath);
```

Privileged commands — every call becomes a `deps.commands.` member:

```ts
// before
await validateCaddyfile(config.caddyfilePath);
await reloadCaddy();
await restartCloudflared();
await createSiteDirectory(hostname);
await writeManagedConfig(config.caddyfilePath, ...);
await checkContainerStatus(hostname);
// after
await deps.commands.validateCaddyfile(config.caddyfilePath);
await deps.commands.reloadCaddy();
await deps.commands.restartCloudflared();
await deps.commands.createSiteDirectory(hostname);
await deps.commands.writeManagedConfig(config.caddyfilePath, ...);
await deps.commands.checkContainerStatus(hostname);
```

Finally, remove `import fs from "node:fs";` from the top of the file. `import path from "node:path";` stays — `path.posix.join` and `path.join` are still used for path construction.

**Leave `checkPortOpen` alone.** The call at `src/routes/sites.ts:92` keeps importing directly from `../lib/portStatus`. It opens a TCP socket, which is neither a privileged command nor a filesystem operation, so it falls outside both interfaces by design. The consequence — the seeded plain reverse-proxy site showing as not responding in dev mode, because nothing is actually listening on port 4000 — is a documented and accepted limitation of the spec, not an oversight to fix here.

- [ ] **Step 4: Rewrite the production entry point**

Replace the whole of `src/server.ts`:

```ts
import { config } from "./config";
import { createApp, type Deps } from "./app";
import { createBackup } from "./lib/backup";
import { createLogger } from "./lib/logger";
import { realFileSystem } from "./lib/fileSystem";
import { realSystemCommands } from "./lib/systemCommands";

const deps: Deps = {
  commands: realSystemCommands,
  fs: realFileSystem,
  backup: createBackup(realFileSystem),
  logger: createLogger(realFileSystem),
};

createApp(deps).listen(config.port, config.host, () => {
  console.log(`lyly-admin listening on http://${config.host}:${config.port}`);
});
```

- [ ] **Step 5: Point the route tests at createApp**

In `src/routes/sites.test.ts`, replace the app-construction block inside `before(...)` — from `const express = (await import("express")).default;` down to `app.use(sitesRouter);` — with:

```ts
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { realFileSystem } = await import("../lib/fileSystem");
  const { realSystemCommands } = await import("../lib/systemCommands");

  const app = createApp({
    commands: realSystemCommands,
    fs: realFileSystem,
    backup: createBackup(realFileSystem),
    logger: createLogger(realFileSystem),
  });
```

The dynamic imports and the `process.env` assignments at the top of the file are still required — `MOCK_SYSTEM` and the temp paths both still matter until Task 8. Everything below (`server = app.listen(0)` onward) is unchanged, and no test body changes.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, 64 tests. Same count, same names as Task 4 — that equality is the evidence the refactor preserved behavior.

- [ ] **Step 7: Verify typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 8: Verify the production entry still starts**

Run: `node -e "require('./dist/server.js')" & sleep 2; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/; kill %1`
Expected: `401` — the same signal CI's health check uses (`deploy.yml:58-68`). It proves Express bound its port and basic auth ran.

If port 8787 is already in use on your machine, set `PORT=8788` and adjust the curl URL to match.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Inject dependencies through createApp and createSitesRouter"
```

---

### Task 8: Add the dev entry point with in-memory fakes and remove MOCK_SYSTEM

**Files:**
- Create: `src/dev/env.ts`
- Create: `src/dev/fakes.ts`
- Create: `src/dev/seed.ts`
- Create: `src/dev/server.ts`
- Modify: `src/lib/systemCommands.ts` (remove the flag and every mock branch)
- Modify: `src/routes/sites.test.ts` (swap fixtures for fakes)
- Modify: `package.json` (add `dev:mock`)

**Interfaces:**
- Consumes: `Deps` and `createApp` (Task 7); `FileSystem` and `SystemCommands` (Tasks 5-6)
- Produces:
  - `createInMemoryFileSystem(): FileSystem & { files: Map<string, string>; dirs: Set<string> }`
  - `createFakes(): { fs: ReturnType<typeof createInMemoryFileSystem>; commands: SystemCommands }`
  - `applySeed(fs: FileSystem): void`
  - `npm run dev:mock`

- [ ] **Step 1: Create the in-memory fakes**

Create `src/dev/fakes.ts`. Note `normalizePath` — this is the one piece of the fake that is not a straight translation, and the spec calls it out specifically: `src/routes/sites.ts:133` builds paths with `path.posix.join` while `:181` joins the filename with native `path.join`. Against a real filesystem those are equivalent; against a `Map` they are two different keys, so on Windows the same site would silently exist twice.

```ts
import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "../lib/fileSystem";
import type { SystemCommands } from "../lib/systemCommands";

/**
 * Collapses both separators to "/" so that a path built with path.posix.join
 * and the same path built with native path.join land on one map key. On a
 * real filesystem the difference is cosmetic; against a Map it would create
 * a silent duplicate on Windows.
 */
function normalizePath(target: string): string {
  const collapsed = target.split(/[\\/]+/).join("/");
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
}

export function createInMemoryFileSystem() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  function readFile(target: string): string {
    const key = normalizePath(target);
    const content = files.get(key);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${key}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  function writeFile(target: string, content: string): void {
    files.set(normalizePath(target), content);
  }

  function mkdir(target: string): void {
    dirs.add(normalizePath(target));
  }

  function appendFile(target: string, content: string): void {
    const key = normalizePath(target);
    files.set(key, (files.get(key) ?? "") + content);
  }

  function copyFile(source: string, destination: string): void {
    files.set(normalizePath(destination), readFile(source));
  }

  function rmRecursive(target: string): void {
    const key = normalizePath(target);
    const prefix = `${key}/`;
    for (const existing of [...files.keys()]) {
      if (existing === key || existing.startsWith(prefix)) files.delete(existing);
    }
    for (const existing of [...dirs]) {
      if (existing === key || existing.startsWith(prefix)) dirs.delete(existing);
    }
  }

  return { files, dirs, readFile, writeFile, mkdir, appendFile, copyFile, rmRecursive };
}

/**
 * Fakes for both outward-facing interfaces, sharing one store — the fake
 * createSiteDirectory must create its directory in the same filesystem the
 * routes then write scaffold files into.
 */
export function createFakes(): {
  fs: ReturnType<typeof createInMemoryFileSystem>;
  commands: SystemCommands;
} {
  const fs = createInMemoryFileSystem();

  const commands: SystemCommands = {
    validateCaddyfile: (caddyfilePath) =>
      Promise.resolve({ stdout: `[mock] validated ${caddyfilePath}`, stderr: "" }),

    reloadCaddy: () => Promise.resolve({ stdout: "[mock] reloaded caddy", stderr: "" }),

    restartCloudflared: () => Promise.resolve({ stdout: "[mock] restarted cloudflared-sites", stderr: "" }),

    createSiteDirectory: (hostname) => {
      const directory = path.posix.join(config.sitesRoot, hostname);
      fs.mkdir(directory);
      return Promise.resolve({ stdout: `[mock] created ${directory}`, stderr: "" });
    },

    writeManagedConfig: (targetPath, content) => {
      fs.writeFile(targetPath, content);
      return Promise.resolve();
    },

    checkContainerStatus: () => Promise.resolve({ state: "running", health: "healthy" }),
  };

  return { fs, commands };
}
```

- [ ] **Step 2: Create the seed**

Create `src/dev/seed.ts`. The five blocks exist to cover every branch `parseSites` has, and `lychee.local` is there specifically so the `isManagedHostname` filter at `src/routes/sites.ts:53` is exercised on every page load rather than assumed:

```ts
import { config } from "../config";
import type { FileSystem } from "../lib/fileSystem";

/**
 * Covers every branch parseSites has: the apex domain, a static subdomain, a
 * plain reverse proxy, a Next.js site carrying both marker comments, and one
 * deliberately unmanaged block. lychee.local must never appear in the site
 * list — it is the live check that isManagedHostname still filters.
 *
 * Ports 4000 and 3000 leave 8787 (lyly-admin itself) and 2019 (Caddy's admin
 * API) free, so the reserved-port rejection can be triggered from the UI.
 */
export const SEED_CADDYFILE = `{
\tauto_https off
}

http://lyly.dev {
\troot * /var/www/lyly.dev
\tfile_server
}

http://blog.lyly.dev {
\troot * /var/www/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}

http://app.lyly.dev {
\t# lyly-admin-framework: nextjs
\t# lyly-admin-healthcheck: /api/health
\treverse_proxy localhost:3000
}

http://lychee.local {
\troot * /var/www/lychee.local
\tfile_server
}
`;

/** lychee.local deliberately has no ingress rule — it is not tunnel-managed. */
export const SEED_TUNNEL_CONFIG = `tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e
credentials-file: /etc/cloudflared/c7081f91-61c2-476b-8505-42d219bb6d7e.json
ingress:
  - hostname: lyly.dev
    service: http://localhost:80
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - hostname: api.lyly.dev
    service: http://localhost:80
  - hostname: app.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

export function applySeed(fs: FileSystem): void {
  fs.writeFile(config.caddyfilePath, SEED_CADDYFILE);
  fs.writeFile(config.tunnelConfigPath, SEED_TUNNEL_CONFIG);
}
```

- [ ] **Step 3: Create the dev environment module**

Create `src/dev/env.ts`. The hash below is a real bcrypt hash of the password `dev`, generated at cost 12:

```ts
/**
 * Local development credentials, committed deliberately.
 *
 * This is a known throwaway password ("dev") for an app that binds
 * 127.0.0.1, and this whole directory ships to neither dist/ nor lychee —
 * see tsconfig.build.json and the rsync excludes in
 * .github/workflows/deploy.yml. Production reads its own .env through
 * src/server.ts, which never imports this file.
 *
 * This module exists separately from src/dev/server.ts because src/config.ts
 * calls required() at module evaluation time and import declarations are
 * hoisted — so the assignments have to live in a module that is imported
 * before config, not in a statement alongside the import.
 */
process.env.ADMIN_USERNAME ??= "dev";
process.env.ADMIN_PASSWORD_HASH ??= "$2b$12$X/UB7NklDWv8CQTaRZpFzOWt9lYBcJYK1UwtOG9EgG6wwegHeFmAS";
```

- [ ] **Step 4: Create the dev entry point**

Create `src/dev/server.ts`. The `import "./env"` **must** be the first import — modules evaluate in declaration order, and `../config` reads `process.env` when it evaluates:

```ts
import "./env";
import { config } from "../config";
import { createApp, type Deps } from "../app";
import { createBackup } from "../lib/backup";
import { createLogger } from "../lib/logger";
import { createFakes } from "./fakes";
import { applySeed } from "./seed";

const { fs, commands } = createFakes();
applySeed(fs);

const deps: Deps = {
  commands,
  fs,
  backup: createBackup(fs),
  logger: createLogger(fs),
};

createApp(deps).listen(config.port, config.host, () => {
  console.log(`lyly-admin (dev — in-memory, no host changes) on http://${config.host}:${config.port}`);
  console.log("Sign in with dev / dev. State resets on every restart.");
});
```

- [ ] **Step 5: Add the dev:mock script**

In `package.json`, add `dev:mock` directly after `dev`:

```json
    "dev": "concurrently -n tsx,css \"tsx watch src/server.ts\" \"tailwindcss -i src/styles/tailwind.css -o public/style.css --watch\"",
    "dev:mock": "concurrently -n tsx,css \"tsx watch src/dev/server.ts\" \"tailwindcss -i src/styles/tailwind.css -o public/style.css --watch\"",
```

- [ ] **Step 6: Remove MOCK_SYSTEM entirely**

In `src/lib/systemCommands.ts`, delete the `MOCK_SYSTEM` const and its doc comment, and delete every `if (MOCK_SYSTEM) { ... }` block from all six methods, leaving only the real command in each. Then remove the now-unused imports `fs from "node:fs"`, `path from "node:path"`, and `{ config } from "../config"` — they were only used by the mock branches.

After this, `realSystemCommands.createSiteDirectory` is a single `return run("sudo", [...])`, and the same for the others.

- [ ] **Step 7: Switch the route tests to the fakes**

In `src/routes/sites.test.ts`, four changes:

1. Delete `process.env.MOCK_SYSTEM = "true";` — the flag no longer exists.
2. Replace the `before(...)` hook body with fake-backed wiring. Because the fakes hold state in memory, `writeFixtures` now seeds the fake rather than the disk, and the whole temp-directory apparatus goes away:

```ts
let fakeFs: ReturnType<typeof createInMemoryFileSystem>;

function writeFixtures(caddyfile = SEED_CADDYFILE, tunnel = SEED_TUNNEL): void {
  fakeFs.rmRecursive(SITES_ROOT);
  fakeFs.mkdir(SITES_ROOT);
  fakeFs.writeFile(CADDYFILE, caddyfile);
  fakeFs.writeFile(TUNNEL_CONFIG, tunnel);
}

before(async () => {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");

  const fakes = createFakes();
  fakeFs = fakes.fs;
  writeFixtures();

  const app = createApp({
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  });

  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});
```

3. Replace every direct `fs.*` assertion in the test bodies with the fake's equivalent. The mapping is mechanical:

```ts
// before
fs.readFileSync(CADDYFILE, "utf8")            // after: fakeFs.readFile(CADDYFILE)
fs.existsSync(somePath)                       // after: fakeFs.files.has(somePath)
fs.mkdirSync(dir, { recursive: true })        // after: fakeFs.mkdir(dir)
fs.writeFileSync(file, "content")             // after: fakeFs.writeFile(file, "content")
```

For the directory-existence assertions (`POST /sites — reverse proxy` "creates no directory", and the delete-files tests), use `fakeFs.dirs.has(dirPath)` rather than `files.has`. The `import fs from "node:fs"`, `import os from "node:os"`, and the `TEMP_ROOT`/`mkdtempSync` lines are all removed.

4. Replace the temp-directory path constants with plain strings, and add one for the audit log. These must match what `config` resolves to, since nothing redirects them any more:

```ts
const CADDYFILE = "/etc/caddy/Caddyfile";
const TUNNEL_CONFIG = "/etc/cloudflared/sites-config.yml";
const SITES_ROOT = "/var/www";
const LOG_FILE = "/var/log/lyly-admin/actions.log";
```

Keep the `process.env` assignments for `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `DOMAIN`, and `PORT`, add `process.env.LOG_FILE = LOG_FILE;`, and keep the dynamic imports — `config` still reads the environment at evaluation time. The other paths need no assignment: `config`'s defaults (`src/config.ts:20-31`) already resolve to exactly the constants above, and the repository `.env` sets the same values.

The audit-log test then becomes:

```ts
    const log = fakeFs.readFile(LOG_FILE);
```

with the rest of that test unchanged.

**The test file keeps its own fixture constants** — `SEED_CADDYFILE` and `SEED_TUNNEL`, defined locally in Task 4. Do not import `src/dev/seed.ts` here. The two serve different purposes and must not be merged: the dev seed is tuned for browsing in a UI, while the test fixture deliberately gives `lychee.local` a Caddyfile block with no matching ingress rule, which is what makes the remove-flow rollback test fire.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, 64 tests — the same count and the same test names as Task 4 and Task 7.

**This is the moment the plan exists for.** The identical suite passed against the original implementation with real temp files, and now passes against the rewritten implementation with in-memory fakes. That is the evidence the refactor was behavior-preserving.

- [ ] **Step 9: Verify the flag is gone**

Run: `grep -rn "MOCK_SYSTEM" src/ .github/ deploy/ README.md CLAUDE.md`
Expected: no output.

- [ ] **Step 10: Verify dev mode actually runs**

Run: `npm run dev:mock`

Then, in a second terminal:

```bash
curl -s -u dev:dev http://127.0.0.1:8787/ | grep -c "blog.lyly.dev"
curl -s -u dev:dev http://127.0.0.1:8787/ | grep -c "lychee.local"
```

Expected: the first prints a non-zero count; the second prints `0` (the unmanaged block is filtered out). Stop the dev server afterwards.

Then confirm the mutation flow works end to end in a browser at `http://127.0.0.1:8787/` (sign in `dev` / `dev`): add a site, see it appear in the list, open its detail page, remove it, see it disappear.

- [ ] **Step 11: Verify dev code reaches neither dist nor the deploy**

```bash
npm run build
ls dist/            # expect: no dev/ directory
ls dist/lib/        # expect: systemCommands.js present, no .test.js files
grep -n "src/dev" .github/workflows/deploy.yml   # expect: the --exclude line from Task 1
```

- [ ] **Step 12: Verify typecheck and lint still cover the dev code**

Run: `npm run typecheck && npm run lint`
Expected: both PASS. (Both read `tsconfig.json`/`eslint src`, which have no exclusions — so `src/dev` is still type-checked and linted even though it is never emitted.)

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "Add in-memory dev entry point and remove the MOCK_SYSTEM flag"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md:18-26` ("Local development")
- Modify: `CLAUDE.md` (Stack, Deployment, and a new architecture note)
- Modify: `.gitignore:6` (remove `dev-fixtures/`)

**Interfaces:**
- Consumes: everything from Tasks 1-8
- Produces: nothing

- [ ] **Step 1: Remove the stale gitignore entry**

Delete the `dev-fixtures/` line from `.gitignore`. It was reserved for an on-disk fixture approach this design supersedes; nothing writes to that path.

- [ ] **Step 2: Rewrite the README's local development section**

Replace the "Local development" section of `README.md`:

```markdown
## Local development

```bash
npm install
npm run dev:mock
```

Then open http://127.0.0.1:8787 and sign in with `dev` / `dev`.

`dev:mock` runs the app against in-memory fakes — no `.env`, no fixture
files, no sudo, and nothing on your machine is modified. Adding and removing
sites works fully, so the modal flows can be developed locally; the state
resets to a seeded set of sites on every restart.

`npm run dev` is the same thing wired to the real host: it expects a `.env`
and the actual Caddy/`cloudflared` files, so it only works on `lychee`.

Other scripts: `npm test` (`tsx --test`), `npm run build`, `npm run build:css`,
`npm run typecheck`, `npm run lint`, `npm start` (runs the built
`dist/server.js`).
```

- [ ] **Step 3: Update CLAUDE.md**

Two edits.

First, in the "Stack" section, add a bullet after the process-management one:

```markdown
- Entry points: `src/server.ts` (production — real system access) and `src/dev/server.ts` (local development — in-memory fakes). Both build a `Deps` object and hand it to `createApp` in `src/app.ts`. `src/dev/` and every `*.test.ts` are excluded from `tsconfig.build.json` and from the deploy rsync, so neither reaches `dist/` or `lychee`. There is no mock-mode environment flag: mock behavior is unreachable from the production entry point because it never imports the fakes.
```

Second, add a new section immediately before "## Critical safety/security constraints":

```markdown
## Running and testing locally

`npm run dev:mock` runs the whole app off-host — macOS or Windows — against
`src/dev/fakes.ts`, which supplies an in-memory filesystem and stubbed
privileged commands. It needs no `.env` (dev credentials are `dev`/`dev`,
set in `src/dev/env.ts`) and touches nothing on the machine. Seeded site
data lives in `src/dev/seed.ts` and covers every branch the Caddyfile parser
has, including one deliberately unmanaged `lychee.local` block that must
never appear in the site list. State is in memory only, so it resets on
every restart — including the automatic restarts `tsx watch` performs when
you edit a view.

`npm test` runs `tsx --test` (no new dependency — Node's built-in runner,
driven through `tsx` so the codebase's extensionless imports resolve). The
suite covers the four pure modules plus the add/remove/rollback route flows
against the fakes.

What local mode cannot tell you: sudoers scope, the wrapper scripts' own
validation, `web:webdeploy` ownership, and real `caddy validate` behavior
are all faked. Those remain verifiable only on `lychee`.
```

- [ ] **Step 4: Verify the documented commands actually work**

Run each command the docs now promise, from a clean checkout state:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md .gitignore
git commit -m "Document the local development environment and test suite"
```

---

## Final verification

After Task 9, before opening a PR:

- [ ] `npm test` — 64 passing
- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run build` — clean, and `dist/` contains no `dev/` directory and no `*.test.js`
- [ ] `grep -rn "MOCK_SYSTEM\|lib/exec\|caddyStatus\|dev-fixtures" src/ .github/ README.md CLAUDE.md .gitignore` — no output
- [ ] `npm run dev:mock` serves a working add/remove flow at http://127.0.0.1:8787 with `dev`/`dev`
- [ ] `git log --oneline` shows nine focused commits on `local-dev-environment`

Then open a PR against `main`. Do not push to `main` directly — the deploy workflow fires on every push there.
