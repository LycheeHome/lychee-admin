# Add-site split console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `GET /sites/new` into a two-column page whose right panel shows the exact Caddyfile block and tunnel ingress lines about to be written, produced by the same functions that write them.

**Architecture:** Validation and preview-rendering move out of the Express handler into two pure modules. `POST /sites/preview` and `POST /sites` both call the same validators, and the preview derives its output by diffing the real `appendSite` / `addIngressRule` results against their inputs — so the panel cannot drift from what gets written. The view drops its 760px cap to take the 1080px frame `shell.ts` already provides.

**Tech Stack:** TypeScript, Express 4, server-rendered template strings, Tailwind v4 via CLI, vanilla JS in `public/app.js`, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-08-26-add-site-split-console-design.md`

## Global Constraints

- **The preview never writes.** No backup, no `writeManagedConfig`, no `createSiteDirectory`, no `validateCaddyfile`, no `reloadCaddy`, no `restartCloudflared`, no `logAction`. Two `fs.readFile` calls and pure functions only.
- **No new sudo scope.** `deploy/sudoers.example` is not touched by this plan.
- **The preview returns fragments, not files.** The added lines plus at most one context line. Never the whole Caddyfile or the whole tunnel config.
- **`POST /sites` behavior does not change.** Every existing test in `src/routes/sites.test.ts` must pass untouched. Error strings, status codes, and check ordering are preserved exactly.
- **Error strings are copied verbatim** from the current handler:
  - `` `"${hostname}" must be a subdomain of ${config.domain}` ``
  - `"A valid local port is required for a reverse proxy site"`
  - `` `"${healthcheckPath}" is not a valid healthcheck path` ``
  - `` `${hostname} already exists in the Caddyfile` ``
  - `` `Port ${port} is reserved (used by lyly-admin itself or Caddy's admin API)` ``
  - `` `Port ${port} is already used by ${conflictingSite.hostname}` ``
- **Check order is preserved:** valid hostname → port range → healthcheck path → hostname exists → reserved port → port conflict. The first three need no file; the last three do.
- **The 2px Ember Edge branch rule stays.** The port/framework/healthcheck fields keep `border-l-2 border-l-rose-800/70 pl-3 ml-1`.
- **Spacing steps only:** 6, 8, 10, 12, 14, 16, 20, 24px. Nothing between, nothing above 24 except the header band.
- **Mono for machine facts, Nunito for sentences.** No path, port, command, or config line in a sans face.
- **Tests anchor to an element, never document-wide.** Use `tagById` / `listById` from `src/views/html.test.ts`, and `withoutHeader` for page-body assertions — a document-wide regex passes on the header and proves nothing.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/siteValidation.ts` (create) | Reads a request body into a normalized `SiteInput`; the hostname/port/healthcheck predicates; the two validators. Sole owner of what makes an add-site request acceptable. |
| `src/lib/siteValidation.test.ts` (create) | Unit tests for the above. |
| `src/lib/sitePreview.ts` (create) | `diffInserted` and `buildSitePreview`. Sole owner of turning a valid input into a description of what will be written. |
| `src/lib/sitePreview.test.ts` (create) | Unit tests for the above. |
| `src/lib/frameworkScaffold.ts` (modify) | Gains `getScaffoldFiles`, so the filename→content mapping has one home instead of living in the route. |
| `src/routes/sites.ts` (modify) | Adds `POST /sites/preview`; `POST /sites` and the GET handlers delegate to `siteValidation`. |
| `src/views/html.ts` (modify) | `renderAddSite` takes the frame, splits into two columns, renders the preview panel and the live headline. |
| `public/app.js` (modify) | Debounced preview fetch, sequence guard, panel rendering, skip marks, live headline. |
| `DESIGN.md`, `PRODUCT.md` (modify) | Width rule, breakpoint sentence, Headline role, surfaces list. |

---

### Task 1: Normalize and validate add-site input in one place

**Files:**
- Create: `src/lib/siteValidation.ts`
- Test: `src/lib/siteValidation.test.ts`

**Interfaces:**
- Consumes: `parseSites`, `SiteType` from `src/lib/caddyfile`; `hostnameExists` from the same.
- Produces:
  - `interface SiteInput { hostname: string; type: SiteType; port: string; framework?: "nextjs"; healthcheckPath?: string }`
  - `interface SiteEnv { domain: string; sitesRoot: string; caddyfilePath: string; tunnelConfigPath: string; reservedPorts: readonly number[] }`
  - `type Validation = { ok: true } | { ok: false; error: string }`
  - `readSiteInput(body: unknown): SiteInput`
  - `isValidHostname(hostname: string, domain: string): boolean`
  - `isManagedHostname(hostname: string, domain: string): boolean`
  - `validateSiteInput(input: SiteInput, env: SiteEnv): Validation`
  - `validateAgainstExisting(input: SiteInput, caddyfileContent: string, env: SiteEnv): Validation`

- [ ] **Step 1: Write the failing test**

Create `src/lib/siteValidation.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  readSiteInput,
  validateSiteInput,
  validateAgainstExisting,
  isManagedHostname,
  type SiteEnv,
} from "./siteValidation";

const ENV: SiteEnv = {
  domain: "lyly.dev",
  sitesRoot: "/var/www",
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  reservedPorts: [8787, 2019],
};

const CADDYFILE = `{
\tauto_https off
}

http://blog.lyly.dev {
\troot * /var/www/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}
`;

describe("readSiteInput", () => {
  test("lowercases and trims the hostname, the way the add handler always has", () => {
    assert.equal(readSiteInput({ hostname: "  BLOG.Lyly.Dev " }).hostname, "blog.lyly.dev");
  });

  test("treats any type other than reverse-proxy as static", () => {
    assert.equal(readSiteInput({ type: "nonsense" }).type, "static");
    assert.equal(readSiteInput({ type: "reverse-proxy" }).type, "reverse-proxy");
  });

  test("drops a framework on a static site, where it cannot apply", () => {
    const input = readSiteInput({ type: "static", framework: "nextjs" });
    assert.equal(input.framework, undefined);
    assert.equal(input.healthcheckPath, undefined);
  });

  test("defaults a Next.js site's healthcheck to / rather than leaving it empty", () => {
    const input = readSiteInput({ type: "reverse-proxy", framework: "nextjs", healthcheckPath: "  " });
    assert.equal(input.healthcheckPath, "/");
  });
});

describe("validateSiteInput", () => {
  test("rejects a hostname outside the managed domain, in the handler's own words", () => {
    const result = validateSiteInput(readSiteInput({ hostname: "blog.example.com" }), ENV);
    assert.deepEqual(result, { ok: false, error: `"blog.example.com" must be a subdomain of lyly.dev` });
  });

  test("rejects a reverse proxy with no port", () => {
    const result = validateSiteInput(readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy" }), ENV);
    assert.deepEqual(result, { ok: false, error: "A valid local port is required for a reverse proxy site" });
  });

  test("rejects a port outside 1-65535", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "70000" });
    assert.equal(validateSiteInput(input, ENV).ok, false);
  });

  test("rejects a malformed healthcheck path", () => {
    const input = readSiteInput({
      hostname: "x.lyly.dev",
      type: "reverse-proxy",
      port: "4100",
      framework: "nextjs",
      healthcheckPath: "no-leading-slash",
    });
    assert.deepEqual(result_error(input), `"no-leading-slash" is not a valid healthcheck path`);
  });

  test("accepts a well-formed static site", () => {
    assert.deepEqual(validateSiteInput(readSiteInput({ hostname: "docs.lyly.dev" }), ENV), { ok: true });
  });

  function result_error(input: ReturnType<typeof readSiteInput>): string {
    const result = validateSiteInput(input, ENV);
    assert.equal(result.ok, false);
    return result.ok ? "" : result.error;
  }
});

describe("validateAgainstExisting", () => {
  test("rejects a hostname already in the Caddyfile", () => {
    const result = validateAgainstExisting(readSiteInput({ hostname: "blog.lyly.dev" }), CADDYFILE, ENV);
    assert.deepEqual(result, { ok: false, error: "blog.lyly.dev already exists in the Caddyfile" });
  });

  test("rejects a reserved port before it can reach a conflict check", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "2019" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), {
      ok: false,
      error: "Port 2019 is reserved (used by lyly-admin itself or Caddy's admin API)",
    });
  });

  test("names the site already holding a conflicting port", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "4000" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), {
      ok: false,
      error: "Port 4000 is already used by api.lyly.dev",
    });
  });

  test("lets a free port through", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "4100" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), { ok: true });
  });

  test("a static site is not port-checked at all", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "static", port: "4000" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), { ok: true });
  });
});

describe("isManagedHostname", () => {
  test("keeps the apex domain and its subdomains", () => {
    assert.equal(isManagedHostname("lyly.dev", "lyly.dev"), true);
    assert.equal(isManagedHostname("blog.lyly.dev", "lyly.dev"), true);
  });

  test("excludes a block lyly-admin does not own", () => {
    assert.equal(isManagedHostname("lychee.local", "lyly.dev"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/siteValidation.test.ts`
Expected: FAIL — `Cannot find module './siteValidation'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/siteValidation.ts`:

```ts
import { hostnameExists, parseSites, type SiteType } from "./caddyfile";

/**
 * What an add-site request means once normalized — the shape both POST /sites
 * and POST /sites/preview work from. Extracted from the POST /sites handler
 * so the preview can never accept input the submit would reject, or reject
 * input the submit would accept.
 */
export interface SiteInput {
  hostname: string;
  type: SiteType;
  port: string;
  framework?: "nextjs";
  healthcheckPath?: string;
}

export interface SiteEnv {
  domain: string;
  sitesRoot: string;
  caddyfilePath: string;
  tunnelConfigPath: string;
  /** lyly-admin's own port and Caddy's admin API, which no site may claim. */
  reservedPorts: readonly number[];
}

export type Validation = { ok: true } | { ok: false; error: string };

const HEALTHCHECK_PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]{0,199}$/;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isValidHostname(hostname: string, domain: string): boolean {
  const pattern = new RegExp(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.${escapeRegex(domain)}$`, "i");
  return pattern.test(hostname);
}

/**
 * Caddyfile blocks lyly-admin doesn't own (e.g. a manually added local-LAN
 * block like lychee.local) must never show up as a managed site, since
 * removing them here would still delete their local directory or tunnel
 * ingress rule.
 */
export function isManagedHostname(hostname: string, domain: string): boolean {
  return hostname === domain || isValidHostname(hostname, domain);
}

/**
 * The exact normalization POST /sites has always applied, moved verbatim so
 * both routes read a body the same way.
 */
export function readSiteInput(body: unknown): SiteInput {
  const fields = (body ?? {}) as Record<string, unknown>;
  const hostname = String(fields.hostname ?? "").trim().toLowerCase();
  const type: SiteType = fields.type === "reverse-proxy" ? "reverse-proxy" : "static";
  const port = String(fields.port ?? "").trim();
  const rawFramework = String(fields.framework ?? "").trim();
  const framework = type === "reverse-proxy" && rawFramework === "nextjs" ? ("nextjs" as const) : undefined;
  const rawHealthcheckPath = String(fields.healthcheckPath ?? "").trim();
  const healthcheckPath = framework === "nextjs" ? rawHealthcheckPath || "/" : undefined;
  return { hostname, type, port, framework, healthcheckPath };
}

/**
 * The checks that need nothing but the request itself. Split from
 * validateAgainstExisting so the ordering POST /sites has always used is
 * preserved: these three run before the Caddyfile is ever read, so a
 * malformed hostname still fails without touching the filesystem.
 */
export function validateSiteInput(input: SiteInput, env: SiteEnv): Validation {
  if (!isValidHostname(input.hostname, env.domain)) {
    return { ok: false, error: `"${input.hostname}" must be a subdomain of ${env.domain}` };
  }

  if (input.type === "reverse-proxy" && (!input.port || Number(input.port) < 1 || Number(input.port) > 65535)) {
    return { ok: false, error: "A valid local port is required for a reverse proxy site" };
  }

  if (input.healthcheckPath && !HEALTHCHECK_PATH_PATTERN.test(input.healthcheckPath)) {
    return { ok: false, error: `"${input.healthcheckPath}" is not a valid healthcheck path` };
  }

  return { ok: true };
}

/** The checks that need the current Caddyfile to answer. */
export function validateAgainstExisting(
  input: SiteInput,
  caddyfileContent: string,
  env: SiteEnv,
): Validation {
  if (hostnameExists(caddyfileContent, input.hostname)) {
    return { ok: false, error: `${input.hostname} already exists in the Caddyfile` };
  }

  if (input.type !== "reverse-proxy") return { ok: true };

  if (env.reservedPorts.includes(Number(input.port))) {
    return {
      ok: false,
      error: `Port ${input.port} is reserved (used by lyly-admin itself or Caddy's admin API)`,
    };
  }

  const conflicting = parseSites(caddyfileContent).find(
    (site) => site.type === "reverse-proxy" && site.target === input.port,
  );
  if (conflicting) {
    return { ok: false, error: `Port ${input.port} is already used by ${conflicting.hostname}` };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/siteValidation.test.ts`
Expected: PASS, all cases

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add src/lib/siteValidation.ts src/lib/siteValidation.test.ts
git commit -m "refactor: extract add-site validation into one shared module"
```

---

### Task 2: Describe what will be written, from the functions that write it

**Files:**
- Create: `src/lib/sitePreview.ts`
- Modify: `src/lib/frameworkScaffold.ts`
- Test: `src/lib/sitePreview.test.ts`

**Interfaces:**
- Consumes: `SiteInput`, `SiteEnv` from `src/lib/siteValidation`; `appendSite` from `src/lib/caddyfile`; `addIngressRule` from `src/lib/tunnelConfig`; `ADD_STEPS` from `src/lib/stepReport`.
- Produces:
  - `getScaffoldFiles(framework: string, port: string, hostname: string, sitesRoot: string, healthcheckPath: string): { name: string; content: string }[] | null` (from `frameworkScaffold.ts`)
  - `diffInserted(before: string, after: string): { added: string[]; contextAfter: string | null }`
  - `interface SitePreview { hostname: string; caddy: { path: string; added: string[] }; tunnel: { path: string; added: string[]; contextAfter: string | null }; files: { path: string; creates: string[] } | null; steps: { id: string; label: string; willRun: boolean }[] }`
  - `buildSitePreview(input: SiteInput, existing: { caddyfileContent: string; tunnelContent: string }, env: SiteEnv): SitePreview`

- [ ] **Step 1: Write the failing test**

Create `src/lib/sitePreview.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readSiteInput, type SiteEnv } from "./siteValidation";
import { appendSite } from "./caddyfile";
import { addIngressRule } from "./tunnelConfig";
import { buildSitePreview, diffInserted } from "./sitePreview";

const ENV: SiteEnv = {
  domain: "lyly.dev",
  sitesRoot: "/var/www",
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  reservedPorts: [8787, 2019],
};

const CADDYFILE = `{
\tauto_https off
}

http://blog.lyly.dev {
\troot * /var/www/blog.lyly.dev
\tfile_server
}
`;

const TUNNEL = `tunnel: 11111111-2222-3333-4444-555555555555
ingress:
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

const EXISTING = { caddyfileContent: CADDYFILE, tunnelContent: TUNNEL };

describe("diffInserted", () => {
  test("finds text appended at the end, with no context line after it", () => {
    const result = diffInserted("a\nb\n", "a\nb\n\nc\nd\n");
    assert.deepEqual(result.added, ["c", "d"]);
    assert.equal(result.contextAfter, null);
  });

  test("finds text spliced into the middle, and names the line it lands above", () => {
    const result = diffInserted("a\nb\nz\n", "a\nb\nc\nz\n");
    assert.deepEqual(result.added, ["c"]);
    assert.equal(result.contextAfter, "z");
  });

  test("reports nothing added when the two are identical", () => {
    assert.deepEqual(diffInserted("a\nb\n", "a\nb\n").added, []);
  });
});

describe("buildSitePreview — static", () => {
  const preview = buildSitePreview(readSiteInput({ hostname: "docs.lyly.dev" }), EXISTING, ENV);

  test("the Caddyfile lines it reports are exactly what appendSite would write", () => {
    const after = appendSite(CADDYFILE, {
      hostname: "docs.lyly.dev",
      type: "static",
      target: "/var/www/docs.lyly.dev",
    });
    assert.ok(after.includes(preview.caddy.added.join("\n")));
    assert.deepEqual(preview.caddy.added, [
      "http://docs.lyly.dev {",
      "\troot * /var/www/docs.lyly.dev",
      "\tfile_server",
      "}",
    ]);
  });

  test("the ingress lines it reports are exactly what addIngressRule would write", () => {
    const after = addIngressRule(TUNNEL, "docs.lyly.dev", "http://localhost:80");
    assert.ok(after.includes(preview.tunnel.added.join("\n")));
    assert.deepEqual(preview.tunnel.added, [
      "  - hostname: docs.lyly.dev",
      "    service: http://localhost:80",
    ]);
  });

  test("shows the catch-all the route is inserted above, so the position is visible", () => {
    assert.equal(preview.tunnel.contextAfter, "  - service: http_status:404");
  });

  test("a static site creates its directory and a placeholder page", () => {
    assert.deepEqual(preview.files, { path: "/var/www/docs.lyly.dev", creates: ["index.html"] });
  });

  test("every step runs for a static site", () => {
    assert.deepEqual(preview.steps.filter((step) => !step.willRun), []);
  });

  test("carries the paths it is describing, so the panel never hardcodes them", () => {
    assert.equal(preview.caddy.path, "/etc/caddy/Caddyfile");
    assert.equal(preview.tunnel.path, "/etc/cloudflared/sites-config.yml");
  });
});

describe("buildSitePreview — plain reverse proxy", () => {
  const preview = buildSitePreview(
    readSiteInput({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4100" }),
    EXISTING,
    ENV,
  );

  test("writes a reverse_proxy block with no marker comments", () => {
    assert.deepEqual(preview.caddy.added, [
      "http://docs.lyly.dev {",
      "\treverse_proxy localhost:4100",
      "}",
    ]);
  });

  test("creates no directory, so the files step is the one that will not run", () => {
    assert.equal(preview.files, null);
    const skipped = preview.steps.filter((step) => !step.willRun).map((step) => step.id);
    assert.deepEqual(skipped, ["files"]);
  });
});

describe("buildSitePreview — Next.js reverse proxy", () => {
  const preview = buildSitePreview(
    readSiteInput({
      hostname: "docs.lyly.dev",
      type: "reverse-proxy",
      port: "4100",
      framework: "nextjs",
      healthcheckPath: "/api/health",
    }),
    EXISTING,
    ENV,
  );

  test("records both marker comments inside the block", () => {
    assert.deepEqual(preview.caddy.added, [
      "http://docs.lyly.dev {",
      "\t# lyly-admin-framework: nextjs",
      "\t# lyly-admin-healthcheck: /api/health",
      "\treverse_proxy localhost:4100",
      "}",
    ]);
  });

  test("lists the scaffold files, and the files step runs again", () => {
    assert.deepEqual(preview.files, {
      path: "/var/www/docs.lyly.dev",
      creates: ["Dockerfile", "docker-compose.yml", ".dockerignore"],
    });
    assert.deepEqual(preview.steps.filter((step) => !step.willRun), []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/sitePreview.test.ts`
Expected: FAIL — `Cannot find module './sitePreview'`

- [ ] **Step 3: Give the scaffold one home for its filenames**

Add to the end of `src/lib/frameworkScaffold.ts`:

```ts
/**
 * The scaffold as files rather than fields, so the add handler that writes
 * them and the preview that lists them read one mapping. A fourth scaffold
 * file added here appears in the preview with no further change; a filename
 * kept only in the route would make the panel quietly wrong.
 */
export function getScaffoldFiles(
  framework: string,
  port: string,
  hostname: string,
  sitesRoot: string,
  healthcheckPath: string,
): { name: string; content: string }[] | null {
  const scaffold = getFrameworkScaffold(framework, port, hostname, sitesRoot, healthcheckPath);
  if (!scaffold) return null;
  return [
    { name: "Dockerfile", content: scaffold.dockerfile },
    { name: "docker-compose.yml", content: scaffold.compose },
    { name: ".dockerignore", content: scaffold.dockerignore },
  ];
}
```

- [ ] **Step 4: Write the preview module**

Create `src/lib/sitePreview.ts`:

```ts
import path from "node:path";
import { appendSite } from "./caddyfile";
import { addIngressRule } from "./tunnelConfig";
import { getScaffoldFiles } from "./frameworkScaffold";
import { ADD_STEPS } from "./stepReport";
import type { SiteEnv, SiteInput } from "./siteValidation";

export interface SitePreview {
  hostname: string;
  caddy: { path: string; added: string[] };
  tunnel: { path: string; added: string[]; contextAfter: string | null };
  files: { path: string; creates: string[] } | null;
  steps: { id: string; label: string; willRun: boolean }[];
}

/**
 * The lines present in `after` but not `before`, assuming one contiguous
 * insertion — which is all appendSite and addIngressRule ever make.
 *
 * Deliberately a diff rather than re-rendering the block here: the panel's
 * whole claim is that it shows what will actually be written, so the text
 * must come out of the real writers. The tunnel config is re-serialized whole
 * by yaml.dump, so if that round-trip ever reformats a line the app did not
 * mean to touch, this surfaces it instead of hiding it.
 *
 * The head walk is capped before the tail walk so an append at the end of the
 * file is attributed to the end and not mistaken for a shorter insertion that
 * happens to share its closing lines.
 */
export function diffInserted(before: string, after: string): { added: string[]; contextAfter: string | null } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  let head = 0;
  while (head < beforeLines.length && head < afterLines.length && beforeLines[head] === afterLines[head]) {
    head++;
  }

  let tail = 0;
  while (
    tail < beforeLines.length - head &&
    tail < afterLines.length - head &&
    beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]
  ) {
    tail++;
  }

  const added = afterLines.slice(head, afterLines.length - tail);
  while (added.length > 0 && added[0] === "") added.shift();
  while (added.length > 0 && added[added.length - 1] === "") added.pop();

  const context = afterLines[afterLines.length - tail];
  return { added, contextAfter: context === undefined || context === "" ? null : context };
}

/**
 * What POST /sites would write for this input, without writing any of it.
 * Every string here is produced by the same function the add handler calls.
 */
export function buildSitePreview(
  input: SiteInput,
  existing: { caddyfileContent: string; tunnelContent: string },
  env: SiteEnv,
): SitePreview {
  const sitePath = path.posix.join(env.sitesRoot, input.hostname);
  const target = input.type === "static" ? sitePath : input.port;

  const caddyAfter = appendSite(existing.caddyfileContent, {
    hostname: input.hostname,
    type: input.type,
    target,
    framework: input.framework,
    healthcheckPath: input.healthcheckPath,
  });
  const caddyDiff = diffInserted(existing.caddyfileContent, caddyAfter);

  const tunnelAfter = addIngressRule(existing.tunnelContent, input.hostname, "http://localhost:80");
  const tunnelDiff = diffInserted(existing.tunnelContent, tunnelAfter);

  const scaffold = input.framework
    ? getScaffoldFiles(input.framework, input.port, input.hostname, env.sitesRoot, input.healthcheckPath ?? "/")
    : null;

  // Mirrors the add handler's three cases exactly: a static site gets a
  // directory and a placeholder, a scaffolded proxy gets a directory and its
  // scaffold, and a plain proxy has no directory to create at all.
  const files =
    input.type === "static"
      ? { path: sitePath, creates: ["index.html"] }
      : scaffold
        ? { path: sitePath, creates: scaffold.map((file) => file.name) }
        : null;

  return {
    hostname: input.hostname,
    caddy: { path: env.caddyfilePath, added: caddyDiff.added },
    tunnel: { path: env.tunnelConfigPath, added: tunnelDiff.added, contextAfter: tunnelDiff.contextAfter },
    files,
    steps: ADD_STEPS.map((step) => ({ ...step, willRun: step.id === "files" ? files !== null : true })),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/lib/sitePreview.test.ts`
Expected: PASS, all cases

- [ ] **Step 6: Run the whole suite, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass — `getScaffoldFiles` is additive and breaks nothing

- [ ] **Step 7: Commit**

```bash
git add src/lib/sitePreview.ts src/lib/sitePreview.test.ts src/lib/frameworkScaffold.ts
git commit -m "feat: describe an add-site mutation from the functions that perform it"
```

---

### Task 3: One validation path, two routes

**Files:**
- Modify: `src/routes/sites.ts`
- Test: `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: everything Tasks 1 and 2 produce.
- Produces: `POST /sites/preview` returning `{ ready: false }` | `{ ready: false, error: string }` | `{ ready: true, preview: SitePreview }`, always with status `200`.

- [ ] **Step 1: Write the failing tests**

Append to `src/routes/sites.test.ts`:

```ts
describe("POST /sites/preview", () => {
  test("returns the Caddyfile block that POST /sites would append", async () => {
    const response = await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; preview: { caddy: { added: string[] } } }>(response);
    assert.equal(body.ready, true);
    assert.deepEqual(body.preview.caddy.added, [
      "http://docs.lyly.dev {",
      `\troot * ${SITES_ROOT}/docs.lyly.dev`,
      "\tfile_server",
      "}",
    ]);
  });

  test("writes nothing — the Caddyfile is byte-identical afterwards", async () => {
    const before = fakeFs.readFile(CADDYFILE);
    const beforeTunnel = fakeFs.readFile(TUNNEL_CONFIG);
    await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "static" }));
    assert.equal(fakeFs.readFile(CADDYFILE), before);
    assert.equal(fakeFs.readFile(TUNNEL_CONFIG), beforeTunnel);
  });

  test("creates no site directory", async () => {
    await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "static" }));
    // hasDir/hasFile, not exists — the in-memory fake exposes those two
    // (src/dev/fakes.ts), and the static-add test above already uses hasDir.
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "docs.lyly.dev")), false);
    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "docs.lyly.dev", "index.html")), false);
  });

  test("an empty hostname is not ready and not an error — the form is merely early", async () => {
    const response = await request("/sites/preview", form({ hostname: "", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; error?: string }>(response);
    assert.equal(body.ready, false);
    assert.equal(body.error, undefined);
  });

  test("reports a duplicate hostname before submit, in the submit's own words", async () => {
    const response = await request("/sites/preview", form({ hostname: "blog.lyly.dev", type: "static" }));
    const body = await json<{ ready: boolean; error: string }>(response);
    assert.equal(body.ready, false);
    assert.equal(body.error, "blog.lyly.dev already exists in the Caddyfile");
  });

  test("reports a port conflict with the same string the submit would return", async () => {
    const preview = await json<{ error: string }>(
      await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4000" })),
    );
    const submit = await json<{ error: string }>(
      await request("/sites", form({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4000" })),
    );
    assert.equal(preview.error, submit.error);
  });

  test("marks the directory step as not running for a plain reverse proxy", async () => {
    const response = await request(
      "/sites/preview",
      form({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4100" }),
    );
    const body = await json<{ preview: { steps: { id: string; willRun: boolean }[] } }>(response);
    const skipped = body.preview.steps.filter((step) => !step.willRun).map((step) => step.id);
    assert.deepEqual(skipped, ["files"]);
  });

  test("requires authentication like every other route", async () => {
    const response = await fetch(`${baseUrl}/sites/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ hostname: "docs.lyly.dev" }).toString(),
    });
    assert.equal(response.status, 401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/routes/sites.test.ts`
Expected: FAIL — the preview route 404s, so `response.status` is `404` not `200`

- [ ] **Step 3: Delegate the route's validation to the shared module**

In `src/routes/sites.ts`, delete the local `escapeRegex`, `hostnamePattern`, `isValidHostname`, `isManagedHostname`, `HEALTHCHECK_PATH_PATTERN`, and `computePortOwners`'s inline reserved entries are kept as-is. Add imports:

```ts
import {
  isManagedHostname as isManaged,
  readSiteInput,
  validateAgainstExisting,
  validateSiteInput,
  type SiteEnv,
} from "../lib/siteValidation";
import { buildSitePreview } from "../lib/sitePreview";
```

Add the environment object once, near `CADDY_ADMIN_PORT`:

```ts
const SITE_ENV: SiteEnv = {
  domain: config.domain,
  sitesRoot: config.sitesRoot,
  caddyfilePath: config.caddyfilePath,
  tunnelConfigPath: config.tunnelConfigPath,
  reservedPorts: [config.port, CADDY_ADMIN_PORT],
};
```

Replace every `isManagedHostname(x)` call site with `isManaged(x, config.domain)`.

Then replace the head of the `POST /sites` handler — from `const hostname = String(...)` through the port-conflict block inside the `try` — with:

```ts
    const input = readSiteInput(req.body);
    const { hostname, type, port, framework, healthcheckPath } = input;

    const validation = validateSiteInput(input, SITE_ENV);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
```

and, inside the `try`, replacing the `hostnameExists` / reserved-port / conflict checks:

```ts
      caddyfileContent = deps.fs.readFile(config.caddyfilePath);
      const existing = validateAgainstExisting(input, caddyfileContent, SITE_ENV);
      if (!existing.ok) throw new Error(existing.error);
```

- [ ] **Step 4: Add the preview route**

Register it immediately after `POST /sites` in `src/routes/sites.ts`:

```ts
  /**
   * What POST /sites would write, without writing it. Reads the two config
   * files and calls the same validators and the same appendSite /
   * addIngressRule the add handler does, so the panel it feeds cannot drift
   * from what actually lands on disk.
   *
   * Always 200. A half-typed form is not a client error, and a 4xx per
   * keystroke would fill the console with failures that are merely early.
   */
  sitesRouter.post("/sites/preview", (req, res) => {
    const input = readSiteInput(req.body);
    if (!input.hostname) {
      res.json({ ready: false });
      return;
    }

    const validation = validateSiteInput(input, SITE_ENV);
    if (!validation.ok) {
      res.json({ ready: false, error: validation.error });
      return;
    }

    const caddyfileContent = deps.fs.readFile(config.caddyfilePath);
    const tunnelContent = deps.fs.readFile(config.tunnelConfigPath);

    const existing = validateAgainstExisting(input, caddyfileContent, SITE_ENV);
    if (!existing.ok) {
      res.json({ ready: false, error: existing.error });
      return;
    }

    res.json({ ready: true, preview: buildSitePreview(input, { caddyfileContent, tunnelContent }, SITE_ENV) });
  });
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — including every pre-existing `POST /sites` rejection test, unchanged. If any of those fail, the extraction changed behavior; fix the extraction, not the test.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/routes/sites.ts src/routes/sites.test.ts
git commit -m "feat: add POST /sites/preview and share one validation path with POST /sites"
```

---

### Task 4: Split the page into form and panel

**Files:**
- Modify: `src/views/html.ts:170-261`
- Modify: `src/views/shared.ts`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `ADD_STEPS`, the existing shared class constants.
- Produces: `renderAddSite(sites: Site[], domain: string, portOwners: Record<string, string>, paths: { caddyfilePath: string; tunnelConfigPath: string }): string`, and `FRAME_WIDTH` exported from `src/views/shared.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/views/html.test.ts`, add a `PATHS` fixture next to `OPTS`:

```ts
const PATHS = {
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
};
```

Update the four existing `renderAddSite(...)` call sites to pass `PATHS` as a fourth argument, then add:

```ts
describe("the add-site preview panel", () => {
  const html = renderAddSite(SITES, "lyly.dev", {}, PATHS);

  test("takes the 1080px frame rather than the 760px reading column", () => {
    const body = withoutHeader(html);
    assert.doesNotMatch(body, /max-w-\[760px\]/, "add-site should no longer cap at the detail page's width");
  });

  test("puts the form and the panel in one grid that collapses below lg", () => {
    const grid = tagById(html, "add-site-columns");
    assert.match(grid, /grid-cols-1/);
    assert.match(grid, /lg:grid-cols-\[1fr_400px\]/);
  });

  test("names both files it is going to edit, before anything is typed", () => {
    const panel = sectionById(html, "write-preview");
    assert.match(panel, /\/etc\/caddy\/Caddyfile/);
    assert.match(panel, /\/etc\/cloudflared\/sites-config\.yml/);
  });

  test("renders the step list inside the panel, keeping the id the submit handler marks", () => {
    const panel = sectionById(html, "write-preview");
    assert.match(panel, /id="add-site-steps"/);
  });

  test("every step keeps its data-step-id, so a failed submit can still mark it", () => {
    const list = listById(html, "add-site-steps");
    for (const step of ADD_STEPS) {
      assert.match(list, new RegExp(`data-step-id="${step.id}"`));
    }
  });

  test("the panel's error region is announced, since a duplicate hostname is actionable", () => {
    const error = tagById(html, "preview-error");
    assert.match(error, /role="status"/);
  });

  test("the panel itself is not a live region — announcing a config block per keystroke is hostile", () => {
    const panel = tagById(html, "write-preview");
    assert.doesNotMatch(panel, /aria-live/);
  });

  test("the headline carries an element the client can retype as the hostname", () => {
    assert.ok(tagById(html, "composed-hostname"));
  });

  test("the port branch keeps the 2px Ember Edge rule DESIGN.md documents", () => {
    const branch = withoutHeader(html).match(/<div class="port-input[^"]*"/);
    assert.ok(branch);
    assert.match(branch[0], /border-l-2/);
    assert.match(branch[0], /border-l-rose-800/);
  });
});
```

Add this helper beside `listById` in the same file:

```ts
/**
 * The whole <aside id="..."> ... </aside>, so a claim about the preview panel
 * is anchored to it rather than to the document — where the same path string
 * also appears in the form's own copy.
 */
function sectionById(html: string, id: string): string {
  const match = html.match(new RegExp(`<aside[^>]* id="${id}"[^>]*>[\\s\\S]*?<\\/aside>`));
  assert.ok(match, `no <aside id="${id}"> was rendered`);
  return match[0];
}
```

and import `ADD_STEPS` at the top of the test file:

```ts
import { ADD_STEPS } from "../lib/stepReport";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — `renderAddSite` takes three arguments, and no `#add-site-columns` is rendered

- [ ] **Step 3: Add the frame constant**

Add to `src/views/shared.ts`, beside `DETAIL_WIDTH`:

```ts
/**
 * The page frame — the same 1080px the shell's <main> and the header band
 * already use. A page takes this when it has two kinds of content that belong
 * side by side; DETAIL_WIDTH is the reading column it caps to when it has one.
 */
export const FRAME_WIDTH = "max-w-[1080px] mx-auto w-full";
```

- [ ] **Step 4: Rewrite renderAddSite**

Replace `src/views/html.ts:170-261` with:

```ts
export function renderAddSite(
  sites: Site[],
  domain: string,
  portOwners: Record<string, string>,
  // Passed in rather than read from config here, matching renderSiteList and
  // the detail page: a view that knows these paths by itself is a view that
  // can disagree with the files the app actually edits.
  paths: { caddyfilePath: string; tunnelConfigPath: string },
): string {
  return layout(
    "Add a site",
    `
    <div class="${FRAME_WIDTH} flex flex-col gap-6">
      <div class="flex flex-col gap-3">
        <nav class="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
          <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
          <span class="text-stone-600 mx-1.5" aria-hidden="true">/</span>
          <span class="text-stone-50">new</span>
        </nav>

        <!--
          The headline is the site being composed, in the same Headline
          treatment its detail page will give it — so the page you are filling
          in already looks like the page you are about to create. app.js
          retypes #composed-hostname as you type; before that it reads "Add a
          site", which is what the page is when it has no subject yet.
        -->
        <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">
          <span id="composed-hostname" data-domain="${escapeHtml(domain)}">Add a site</span>
        </h2>
      </div>

      <div id="add-site-columns" class="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">
        <form id="add-site-form" method="post" action="/sites" class="flex flex-col gap-6">
          <label class="${FORM_LABEL}">
            Hostname
            <span id="hostname-row" class="flex items-stretch rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2">
              <input type="text" id="hostname-field" name="hostname" required autocomplete="off"
                     aria-describedby="hostname-suffix"
                     class="${INPUT} rounded-r-none flex-1 min-w-0 focus:outline-none!" placeholder="blog" />
              <span id="hostname-suffix" class="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-l-0 border-stone-700 rounded-r-md px-2.5 flex items-center shrink-0">.${escapeHtml(domain)}</span>
            </span>
          </label>

          <fieldset class="border-0 p-0 m-0 flex flex-col gap-3">
            <legend class="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-0 mb-2">Type</legend>

            <label class="flex flex-col gap-1 rounded-md border border-stone-600 bg-stone-700/50 px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-700/80 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500">
              <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
                <input type="radio" name="type" value="static" checked aria-label="Static site" aria-describedby="type-static-description" class="accent-stone-300 ${FOCUS_RING}" />
                Static site
              </span>
              <span id="type-static-description" class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lyly-admin creates for you with a placeholder page — no process to run yourself.</span>
            </label>

            <label class="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
              <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
                <input type="radio" name="type" value="reverse-proxy" aria-label="Reverse proxy" aria-describedby="type-proxy-description" class="accent-rose-400 ${FOCUS_RING}" />
                Reverse proxy
              </span>
              <span id="type-proxy-description" class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lyly-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
            </label>
          </fieldset>

          <div class="port-input hidden flex-col gap-3 border-l-2 border-l-rose-800/70 pl-3 ml-1">
            <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
              Local port (reverse proxy only)
              <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" aria-describedby="port-error" />
              <span id="port-error" class="port-error hidden text-red-300 text-[0.8rem]" role="status" aria-live="polite"></span>
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
          <script type="application/json" id="port-owners-data">${JSON.stringify(portOwners)}</script>

          <p id="add-site-error" role="alert" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

          <div class="flex justify-end gap-2.5">
            <a href="/" class="${BUTTON_SECONDARY} no-underline">Cancel</a>
            <button type="submit" id="add-site-submit" class="${BUTTON_PRIMARY}">Add site</button>
          </div>
        </form>

        <!--
          Deliberately not aria-live: this panel rewrites on every debounced
          keystroke, and announcing a Caddyfile block that often would bury the
          field the user is typing into. The one actionable thing in here — a
          rejection the submit would also make — is announced by #preview-error
          instead.
        -->
        <aside id="write-preview" class="${CARD} flex flex-col gap-3.5">
          <p class="${CARD_LABEL_BASE} text-stone-300 m-0">Will be written</p>

          <p id="preview-error" role="status" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

          <div id="preview-body" class="flex flex-col gap-3.5">
            <div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL}">${escapeHtml(paths.caddyfilePath)}</p>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL}">${escapeHtml(paths.tunnelConfigPath)}</p>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
            </div>
            <p class="text-stone-400 text-[0.8rem] leading-snug m-0">Name the site and the exact block and route appear here, before anything is written.</p>
          </div>

          <hr class="border-0 border-t border-stone-700 m-0" />

          <div>
            <p class="${CARD_LABEL_BASE} text-stone-300 m-0 mb-3">In this order</p>
            <ol id="add-site-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
              ${ADD_STEPS.map(
                (step, index) =>
                  `<li class="flex gap-2" data-step-id="${step.id}"><span class="text-stone-400 shrink-0">${index + 1}.</span><span>${escapeHtml(step.label)}</span><span class="step-mark ml-auto shrink-0"></span></li>`,
              ).join("")}
            </ol>
            <p class="text-stone-400 text-[0.75rem] leading-snug m-0">If a step fails, the ones after it don't run.</p>
          </div>
        </aside>
      </div>
    </div>
    `,
    { nav: { page: "new" } },
  );
}
```

Add `PATH_LABEL` beside `HOP_LABEL` in `src/views/html.ts`:

```ts
/**
 * A path is a machine fact and is case-sensitive, so it takes the Micro-label
 * size and weight but never its uppercase — the one place in the system where
 * that transform is dropped.
 */
const PATH_LABEL = "font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-stone-400 m-0 break-all";
```

Add `FRAME_WIDTH` and `CARD_LABEL_BASE` to the import block from `./shared`, and drop `DETAIL_WIDTH` from it if `renderAddSite` was its only user in this file (it is not — the detail page uses it — so leave the import).

- [ ] **Step 5: Update the route's call site**

In `src/routes/sites.ts`, `GET /sites/new`:

```ts
    res.send(
      renderAddSite(sites, config.domain, computePortOwners(sites), {
        caddyfilePath: config.caddyfilePath,
        tunnelConfigPath: config.tunnelConfigPath,
      }),
    );
```

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Rebuild CSS and check the page renders**

Run: `npm run build:css`

Then start `npm run dev:mock`, open `http://127.0.0.1:8787/sites/new` (credentials `dev`/`dev`), and confirm: two columns at a wide window, one column below 1024px, the panel showing both paths and an em-dash, and the six steps beneath the rule.

- [ ] **Step 8: Commit**

```bash
git add src/views/html.ts src/views/shared.ts src/views/html.test.ts src/routes/sites.ts public/style.css
git commit -m "feat: split the add-site page into a form and a what-gets-written panel"
```

---

### Task 5: Fill the panel as the operator types

**Files:**
- Modify: `public/app.js:255-302` (the add-site form block)

**Interfaces:**
- Consumes: `POST /sites/preview`; `#composed-hostname`, `#preview-body`, `#preview-error`, `#add-site-steps` from Task 4.
- Produces: nothing other modules read.

- [ ] **Step 1: Add the preview module to `public/app.js`**

Insert after the existing `validatePortField` / `portField?.addEventListener("input", ...)` lines and before `const addSiteForm = ...`:

```js
// --- Add-site preview -----------------------------------------------------
// Fetches what POST /sites would write and renders it beside the form. The
// endpoint calls the same appendSite/addIngressRule the submit does, so this
// panel cannot describe an edit that differs from the one performed.

const composedHostname = document.getElementById("composed-hostname");
const previewBody = document.getElementById("preview-body");
const previewError = document.getElementById("preview-error");
const previewDomain = composedHostname?.dataset.domain ?? "";

// Responses can land out of order — a slow early request must never overwrite
// a fast later one. Only the newest sequence number is allowed to render.
let previewSequence = 0;
let previewTimer;

function composeHostname(label) {
  const trimmed = label.trim().replace(/\.+$/, "");
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const domainLower = previewDomain.toLowerCase();
  return lower === domainLower || lower.endsWith(`.${domainLower}`) ? trimmed : `${trimmed}.${previewDomain}`;
}

function renderComposedHostname(hostname) {
  if (!composedHostname) return;
  if (!hostname) {
    composedHostname.textContent = "Add a site";
    return;
  }
  const suffix = `.${previewDomain}`;
  if (hostname.toLowerCase().endsWith(suffix.toLowerCase()) && hostname.length > suffix.length) {
    const label = hostname.slice(0, hostname.length - suffix.length);
    composedHostname.textContent = "";
    composedHostname.append(label);
    const dim = document.createElement("span");
    dim.className = "text-stone-600";
    dim.textContent = hostname.slice(hostname.length - suffix.length);
    composedHostname.append(dim);
    return;
  }
  composedHostname.textContent = hostname;
}

function previewLines(lines, className) {
  const pre = document.createElement("pre");
  pre.className = `font-mono text-[0.72rem] leading-[1.55] text-stone-50 bg-stone-900 border border-stone-700 rounded-md p-2.5 m-0 overflow-x-auto whitespace-pre [tab-size:4] ${className ?? ""}`;
  pre.textContent = lines.join("\n");
  return pre;
}

function previewSection(pathText, lines, contextAfter) {
  const section = document.createElement("div");
  section.className = "flex flex-col gap-1.5";

  const label = document.createElement("p");
  label.className = "font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-stone-400 m-0 break-all";
  label.textContent = pathText;
  section.append(label);

  const body = lines.slice();
  if (contextAfter) body.push(contextAfter);
  const pre = previewLines(body);
  // Everything but the trailing context line is an addition. Colouring rather
  // than prefixing with "+" keeps a YAML list dash from reading as a deletion.
  if (contextAfter) {
    pre.textContent = "";
    const added = document.createElement("span");
    added.className = "text-green-300";
    added.textContent = `${lines.join("\n")}\n`;
    const context = document.createElement("span");
    context.className = "text-stone-600";
    context.textContent = contextAfter;
    pre.append(added, context);
  } else {
    pre.className += " text-green-300";
  }
  section.append(pre);
  return section;
}

function markSkips(listId, steps) {
  for (const step of steps ?? []) {
    const row = document.querySelector(`#${listId} [data-step-id="${step.id}"]`);
    const mark = row?.querySelector(".step-mark");
    if (!mark) continue;
    mark.textContent = step.willRun ? "" : STEP_MARKS.skipped;
    mark.className = `step-mark ml-auto shrink-0 ${step.willRun ? "" : STEP_MARK_CLASSES.skipped}`;
  }
}

function renderPreviewEmpty(message) {
  if (!previewBody) return;
  previewBody.textContent = "";
  const line = document.createElement("p");
  line.className = "text-stone-400 text-[0.8rem] leading-snug m-0";
  line.textContent = message;
  previewBody.append(line);
  markSkips("add-site-steps", []);
  resetSteps("add-site-steps");
}

function renderPreview(preview) {
  if (!previewBody) return;
  previewBody.textContent = "";
  previewBody.append(previewSection(preview.caddy.path, preview.caddy.added, null));
  previewBody.append(previewSection(preview.tunnel.path, preview.tunnel.added, preview.tunnel.contextAfter));

  if (preview.files) {
    previewBody.append(previewSection(preview.files.path, preview.files.creates, null));
  }

  markSkips("add-site-steps", preview.steps);
}

async function refreshPreview() {
  if (!previewBody || !addSiteForm) return;

  const data = new FormData(addSiteForm);
  const hostname = composeHostname(String(data.get("hostname") ?? ""));
  renderComposedHostname(hostname);

  const sequence = ++previewSequence;
  try {
    const response = await fetch("/sites/preview", {
      method: "POST",
      body: new URLSearchParams({
        hostname,
        type: String(data.get("type") ?? "static"),
        port: String(data.get("port") ?? "").trim(),
        framework: String(data.get("framework") ?? "").trim(),
        healthcheckPath: String(data.get("healthcheckPath") ?? "").trim(),
      }),
    });
    if (sequence !== previewSequence) return;
    if (!response.ok) return;

    const result = await response.json();
    if (sequence !== previewSequence) return;

    if (result.ready) {
      previewError?.classList.add("hidden");
      renderPreview(result.preview);
      return;
    }

    if (result.error) {
      // Unhide before writing, for the same reason #add-site-error does:
      // role="status" does not announce a mutation inside a hidden subtree.
      previewError?.classList.remove("hidden");
      if (previewError) previewError.textContent = result.error;
      renderPreviewEmpty("Fix the problem above and the block appears here.");
      return;
    }

    previewError?.classList.add("hidden");
    renderPreviewEmpty("Name the site and the exact block and route appear here, before anything is written.");
  } catch {
    // A failed preview is a failed read. Keep the last good render and let the
    // submit's own validation be the gate — never block adding a site on it.
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 250);
}
```

- [ ] **Step 2: Wire the listeners**

Immediately after the block above, add:

```js
document.getElementById("hostname-field")?.addEventListener("input", schedulePreview);
portField?.addEventListener("input", schedulePreview);
frameworkField?.addEventListener("change", schedulePreview);
document.getElementById("healthcheck-field")?.addEventListener("input", schedulePreview);
typeInputs.forEach((input) => input.addEventListener("change", schedulePreview));
if (document.getElementById("add-site-form")) refreshPreview();
```

Note `addSiteForm` is declared below this block today; move its `const addSiteForm = document.getElementById("add-site-form");` line **above** the preview block so `refreshPreview` closes over it.

- [ ] **Step 3: Clear skip marks when a submit starts**

In the submit handler, `resetSteps("add-site-steps")` already runs before the POST. No change needed — `resetSteps` blanks every `.step-mark`, including the skip dashes this task writes.

- [ ] **Step 4: Verify by hand**

Run `npm run dev:mock`, open `http://127.0.0.1:8787/sites/new`, and confirm each state from the spec:

- Nothing typed → panel shows both paths and the "Name the site…" line; headline reads "Add a site".
- Type `docs` → headline becomes `docs.lyly.dev` with the suffix dimmed; the Caddyfile block and both ingress lines render in green above the dimmed `- service: http_status:404`.
- Type `blog` → the panel shows `blog.lyly.dev already exists in the Caddyfile`.
- Switch to reverse proxy, port `4100` → the `Site directory created` step shows an em-dash.
- Pick Next.js → the directory section lists the three scaffold files and the dash clears.
- Set port `4000` → `Port 4000 is already used by api.lyly.dev`, matching the inline field error.
- Narrow the window below 1024px → one column, panel beneath the form.
- Submit successfully → lands on the new site's page as before.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS. `public/app.js` is not typechecked, so the gate here is the manual pass above plus the unchanged suite.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat: fill the add-site preview panel as the operator types"
```

---

### Task 6: Make the documents true again

**Files:**
- Modify: `DESIGN.md`
- Modify: `PRODUCT.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Rewrite the width rule**

In `DESIGN.md`, under Layout → Named Rules, replace **The Width-Follows-Purpose Rule** with:

```markdown
**The Frame-And-Column Rule.** 1080px is the page frame — the header band, the
shell's `<main>`, and any page holding two kinds of content that belong side by
side. 760px is a reading column, applied *inside* that frame by a page holding
one. No width ever lengthens a line of prose past ~70ch: on the add-site page
the frame buys a second column and the form column is 656px, narrower than the
760 it replaced. The site list fills the frame because its rows need the width
to align a reserved status column; the detail page caps at 760 because
everything on it is a sentence to read or a command to copy and it has nothing
to put beside them. The system holds exactly two numbers and never a third.
```

Update the Layout section's opening paragraph, which currently says "Two containers, chosen by what the page is for", to describe a frame and a column instead, and note that add-site takes the frame.

- [ ] **Step 2: Correct the breakpoint sentence**

In `DESIGN.md` → Layout, replace "The only breakpoint in the system is `sm` (640px)." and the paragraph that follows with:

```markdown
Two breakpoints. `sm` (640px) is the floor that keeps a narrow window honest:
below it the routing hop chain turns from a row of four hops separated by `→`
into a stacked column separated by `↓`, the remove dialog's four-step list
collapses from two columns to one, and the site list's status column releases
its reserved `9rem`. `lg` (1024px) exists only for the add-site page, whose
form and preview columns need 1128px to render side by side at full size and
stack below it. Neither is a mobile design — PRODUCT.md records this as a
desktop-only tool.
```

- [ ] **Step 3: Extend the Headline role**

In `DESIGN.md` → Typography → Hierarchy, change the **Headline** entry's scope from "A site's hostname on its detail page" to:

```markdown
- **Headline** (DM Mono, 1.7rem, line-height 1.2, tracking -0.01em): A site's
  hostname on the page that owns it — its detail page, and the add-site page
  while that hostname is being composed — with the shared `.lyly.dev` suffix
  dropped to Smoke Deep so the subdomain reads first. Legible there because
  27px is large text, and nowhere else. Slight negative tracking because mono
  at display size otherwise sprawls.
```

- [ ] **Step 4: Document the preview panel as a component**

In `DESIGN.md` → Components, after the Command Block section, add:

```markdown
### What-Gets-Written Panel

The add-site page's right column, and the only place in the app that shows
config before it exists. A card holding, in order: each target file's path as
a Micro-label with its uppercase dropped — a path is case-sensitive and must
never be transformed — over a Hearth inset showing the lines to be added in
Clear, with one line of surrounding context in Smoke Deep beneath them so the
insertion point is visible. Additions are marked by colour, never by a `+`
gutter, because a YAML list dash in the same column reads as a deletion.

Below a `1px` Hairline rule, the six add steps in execution order, with any
step that will not run for the chosen type carrying the same `—` mark the
remove flow's report uses for `skipped`.

The panel is not a live region. It rewrites on every debounced keystroke, and
announcing a Caddyfile block that often would bury the field being typed into;
the one actionable thing in it — a rejection the submit would also make — is
announced by its own `role="status"` error instead.
```

- [ ] **Step 5: Update the surfaces list**

In `PRODUCT.md` → Operating Context → "Surfaces today", change the add-site clause to note the preview, and add `POST /sites/preview` to the route list:

```markdown
add-site as its own page (`GET /sites/new`, `POST /sites`), which shows the
exact Caddyfile block and tunnel route it is about to write in a panel beside
the form, fed by `POST /sites/preview` — a read-only endpoint that calls the
same writers the submit does, so the two cannot disagree
```

- [ ] **Step 6: Record the split in CLAUDE.md**

In `CLAUDE.md` → "Core v1 feature flow" → item 2, add after the first sentence:

```markdown
The page runs the 1080px frame and splits into a form column and a
what-gets-written panel; the panel is fed by `POST /sites/preview`, which calls
the same `appendSite` / `addIngressRule` / validators the submit does and
writes nothing. Validation lives in `src/lib/siteValidation.ts` and is shared
by both routes deliberately — a preview that can accept what the submit
rejects is worse than no preview.
```

- [ ] **Step 7: Re-derive DESIGN.md's machine-readable sidecar**

Run `/impeccable document` and choose a **scoped refresh**, not an overwrite. The prose in `DESIGN.md` records decisions a full re-derivation would rewrite in its own words; only `.impeccable/design.json` needs the new component and the `lg` breakpoint.

- [ ] **Step 8: Confirm the detector is clean**

Run: `node ~/.claude/plugins/cache/impeccable/impeccable/4.1.1/skills/impeccable/scripts/detect.mjs --json src/views`
Expected: `[]`

Scope to `src/views` only. `public/style.css` is gitignored Tailwind output, and pointing the detector at generated CSS produces findings that exist in no source file.

- [ ] **Step 9: Commit**

```bash
git add DESIGN.md PRODUCT.md CLAUDE.md .impeccable/design.json
git commit -m "docs: record the frame-and-column rule and the what-gets-written panel"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task:

| Spec requirement | Task |
|---|---|
| Exact text, provably identical to what gets written | 2 (diff from the real writers), 3 (route) |
| Contract above the button | 4 (panel beside the form) |
| Step list tells the truth | 2 (`willRun`), 4 (markup), 5 (`markSkips`) |
| Duplicate hostname caught before submit | 1 (`validateAgainstExisting`), 3 (route), 5 (render) |
| 1080 frame, two columns, `lg` collapse | 4 |
| Live composed headline | 4 (markup), 5 (`renderComposedHostname`) |
| Preview never writes | 3 (route has no `deps.commands` call; tested in Task 3 Step 1) |
| Fragments not whole files | 2 (`diffInserted` returns added lines only) |
| 200 for an incomplete form | 3 |
| Race handling | 5 (`previewSequence`) |
| Empty / error / narrow states | 4 (server-rendered empty), 5 (client states + manual pass) |
| Ember Edge branch rule preserved | 4 (asserted in test) |
| Width rule, breakpoint, Headline, component docs | 6 |
| Detail page untouched | Not in any task's file list, by design |

**Placeholder scan.** No `TBD`, no "add error handling", no "similar to Task N". Every code step carries the code. The one prose-only step is Task 6 Step 7, which is a command to run with a stated choice.

**Type consistency.** `SiteInput`, `SiteEnv`, and `Validation` are defined in Task 1 and consumed unchanged in Tasks 2 and 3. `SitePreview`'s field names (`caddy.added`, `tunnel.contextAfter`, `files.creates`, `steps[].willRun`) are identical in Task 2's definition, Task 3's tests, and Task 5's renderer. `getScaffoldFiles` returns `{ name, content }[]` in Task 2 and is read as `.map(f => f.name)` in the same task. `markSkips` takes the `{ id, willRun }` shape Task 2 produces. `FRAME_WIDTH` is defined in Task 4 Step 3 and used in Step 4.

**Two gaps found and closed while reviewing:**

1. Task 5 originally read `addSiteForm` before its declaration. Step 2 now says to move that `const` above the preview block.
2. Task 3's "creates no site directory" test called `fakeFs.exists`, which does not exist — `src/dev/fakes.ts` exposes `hasDir` and `hasFile`. Corrected to match the idiom the existing static-add test already uses.

**Verified against the real source while writing, not assumed:**

- `computePortOwners` (`src/routes/sites.ts:44-53`) already seeds both reserved ports, so the inline `#port-error` covers reserved ports *and* conflicts today. The preview's added coverage is the duplicate hostname, and nothing else.
- `STEP_MARKS.skipped` is already `"—"` in `public/app.js:75`, so Task 5 reuses the existing mark vocabulary instead of inventing a second one.
- `shell.ts:126` already sets `<main>` to `max-w-[1080px]`, so Task 4 takes the frame by *dropping* `DETAIL_WIDTH`, not by widening a container.
- `appendSite` produces `${trimmed}\n\n${block}` + `"\n"`, which is why `diffInserted`'s head walk is capped before the tail walk — without the cap, an append at end-of-file is misattributed and the block loses its closing brace.
