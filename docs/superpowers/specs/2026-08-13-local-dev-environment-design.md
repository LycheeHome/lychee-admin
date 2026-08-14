# Local development environment

## Problem

`lyly-admin` cannot run anywhere except `lychee`. `GET /` calls
`fs.readFileSync(config.caddyfilePath)` (`src/routes/sites.ts:52`), which is
`/etc/caddy/Caddyfile` — absent on a dev machine, so the first page load
throws `ENOENT` and returns a 500. Every mutating flow then shells out to
`sudo /usr/bin/systemctl`, `sudo /usr/bin/caddy`, and the wrapper scripts in
`deploy/`, none of which exist off-host either.

`src/lib/exec.ts:17` has a `MOCK_SYSTEM` escape hatch documented for exactly
this purpose, but it only stubs the seven privileged commands. The fifteen
remaining `fs.*` call sites — six reads, four writes, and one recursive
delete in `src/routes/sites.ts`, two in `src/lib/backup.ts`, two in
`src/lib/logger.ts` — still demand real files at real absolute paths. The
flag has therefore never been sufficient on its own.

Separately, the repository has no test runner and no test script. The
parsing and config-editing logic in `src/lib/caddyfile.ts` and
`src/lib/tunnelConfig.ts` — brace-counting block splitting, raw-string block
removal, YAML ingress insertion before the catch-all — is verified only by
clicking through the UI on the live host, or by throwaway `npx tsx -e`
snippets that are discarded afterwards (a practice noted in
`docs/superpowers/plans/2026-08-10-nextjs-framework-scaffold.md:13`).

## Goal

`npm run dev:mock` runs the complete app on macOS or Windows with no sudo, no
systemd, no Caddy, no `cloudflared`, and no fixture files on disk — including
the add-site and remove-site flows, so UI work on those modals can be done
locally instead of on `lychee`.

This is achieved by deleting the `MOCK_SYSTEM` flag and replacing it with
dependency injection: two narrow interfaces (privileged commands, and the
filesystem) with real implementations wired into the production entry point
and fake implementations wired into a dev-only entry point that is excluded
from both the build output and the deploy rsync.

The refactor is accompanied by the repository's first test suite, sequenced
so that it proves behavior survived the rewrite rather than merely
describing the result.

## Design

### `src/lib/systemCommands.ts` (new)

Exports a `SystemCommands` interface and a `realSystemCommands` object
implementing it. Six methods, carrying over the current bodies of
`src/lib/exec.ts` verbatim with the `if (MOCK_SYSTEM)` branch stripped from
each:

| Method | Current source |
| --- | --- |
| `validateCaddyfile(caddyfilePath)` | `exec.ts:44` |
| `reloadCaddy()` | `exec.ts:51` |
| `restartCloudflared()` | `exec.ts:64` |
| `createSiteDirectory(hostname)` | `exec.ts:85` |
| `writeManagedConfig(targetPath, content)` | `exec.ts:100` |
| `checkContainerStatus(hostname)` | `exec.ts:135` |

`CommandError` and the private `run()` helper move here unchanged. The
existing doc comments — which explain *why* each command is shaped the way
it is (sudoers scope, `cloudflared-sites` vs `cloudflared`, why
`createSiteDirectory` takes only a hostname) — move with their functions.
Those comments are the main documentation of the sudo boundary and must not
be lost in the move.

`src/lib/exec.ts` is deleted once emptied.

### `caddyStatus` is deleted, not ported

`exec.ts:71` exports `caddyStatus()`, which is called from nowhere in `src/`
or `public/`. It is dead code. Since this spec restructures the file it
lives in, it is removed rather than carried into the new interface. Its
sudoers entry (`systemctl status caddy`) is left alone in
`deploy/sudoers.example` — narrowing production sudo scope is a host-config
change with its own verification needs and does not belong in a dev-tooling
change.

### `src/lib/fileSystem.ts` (new)

Exports a `FileSystem` interface and a `realFileSystem` object that is a thin
pass-through to `node:fs`. Six methods, covering exactly the operations the
fifteen surviving call sites use:

| Method | Replaces |
| --- | --- |
| `readFile(path): string` | `fs.readFileSync(p, "utf8")` |
| `writeFile(path, content): void` | `fs.writeFileSync` |
| `mkdir(path): void` | `fs.mkdirSync(p, { recursive: true })` |
| `appendFile(path, content): void` | `fs.appendFileSync` |
| `copyFile(src, dest): void` | `fs.copyFileSync` |
| `rmRecursive(path): void` | `fs.rmSync(p, { recursive: true, force: true })` |

All methods are synchronous, matching current usage exactly. Making them
async would ripple into `logAction` and `backupFile`, which are called from
synchronous positions inside async route handlers, and would change error
timing in the rollback paths. Synchronous is the faithful translation.

`mkdir` is always recursive and `rmRecursive` always forces, because that is
what every existing call site passes. The options are not parameterized.

### `src/lib/backup.ts` and `src/lib/logger.ts`: factories

Both modules currently import `config` and call `fs` directly at module
scope. Both become factories taking a `FileSystem`:

- `createBackup(fs: FileSystem)` returns `{ backupFile }`
- `createLogger(fs: FileSystem)` returns `{ logAction }`

A factory is used rather than threading an extra parameter through every
`logAction(...)` call because the audit log is written from eleven places in
`src/routes/sites.ts`, and an extra argument at each would be pure noise.
The `AuditEntry` type stays exported from `logger.ts` as-is.

Neither module's behavior changes. `backupFile` still returns the backup
path; `logAction` still writes one JSON line with an ISO timestamp.

### `src/routes/sites.ts`: router factory

The exported `sitesRouter` const is replaced by an exported
`createSitesRouter(deps: Deps): Router` function. `Deps` is declared and
exported from `src/app.ts`, alongside the `createApp` that consumes it, so
the two entry points and the tests all import the shape from one place. It
bundles the two interfaces plus the two factory products:

```ts
interface Deps {
  commands: SystemCommands;
  fs: FileSystem;
  backup: ReturnType<typeof createBackup>;
  logger: ReturnType<typeof createLogger>;
}
```

Every `fs.readFileSync(...)` becomes `deps.fs.readFile(...)`, every
`await reloadCaddy()` becomes `await deps.commands.reloadCaddy()`, and so on.
No control flow, ordering, validation, or error handling changes. The
fail-closed ordering, the `caddyReloaded` guard on rollback, the two-request
file-deletion split, and every existing comment explaining them stay exactly
as they are.

`config` remains a module-level singleton import. Injecting it would enlarge
the diff without serving anything in this spec; it is recorded as out of
scope below.

### `src/app.ts` (new) and the two composition roots

`createApp(deps: Deps): express.Express` contains everything
`src/server.ts` does today except `listen` — the `urlencoded` parser,
`basicAuth`, the static mount, and the sites router.

Two entry points then compose it:

- **`src/server.ts`** (production, unchanged filename) builds the real
  implementations and listens on `config.host`/`config.port`. The compiled
  output stays `dist/server.js`, so `package.json`'s `main`, the `start`
  script, `deploy/lyly-admin.service`, and the CI health check all keep
  working with no change.
- **`src/dev/server.ts`** (new) builds the fakes, applies the seed, and
  listens.

This is the central safety property of the design. Today `MOCK_SYSTEM` is an
environment variable that a misconfigured production host *could* be told to
honor. Afterwards, mock behavior is unreachable from `src/server.ts` because
the fakes are only ever imported by `src/dev/server.ts` — which, per the
exclusions below, is not even present on `lychee`. The failure mode is
removed rather than guarded.

### `src/dev/fakes.ts` (new)

Exports `createFakes()` returning `{ commands, fs }` that share one
in-memory state object, since `fakeSystemCommands.createSiteDirectory` must
create its directory inside the same store the fake filesystem reads from.

`inMemoryFileSystem` holds a `Map<string, string>` of file contents and a
`Set<string>` of directory paths. `rmRecursive(p)` drops every map key and
set entry under the `p/` prefix as well as `p` itself.

`fakeSystemCommands` returns the same shapes the current `MOCK_SYSTEM`
branches return: `{ stdout: "[mock] ...", stderr: "" }` for the four
command methods, a resolved promise for `writeManagedConfig` after writing
through to the in-memory filesystem, and `{ state: "running", health:
"healthy" }` for `checkContainerStatus`.

### Path normalization in the in-memory filesystem

`src/routes/sites.ts:133` builds `sitePath` with `path.posix.join`, while
`computeFilesPath` (`src/lib/caddyfile.ts:129`) also uses `path.posix.join`
but `src/routes/sites.ts:181` joins the filename on with native
`path.join`. Against a real filesystem this is cosmetic — on Windows both
`a/b` and `a\b` resolve to the same location.

Against a `Map`, they are two distinct keys. The same site would silently
exist twice on Windows: written under one spelling, looked up under another.

Every path entering `inMemoryFileSystem` is therefore normalized by
collapsing runs of `/` and `\` to a single `/` and stripping any trailing
separator, before it is used as a key. This is a property of the fake only;
the source-level inconsistency in `routes/sites.ts` is left alone and
recorded as out of scope.

### `src/dev/seed.ts` (new)

Exports the initial Caddyfile and tunnel-config contents as template
literals, written into the in-memory filesystem at `config.caddyfilePath`
and `config.tunnelConfigPath` before the dev server listens. Since the paths
are now just map keys, `config`'s existing production defaults
(`src/config.ts:20-31`) are used unchanged — no path environment variables
are needed for dev.

The Caddyfile seed covers every branch `parseSites` has:

```
{
	auto_https off
}

http://lyly.dev {
	root * /var/www/lyly.dev
	file_server
}

http://blog.lyly.dev {
	root * /var/www/blog.lyly.dev
	file_server
}

http://api.lyly.dev {
	reverse_proxy localhost:4000
}

http://app.lyly.dev {
	# lyly-admin-framework: nextjs
	# lyly-admin-healthcheck: /api/health
	reverse_proxy localhost:3000
}

http://lychee.local {
	root * /var/www/lychee.local
	file_server
}
```

That is: the apex domain, a static subdomain, a plain reverse proxy, a
Next.js site carrying both marker comments, and one deliberately unmanaged
block. `lychee.local` exists so the `isManagedHostname` filter at
`src/routes/sites.ts:53` is exercised on every page load rather than
assumed — it must never appear in the site list. The global `auto_https off`
block is included because the real Caddyfile has one and `splitBlocks` must
skip it.

Ports 4000 and 3000 are chosen to leave 8787 (`config.port`) and 2019 (the
Caddy admin API) free, so the reserved-port rejection at
`src/routes/sites.ts:149-152` can be triggered by hand in the browser.

The tunnel seed carries matching ingress rules for the four `lyly.dev`
hostnames plus the trailing catch-all `service: http_status:404`, and
deliberately no rule for `lychee.local`, which is not tunnel-managed.

### `src/dev/env.ts` (new) and dev credentials

`src/config.ts:15-16` calls `required()` for `ADMIN_USERNAME` and
`ADMIN_PASSWORD_HASH` at module evaluation time, so the dev entry point must
populate `process.env` before `config` is imported. Because `import`
declarations are hoisted, this cannot be done with a statement inside
`src/dev/server.ts`.

`src/dev/env.ts` is therefore a side-effect module, imported first in
`src/dev/server.ts`, that assigns `ADMIN_USERNAME=dev` and a hard-coded
bcrypt hash of the password `dev` if and only if those variables are unset.
Import order between separate modules is sequential, so this runs before
`config` is evaluated.

Committing a bcrypt hash is deliberate and safe here: it is a known
throwaway credential for an app that binds `127.0.0.1`, it lives in a
directory excluded from both the build and the deploy, and production reads
its own `.env` through the untouched `src/server.ts` path. The file carries
a comment saying so. `.env`, `.env.example`, and the production credential
flow are not modified.

### `src/lib/portStatus.ts` is left alone

`checkPortOpen` opens a real TCP socket to `127.0.0.1:<port>`
(`src/lib/portStatus.ts:3`). It is neither a privileged command nor a
filesystem operation, so it falls outside both interfaces and is not
injected.

The consequence is a known and accepted dev-mode limitation: the detail page
for the seeded plain reverse-proxy site, `api.lyly.dev`, performs a genuine
connection attempt against port 4000 on the dev machine, which will normally
be closed, so its status renders as not responding. That is honest rather
than misleading, and the Next.js site's status comes from
`checkContainerStatus`, which *is* faked, so the container-status card still
demonstrates its healthy state. Injecting the port check would enlarge the
interface surface for no gain in this design.

### Build and deploy exclusions

Two layers are required, because CI ships source as well as build output.

`tsconfig.json` keeps `"include": ["src"]`, so WebStorm and
`npm run typecheck` continue to cover `src/dev/` and the test files. A new
`tsconfig.build.json` extends it with
`"exclude": ["src/dev", "**/*.test.ts"]`, and `package.json`'s `build`
script switches from `tsc -p tsconfig.json` to `tsc -p tsconfig.build.json`.
CI therefore still type-checks the dev code (`deploy.yml:24`) without
emitting it (`deploy.yml:25`).

`.github/workflows/deploy.yml:39-41` currently excludes only `.git`,
`.env`, and `node_modules` from the rsync, so `src/dev/*.ts` would land on
`/opt/lyly-admin` as inert source. `--exclude='src/dev'` and
`--exclude='*.test.ts'` are added. The existing `--delete` flag means any
previously synced copies are removed on the next deploy.

`npm run lint` (`eslint src`) intentionally keeps covering both.

### Tests: sequencing

The four pure modules — `caddyfile.ts`, `tunnelConfig.ts`,
`containerStatus.ts`, `frameworkScaffold.ts` — are string-in/string-out and
are **not modified** by this refactor. Tests over them are worth having but
protect none of the work. Everything that actually changes is in
`routes/sites.ts`, `backup.ts`, `logger.ts`, and the `exec.ts` split.

Route tests are therefore written **before** the refactor, against the
current code, and migrated afterwards:

1. **Phase 1.** Write `src/routes/sites.test.ts` against today's
   implementation, using a per-test directory under `os.tmpdir()` for the
   Caddyfile, tunnel config, sites root, backup dir, and log file, with
   `MOCK_SYSTEM=true` set so the privileged commands stub out. Confirm green.
2. **Phase 2.** Perform the refactor.
3. **Phase 3.** Re-point the same tests at `createFakes()` and
   `createApp(deps)`. Assertions and request-driving are unchanged; only the
   fixture wiring is swapped. Confirm still green.

Green in both phase 1 and phase 3 is the evidence that behavior survived.
Without this ordering the tests would only describe the post-refactor
result.

One mechanical constraint on phase 1: `src/config.ts` reads `process.env`
at module evaluation, and `import` declarations hoist above statements, so a
test file cannot assign its temp paths and then statically import the route
module. Phase-1 tests set `process.env` at the top of the file and then pull
the module in with `await import("./sites")`. Node's test runner isolates
each test file in its own process, so the `config` singleton is fresh per
file and the temp paths do not leak between them.

This constraint disappears in phase 3. Once paths are only keys into the
in-memory filesystem, the tests construct `deps` directly and need no
environment manipulation and no dynamic import at all — which is itself a
small demonstration that the refactor achieved what it set out to.

### Tests: coverage

Route tests drive a real server via `app.listen(0)` and global `fetch`. No
`supertest` or other new dependency.

Happy paths:

- `GET /` lists the four managed hostnames and omits `lychee.local`
- `POST /sites` static — Caddyfile block, ingress rule, site directory, and
  placeholder `index.html` all created
- `POST /sites` reverse proxy with `framework=nextjs` — scaffold files
  written, both marker comments present in the block
- `POST /sites` rejects a port already claimed by another reverse-proxy site
- `POST /sites/:hostname/delete` — block and ingress rule both removed
- `POST /sites/:hostname/delete-files` — directory removed

Rollback, one case per mutating flow. Both are forced through genuine input
conditions rather than fake-specific machinery, so they run identically in
phase 1 and phase 3:

- **Add:** seed a tunnel config with no `ingress` key. `addIngressRule`
  throws at step 4, after the Caddyfile has been written and before
  `caddy validate`. Assert a 500 and assert the Caddyfile content is
  byte-identical to its pre-request state.
- **Remove:** remove a hostname present in the Caddyfile but absent from the
  tunnel config. `removeIngressRule` throws for the same reason. Assert a
  500 and an unchanged Caddyfile.

Pure-module tests, colocated as `src/lib/*.test.ts`:

- `caddyfile.test.ts` — `parseSites` across all four block shapes;
  `appendSite` for static, plain proxy, and framework variants; `removeSite`
  including its blank-line collapsing and its throw on an unknown hostname;
  `hostnameExists`; `computeFilesPath` for all three outcomes
- `tunnelConfig.test.ts` — insertion before the catch-all, insertion when no
  catch-all exists, duplicate-hostname throw, removal throw on a missing
  hostname, and the missing-`ingress` parse throw
- `containerStatus.test.ts` — `parseComposePsOutput` across the states it
  recognizes
- `frameworkScaffold.test.ts` — the generated compose file binds
  `127.0.0.1:<port>:3000`, the Dockerfile `HEALTHCHECK` carries the supplied
  path, and an unknown framework returns `null`

These characterize current behavior. If one surfaces a genuine bug, it is
recorded as a follow-up rather than fixed here, so the refactor's before/
after comparison stays honest.

### `package.json` scripts

- `dev:mock` — mirrors the existing `dev` script but runs
  `tsx watch src/dev/server.ts`, keeping the same `concurrently` pairing with
  the Tailwind watcher
- `test` — `tsx --test`, with no path arguments. `tsx` resolves the
  extensionless relative imports the codebase uses, which bare
  `node --test` rejects under its ESM-strict TypeScript resolution; passing
  no glob avoids shell-expansion differences between zsh and Windows `cmd`
- `build` — retargeted to `tsconfig.build.json`

`dev`, `build:css`, `start`, `typecheck`, and `lint` are unchanged. No
dependency is added or removed; `tsx` is already a devDependency and Node 24
runs the TypeScript test files through it.

### `.gitignore`

The `dev-fixtures/` entry (line 6) is removed. It was reserved for an
on-disk fixture approach that this design supersedes; nothing writes to that
path.

### Documentation updates

`README.md`'s "Local development" section is rewritten to lead with
`npm run dev:mock` as the way to run the app off-host, note that it needs no
`.env` and no fixture files, and document `npm test`.

`CLAUDE.md` gains: the two composition roots and what each wires up; the
fact that `src/dev/` and `*.test.ts` ship to neither `dist/` nor `lychee`;
that `MOCK_SYSTEM` is gone and mock behavior is now unreachable from the
production entry point; and the test commands. The existing "Critical
safety/security constraints" section is unchanged — every constraint in it
still holds, and the production code path through `realSystemCommands` is
byte-for-byte the current behavior.

### Out of scope

- **Injecting `config` into `Deps`.** It stays a module-level singleton.
  Nothing in this design needs it, and it would touch every module again.
- **Persisting in-memory state across restarts.** `tsx watch` restarts on
  any `src/` change, including `views/html.ts`, so a manually added site is
  lost on every UI edit. Accepted deliberately: a deterministic starting
  state each reload is reasonable, and the seed is rich enough that adding a
  site by hand is rarely necessary. Revisit only if it proves annoying.
- **Exhaustive route failure-branch tests.** One rollback case per flow is
  covered, plus the `caddyReloaded` guard itself (a fake with a rejecting
  `restartCloudflared`, asserting the add-site request fails but the
  Caddyfile is *not* restored — the state that guard exists to protect once
  Caddy has already reloaded). The rollback-failed branches
  (`src/routes/sites.ts:224-234` and `296-306`), where the restore write
  itself fails, remain uncovered.
- **Fixing the `path.posix.join` / `path.join` inconsistency at its source**
  in `routes/sites.ts`. The fake normalizes instead. Changing the real path
  construction would alter displayed paths in production and deserves its
  own change.
- **Docker-based integration testing of the sudo and wrapper-script layer.**
  Sudoers scope, the wrapper scripts' own hostname validation,
  `web:webdeploy` ownership, and real `caddy validate` behavior remain
  verifiable only on `lychee`. No local mock can cover them, and this design
  does not pretend otherwise.
- **Narrowing `deploy/sudoers.example`** to drop the now-unused
  `systemctl status caddy` entry.
