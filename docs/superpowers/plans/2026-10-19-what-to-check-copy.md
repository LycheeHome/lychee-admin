# "What to Check" Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Final wording and corrected commands for the site detail page's "What to check" entries and the shared failure line.

**Architecture:** String changes in `src/views/html.ts` — a small state-phrase mapping used by `hopFixes`, new sentences and commands in `hopFixes` and `failureLine`, and a recovery sentence appended only by `hopFixes` — then the docs that quote the old commands.

**Tech Stack:** TypeScript, server-rendered HTML, Node's built-in test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-what-to-check-copy-design.md`

## Global Constraints

- Phrases, verbatim: `exited` → "has stopped"; `restarting` → "keeps restarting"; `paused` → "is paused"; `unhealthy` → "is running but failing its health check"; any other word → "is <word>".
- Sentences and commands are the spec's "Entries" section, verbatim.
- Reconciler command, verbatim: `journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"`. Container command: `docker compose -p <resource> logs --tail 100`.
- Recovery sentence, verbatim, in "What to check" only (never in `failureLine`, so never on the services board): "To recover, publish a fixed tag; From a repository below offers it to deploy."
- Command ids unchanged: `cmd-fix-tunnel`, `cmd-fix-caddy`, `cmd-reconcile-log`, `cmd-logs`, `cmd-fix-listen`.
- `escapeHtml` turns `"` into `&quot;`, so rendered markup contains `--since &quot;1 hour ago&quot;`; the copy button reads `textContent`, which decodes it. Tests match the escaped form.
- Edit `src/views/*.ts` only with Edit/Write — never shell, sed or a script.
- Verification: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **The "is <word>" fallback** — a word outside the four (e.g. `unknown` reaching the mapping through a future state) must still read grammatically, not `undefined`. → test "an unmapped word falls back to is <word>" (call the mapping directly if exported for test, otherwise via a container status the type allows; if neither is reachable, assert the mapping's fallback through a unit test of the function by exporting it from html.ts as `statePhrase` — module-level, not re-exported from an index).
2. **A failed first deploy with no target** — the line reads "The last deploy failed…" and still shows the two-unit command and the recovery sentence. → test "a failed deploy with no target still offers recovery".
3. **Both a bad unit and a failed deploy at once** — each entry keeps its own phrase and command; no copy leaks between them. → covered by extending the existing request-order test to assert each entry's phrase.
4. **The services board** keeps working copy for a failed row with no `failedStep`. → existing board tests updated to the new sentence; no new test.
5. **The escaped quotes** in the reconciler command — the markup must not contain a raw `"1 hour ago"` inside an attribute. → assert the `<pre id="cmd-reconcile-log">` content contains `&quot;1 hour ago&quot;`.

---

### Task 1: Clarify the copy and fix the commands

**Files:**
- Modify: `src/views/html.ts` — `hopFixes` (~388-430), `failureLine` (~906-920)
- Modify: `CLAUDE.md:127` (the site-detail paragraph), `DESIGN.md:909`, `DESIGN.md:1034`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Produces: `export function statePhrase(word: string): string` in `src/views/html.ts` (exported only so tests can pin the fallback; nothing else imports it).

- [ ] **Step 1: Write the failing tests**

In `src/views/html.test.ts` (helpers `requestPath`, `whatToCheck`, `BASE`, `RESOURCE`, `RUNNING_RESOURCE` already exist):

- "each bad state reads as a phrase" — `statePhrase("exited") === "has stopped"`, `"restarting"` → `"keeps restarting"`, `"paused"` → `"is paused"`, `"unhealthy"` → `"is running but failing its health check"`.
- Review Focus 1, "an unmapped word falls back to is <word>" — `statePhrase("unknown") === "is unknown"`.
- "the tunnel and Caddy entries use the phrase" — `PROXY_SITE`, `status: { kind: "tcp", responding: true }`, units `cloudflared-sites.service: restarting`, `caddy.service: exited`; `whatToCheck` contains "The sites tunnel keeps restarting, so Cloudflare has nowhere to send this site's requests." and "Caddy has stopped. Every site on lychee goes through it, so all of them are down, not only this one." and twice "Its last 50 log lines usually show why:".
- "the container entry uses the phrase and a bounded log command" — `NEXT_SITE`, `resource: RUNNING_RESOURCE`, `status: { kind: "container", state: "running", health: "unhealthy" }`; `whatToCheck` contains "The container is running but failing its health check. Its last 100 log lines usually show why:" and `docker compose -p app-lychee-land logs --tail 100`.
- "a failed first deploy points at both reconciler units for the last hour, then recovery" — `{ ...BASE, resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" }, status: { kind: "failed" } }`; `whatToCheck` contains "The reconciler retries this tag on every run; its log for the last hour shows each attempt:", `journalctl -u lychee-reconcile -u lychee-reconcile-app --since &quot;1 hour ago&quot;` (Review Focus 5: inside the `id="cmd-reconcile-log"` pre), and "To recover, publish a fixed tag; From a repository below offers it to deploy." after the command.
- Review Focus 2, "a failed deploy with no target still offers recovery" — same without `target`; contains "The last deploy failed", the two-unit command and the recovery sentence.
- "the plain-proxy entry says how to read the listen check" — `PROXY_SITE`, `status: { kind: "tcp", responding: false }`; `whatToCheck` contains "lychee-admin only routes requests to this port; whatever serves it is started outside the app. This shows what is listening there, and prints only its header row if nothing is:".
- "the services board's failure line has the new command and no recovery sentence" — reuse the board helper used by the existing failed-row tests (`offerBoard({ version: "v1.4.0", target: "v1.5.0", result: "failed" })`); contains the two-unit command and the new journal sentence; does not contain "To recover".
- "no entry overpromises" — for the pages built in the tests above, `whatToCheck` contains neither "says why" nor "isn't running".
- Review Focus 3: extend the existing "entries run in request order" test (both units `exited`, proxy not responding) to assert "The sites tunnel has stopped" and "Caddy has stopped" are present.
- Update existing assertions that quoted old sentences ("Its journal says why", "Check the container's logs to see why", "The reconciler's journal has the whole run", "check that it's started and listening") to the new copy; the `journalctl -u lychee-reconcile` and `docker compose -p app-lychee-land logs` regexes may stay (they still match as prefixes) unless a test asserts the whole command.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -40`
Expected: failures on `statePhrase` (not exported) and on every new sentence/command.

- [ ] **Step 3: Implement**

- `statePhrase(word: string): string` — the four-entry mapping, fallback `is ${word}`.
- `hopFixes`: tunnel and Caddy sentences per the spec using `statePhrase(rowLabels(opts.unitStates[unit]!.status).pill)`; container sentence using `statePhrase(describeStatus(status).pill)` and `logs --tail 100`; plain-proxy sentence per the spec; after `failureLine(...)` in the failed branch append `<p class="${STEP_TEXT} !mb-0">To recover, publish a fixed tag; From a repository below offers it to deploy.</p>`.
- `failureLine`: replace "The reconciler's journal has the whole run:" with "The reconciler retries this tag on every run; its log for the last hour shows each attempt:" and the command with the two-unit, last-hour command (unchanged id and copy label).
- Update `hopFixes`' doc comment if it names a command that changed.

- [ ] **Step 4: Update the docs**

- `CLAUDE.md:127`: the "What to check" sentence's commands become `docker compose -p <label>-lychee-land logs --tail 100`, and the failed-first-deploy failure line's command becomes `journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"` wherever the paragraph quotes `journalctl -u lychee-reconcile` as the page's command. Nothing else in the file changes.
- `DESIGN.md:909` and `DESIGN.md:1034`: the quoted `journalctl -u lychee-reconcile` Command Block becomes the two-unit, last-hour command.
- Run: `grep -rn 'journalctl -u lychee-reconcile`\|says why\|isn.t running' CLAUDE.md DESIGN.md PRODUCT.md .impeccable/design.json` → Expected: no match that describes this page's command or copy (Observability prose naming `lychee-reconcile.service -u lychee-reconcile-app.service` is fine).

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build` → Expected: all pass.
Run: `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` → Expected: `[]`.
Screenshots: `PORT=8799 npm run dev:mock` in the background; full-page 1280px screenshots of `/sites/broken.lychee.land` and `/sites/api.lychee.land` to `.playwright-mcp/after-copy-<name>.png`; confirm the new sentences render and wrap cleanly; stop the server.

```bash
git add src/views/html.ts src/views/html.test.ts CLAUDE.md DESIGN.md
git commit -m "copy: final what-to-check wording; both reconciler units, bounded logs"
```
