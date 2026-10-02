# Service Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lyly-admin` shows what runs on `lychee` — the reconciler, four hostless services, and the shared infrastructure every site runs through — without gaining any new privilege.

**Architecture:** Two sources with different freshness. `lychee-ops` publishes one normalised inventory to a world-readable path each tick, carrying the *declared* set and its deploy state. `lyly-admin` reads that file and pairs it with live unit state from a single privilege-free `systemctl show` call. Neither source alone can report "declared but not running", which is the case the page exists for.

**Tech Stack:** Ansible (`lychee-ops`), TypeScript + Express + server-rendered HTML (`lyly-admin`), `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-02-service-observability-design.md`

**Repos:** Task 1 is in `~/WebstormProjects/personal/lychee-ops`. Tasks 2–6 are in `~/WebstormProjects/personal/lyly-admin`. They are independent — Task 1 is verifiable on the host with `cat` before any app code exists.

## Global Constraints

- **No new sudo scope.** `lyly-admin`'s eight pinned commands in `lychee-ops`' `roles/lyly_admin_host/files/sudoers.example` are not touched by any task.
- **No new group membership.** `lyly-admin` stays in `webdeploy` only.
- **Use `systemctl show`, never `systemctl status`.** `status` renders journal lines and needs journal access; `show` and `is-active` are world-readable. Verified on the host 2026-10-02: `sudo -u lyly-admin systemctl is-active swee palsave-api palworld-palchuds caddy` returns four `active`.
- **One `systemctl` invocation per page render**, passing all units at once — not one per service. The hostname dropdown deliberately does not status-check because it would cost N calls per view; this stays at one.
- **Inventory path:** `/var/lib/lychee-inventory/services.json`, `root:root 0644`, in a `root:root 0755` directory.
- **Per-service `deploy-status.json` files do not move.** Every recovery path in `CLAUDE.md` keeps working.
- **The inventory carries no secrets** — commit SHAs, tags, timestamps, result strings, gate messages. It is `0644` deliberately.
- **Status vocabulary is the existing canonical set**, shared with the header pill and the request chain: `running`, `unhealthy`, `starting`, `exited`, `restarting`, `paused`, `not deployed`, `unknown`, `responding`, `not responding`. `starting` and `unknown` are neutral, not red. Do not add a value.
- **Degrade, never error.** Every missing or unreadable source renders a neutral state and leaves the rest of the page intact, following `readTunnelId()`'s precedent.

## Review Focus

Input classes the spec implies that no task's happy path exercises. Each has its test pinned to the task that owns the code.

1. **Inventory file absent** — `lychee-ops` has not shipped, or the reconciler has never run. `fs.readFile` throws `ENOENT`. The page must render liveness only and say the inventory is unavailable. *(Task 2)*
2. **Inventory present but malformed** — truncated mid-write, or hand-edited. `JSON.parse` throws. Same degradation as absent, not a crash. *(Task 2)*
3. **A unit in the inventory that `systemctl` does not know** — service declared but never installed. `systemctl show` emits `ActiveState=inactive` with `LoadState=not-found` rather than failing. Must read `unknown`, not `exited`. *(Task 3)*
4. **`systemctl` unavailable entirely** — binary missing in a container, or the spawn fails. Every row degrades to `unknown`; deploy state still renders. *(Task 3)*
5. **A unit present on the host but absent from the inventory** — drift. Must not throw and must not be silently dropped; the pairing is driven by the inventory, so an unknown unit simply has no row, and the test pins that it does not crash the join. *(Task 4)*

---

### Task 1: `lychee-ops` publishes the inventory

**Repo:** `~/WebstormProjects/personal/lychee-ops`

**Files:**
- Create: `roles/inventory/defaults/main.yml`
- Create: `roles/inventory/tasks/main.yml`
- Create: `roles/inventory/templates/services.json.j2`
- Modify: `playbook.yml`
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Produces: `/var/lib/lychee-inventory/services.json` on the host, with the shape fixed in Step 3. Task 2 parses exactly this.

**A refinement on the spec, applied here deliberately.** The spec fixes three groups but its example schema has no field naming them. Rather than have the app hardcode which unit belongs to which group, each entry carries `group`, one of `reconciler`, `service`, `infrastructure`. That keeps the app fully data-driven: adding a service later is a reconciler change with no app release, which is the same property the spec argues for when it chooses one combined file over per-service files.

- [ ] **Step 1: Declare the service list**

Create `roles/inventory/defaults/main.yml`:

```yaml
---
# The declared set: what should be running on this host, in the order the
# page shows it. An entry with no status_file is one nothing deploys —
# it still gets a row, because "running, and nothing deploys this" is a
# state worth seeing rather than an omission.
#
# Adding a service here is the whole change. lyly-admin reads this list
# through the rendered inventory and hardcodes no unit name, so a fourth
# service needs no app release.
inventory_dir: /var/lib/lychee-inventory

inventory_services:
  # Both units, because they answer different halves of "is the reconciler
  # alive": the timer carries the schedule (last fired, next due), the service
  # carries the outcome of the run it triggered. The page composes them into
  # one block; the inventory stays a flat declared set.
  - name: lyly-reconcile-timer
    unit: lyly-reconcile.timer
    group: reconciler
  - name: lyly-reconcile
    unit: lyly-reconcile.service
    group: reconciler
  - name: lyly-admin
    unit: lyly-admin.service
    group: service
    status_file: /var/lib/lyly-admin/deploy-status.json
  - name: swee
    unit: swee.service
    group: service
    status_file: /var/lib/swee/deploy-status.json
  - name: palsave-api
    unit: palsave-api.service
    group: service
    status_file: /var/lib/palsave-api/deploy-status.json
  - name: palworld
    unit: palworld-palchuds.service
    group: service
  - name: caddy
    unit: caddy.service
    group: infrastructure
  - name: cloudflared-sites
    unit: cloudflared-sites.service
    group: infrastructure
```

- [ ] **Step 2: Write the tasks**

Create `roles/inventory/tasks/main.yml`:

```yaml
---
# Publishes one normalised inventory of what should be running on this host,
# for lyly-admin to read. Deliberately a published file rather than something
# the app reads with privilege: deploy state only changes when this reconciler
# writes it, so its freshness is bounded by the tick by construction and a
# privileged reader would buy nothing. See
# lyly-admin/docs/superpowers/specs/2026-10-02-service-observability-design.md.
#
# Runs after the three app roles, so the file reflects THIS tick's outcome
# rather than the previous one. Tagged [app] for the same reason they are:
# with --skip-tags app the status files are not refreshed, and republishing
# an inventory assembled from stale reads would be worse than leaving the
# previous one in place.

- name: Ensure the inventory directory exists
  ansible.builtin.file:
    path: "{{ inventory_dir }}"
    state: directory
    owner: root
    group: root
    mode: "0755"

# failed_when: false, not ignore_errors: a service that has never deployed has
# no status file, and that is an ordinary state rather than an error. The
# rendered entry falls back to reconciled: false, which is also what an entry
# with no status_file declared produces.
- name: Read each declared service's deploy status
  ansible.builtin.slurp:
    src: "{{ item.status_file }}"
  loop: "{{ inventory_services | selectattr('status_file', 'defined') | list }}"
  loop_control:
    label: "{{ item.name }}"
  register: inventory_status_raw
  failed_when: false

- name: Index the deploy statuses by service name
  ansible.builtin.set_fact:
    inventory_status_by_name: >-
      {{ inventory_status_by_name | default({})
         | combine({ item.item.name: (item.content | b64decode | from_json) }) }}
  loop: "{{ inventory_status_raw.results }}"
  loop_control:
    label: "{{ item.item.name }}"
  when: item.content is defined

- name: Write the inventory
  ansible.builtin.template:
    src: services.json.j2
    dest: "{{ inventory_dir }}/services.json"
    owner: root
    group: root
    mode: "0644"
```

- [ ] **Step 3: Write the template**

Create `roles/inventory/templates/services.json.j2`:

```jinja
{% set entries = [] %}
{% for s in inventory_services %}
{%   set st = (inventory_status_by_name | default({})).get(s.name, {}) %}
{%   set base = {'name': s.name, 'unit': s.unit, 'group': s.group, 'reconciled': st | length > 0} %}
{%   if st | length > 0 %}
{%     set _ = entries.append(base | combine({
         'version': st.installed_tag | default((st.installed_commit | default(''))[:7]),
         'commit': st.installed_commit | default(''),
         'result': st.result | default('unknown'),
         'gate': st.gate | default(''),
         'last_run': st.last_run | default(''),
         'failed_attempts': st.failed_attempts | default(0),
       })) %}
{%   else %}
{%     set _ = entries.append(base) %}
{%   endif %}
{% endfor %}
{{ {'generated': ansible_date_time.iso8601, 'services': entries} | to_nice_json }}
```

`version` resolves a tag where there is one and a seven-character SHA otherwise, because `lyly-admin` tracks tip-of-main and has no tag while `swee` and `palsave-api` are pinned. The app does not branch on which model a service uses; the producer resolves it.

- [ ] **Step 4: Register the role**

In `playbook.yml`, add after the `palsave_api_app` entry and before the trailing `tasks:` block:

```yaml
    # inventory, last of the app-tagged roles: it reads the status files the
    # three above write, so it must run after all of them or it publishes the
    # previous tick's state. Tagged [app] for the same reason they are — with
    # --skip-tags app there is nothing fresh to assemble.
    - { role: inventory, tags: [app] }
```

- [ ] **Step 5: Write the render test**

In `tests/test_swee_decide.yml`, append a play following the shape of the existing `palsave-api's unit renders the paths it is given` play — synthetic fixtures, whole-body compare, hand-written expected literal.

```yaml
- name: the inventory renders the declared set and folds in deploy status
  hosts: localhost
  gather_facts: false
  # Synthetic fixtures throughout: this asserts the template's shape, not the
  # host's real services. ansible_date_time is stubbed so the body is stable.
  vars:
    ansible_date_time:
      iso8601: "2026-01-01T00:00:00Z"
    inventory_services:
      - { name: with-status, unit: with-status.service, group: service, status_file: /rendertest/a.json }
      - { name: tagless, unit: tagless.service, group: service, status_file: /rendertest/b.json }
      - { name: undeployed, unit: undeployed.service, group: infrastructure }
    inventory_status_by_name:
      with-status:
        installed_tag: v9.9.9
        installed_commit: abcdef1234567890
        result: skipped
        gate: pin unchanged (v9.9.9)
        last_run: "2026-01-01T00:00:00Z"
        failed_attempts: 0
      tagless:
        installed_commit: 1234567890abcdef
        result: deployed
        gate: ok
        last_run: "2026-01-01T00:00:00Z"
    inventory_expected:
      generated: "2026-01-01T00:00:00Z"
      services:
        - name: with-status
          unit: with-status.service
          group: service
          reconciled: true
          version: v9.9.9
          commit: abcdef1234567890
          result: skipped
          gate: pin unchanged (v9.9.9)
          last_run: "2026-01-01T00:00:00Z"
          failed_attempts: 0
        - name: tagless
          unit: tagless.service
          group: service
          reconciled: true
          version: "1234567"
          commit: 1234567890abcdef
          result: deployed
          gate: ok
          last_run: "2026-01-01T00:00:00Z"
          failed_attempts: 0
        - name: undeployed
          unit: undeployed.service
          group: infrastructure
          reconciled: false
  tasks:
    - name: Render the inventory
      ansible.builtin.set_fact:
        inventory_rendered: "{{ lookup('template', '../roles/inventory/templates/services.json.j2') | from_json }}"

    - name: Assert the rendered inventory matches the declared body
      ansible.builtin.assert:
        that:
          - inventory_rendered == inventory_expected
        fail_msg: >-
          Rendered inventory does not match. Three things this pins: a service
          with a tag shows the tag; one without shows a seven-character SHA
          (lyly-admin has no tag, so this is the real case); and a service with
          no status file renders reconciled: false with no deploy keys at all
          rather than nulls, which is what lets the app treat the field as a
          state rather than a missing value.
```

**Do not regenerate the expected literal from the template.** Hand-write it. Rendering the template and pasting its output makes the two agree by construction and the assertion can no longer catch an error in the edit — a defect this repo has hit repeatedly.

- [ ] **Step 6: Run the suite and syntax-check**

Run: `./tests/run.sh`
Expected: green, with the count one play higher than the current `ok=214`.

Run: `tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml`
Expected: exit 0. A playbook referencing a role that does not exist fails this outright, so it is the check that proves Step 4's registration.

- [ ] **Step 7: Commit**

```bash
git add roles/inventory playbook.yml tests/test_swee_decide.yml
git commit -m "feat: publish a service inventory for lyly-admin to read"
```

---

### Task 2: Parse the inventory

**Repo:** `~/WebstormProjects/personal/lyly-admin`

**Files:**
- Create: `src/lib/serviceInventory.ts`
- Create: `src/lib/serviceInventory.test.ts`

**Interfaces:**
- Consumes: the JSON Task 1 writes.
- Produces:
  - `type ServiceGroup = "reconciler" | "service" | "infrastructure"`
  - `interface InventoryEntry { name: string; unit: string; group: ServiceGroup; reconciled: boolean; version?: string; commit?: string; result?: string; gate?: string; lastRun?: string; failedAttempts?: number }`
  - `interface ServiceInventory { generated: string | null; entries: InventoryEntry[]; available: boolean }`
  - `function parseInventory(raw: string): ServiceInventory`
  - `function readInventory(fs: FileSystem, path: string): ServiceInventory`
  - `const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json"`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/serviceInventory.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInventory, readInventory, INVENTORY_PATH } from "./serviceInventory";
import type { FileSystem } from "./fileSystem";

const VALID = JSON.stringify({
  generated: "2026-10-02T04:58:02Z",
  services: [
    {
      name: "swee", unit: "swee.service", group: "service", reconciled: true,
      version: "v2.11.4", commit: "af22c56", result: "skipped",
      gate: "pin unchanged (v2.11.4)", last_run: "2026-10-02T04:58:02Z",
      failed_attempts: 0,
    },
    { name: "palworld", unit: "palworld-palchuds.service", group: "service", reconciled: false },
  ],
});

function fsReturning(content: string | (() => never)): FileSystem {
  return {
    readFile: typeof content === "string" ? () => content : content,
    writeFile: () => {}, mkdir: () => {}, appendFile: () => {},
    copyFile: () => {}, rmRecursive: () => {},
  };
}

test("parses a well-formed inventory and renames snake_case to camelCase", () => {
  const inv = parseInventory(VALID);
  assert.equal(inv.available, true);
  assert.equal(inv.generated, "2026-10-02T04:58:02Z");
  assert.equal(inv.entries.length, 2);
  assert.deepEqual(inv.entries[0], {
    name: "swee", unit: "swee.service", group: "service", reconciled: true,
    version: "v2.11.4", commit: "af22c56", result: "skipped",
    gate: "pin unchanged (v2.11.4)", lastRun: "2026-10-02T04:58:02Z",
    failedAttempts: 0,
  });
});

test("an unreconciled entry carries no deploy fields at all", () => {
  const inv = parseInventory(VALID);
  const palworld = inv.entries[1];
  assert.equal(palworld.reconciled, false);
  assert.equal(palworld.version, undefined);
  assert.equal(palworld.result, undefined);
});

test("malformed JSON degrades to unavailable rather than throwing", () => {
  const inv = parseInventory('{"generated": "2026-10-02T04:58:02Z", "servi');
  assert.equal(inv.available, false);
  assert.deepEqual(inv.entries, []);
  assert.equal(inv.generated, null);
});

test("valid JSON of the wrong shape degrades to unavailable", () => {
  assert.equal(parseInventory('{"services": "not an array"}').available, false);
  assert.equal(parseInventory("[]").available, false);
});

test("an entry with an unknown group is dropped, not rendered in a bad group", () => {
  const raw = JSON.stringify({
    generated: "x",
    services: [{ name: "a", unit: "a.service", group: "nonsense", reconciled: false }],
  });
  assert.deepEqual(parseInventory(raw).entries, []);
});

test("a missing inventory file degrades to unavailable rather than throwing", () => {
  const throwing = fsReturning(() => {
    const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
  const inv = readInventory(throwing, INVENTORY_PATH);
  assert.equal(inv.available, false);
  assert.deepEqual(inv.entries, []);
});

test("readInventory reads the documented path", () => {
  let seen = "";
  const spy = fsReturning(VALID);
  spy.readFile = (p: string) => { seen = p; return VALID; };
  readInventory(spy, INVENTORY_PATH);
  assert.equal(seen, "/var/lib/lychee-inventory/services.json");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test src/lib/serviceInventory.test.ts`
Expected: FAIL — `Cannot find module './serviceInventory'`

- [ ] **Step 3: Implement**

Create `src/lib/serviceInventory.ts`:

```ts
import type { FileSystem } from "./fileSystem";

/**
 * The inventory lyly-admin reads is published by lychee-ops on every reconcile
 * tick (roles/inventory). It is the DECLARED set — what should be running —
 * and carries deploy state where a service has any.
 *
 * It is deliberately a published file rather than something read with
 * privilege: deploy state only changes when the reconciler writes it, so its
 * freshness is bounded by the tick by construction and a privileged reader
 * would buy nothing. Liveness is a separate, live source (see unitState.ts).
 */
export const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";

export type ServiceGroup = "reconciler" | "service" | "infrastructure";

const GROUPS: readonly string[] = ["reconciler", "service", "infrastructure"];

export interface InventoryEntry {
  name: string;
  unit: string;
  group: ServiceGroup;
  /** False for anything nothing deploys — palworld, Caddy, the tunnel. A
   *  state worth showing, not a missing value. */
  reconciled: boolean;
  version?: string;
  commit?: string;
  result?: string;
  gate?: string;
  lastRun?: string;
  failedAttempts?: number;
}

export interface ServiceInventory {
  /** ISO timestamp of the tick that wrote the file, or null when unavailable.
   *  Rendered as an age: a frozen inventory is how a dead reconciler becomes
   *  visible, which it otherwise is not. */
  generated: string | null;
  entries: InventoryEntry[];
  available: boolean;
}

const UNAVAILABLE: ServiceInventory = { generated: null, entries: [], available: false };

function toEntry(raw: Record<string, unknown>): InventoryEntry | null {
  const name = typeof raw.name === "string" ? raw.name : "";
  const unit = typeof raw.unit === "string" ? raw.unit : "";
  const group = typeof raw.group === "string" ? raw.group : "";
  if (!name || !unit || !GROUPS.includes(group)) return null;

  const entry: InventoryEntry = {
    name,
    unit,
    group: group as ServiceGroup,
    reconciled: raw.reconciled === true,
  };
  if (!entry.reconciled) return entry;

  if (typeof raw.version === "string") entry.version = raw.version;
  if (typeof raw.commit === "string") entry.commit = raw.commit;
  if (typeof raw.result === "string") entry.result = raw.result;
  if (typeof raw.gate === "string") entry.gate = raw.gate;
  if (typeof raw.last_run === "string") entry.lastRun = raw.last_run;
  if (typeof raw.failed_attempts === "number") entry.failedAttempts = raw.failed_attempts;
  return entry;
}

export function parseInventory(raw: string): ServiceInventory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNAVAILABLE;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return UNAVAILABLE;

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.services)) return UNAVAILABLE;

  const entries = obj.services
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map(toEntry)
    .filter((e): e is InventoryEntry => e !== null);

  return {
    generated: typeof obj.generated === "string" ? obj.generated : null,
    entries,
    available: true,
  };
}

/**
 * Degrades rather than throwing, the same way readTunnelId() degrades to
 * dashboard instructions rather than erroring a site page. A missing inventory
 * means lychee-ops has not shipped the role yet, or the reconciler has never
 * run — neither is a reason for the page to fail.
 */
export function readInventory(fs: FileSystem, path: string = INVENTORY_PATH): ServiceInventory {
  try {
    return parseInventory(fs.readFile(path));
  } catch {
    return UNAVAILABLE;
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsx --test src/lib/serviceInventory.test.ts`
Expected: PASS, all seven.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npm run lint
git add src/lib/serviceInventory.ts src/lib/serviceInventory.test.ts
git commit -m "feat: parse the published service inventory"
```

---

### Task 3: Read live unit state

**Repo:** `~/WebstormProjects/personal/lyly-admin`

**Files:**
- Create: `src/lib/unitState.ts`
- Create: `src/lib/unitState.test.ts`
- Modify: `src/lib/systemCommands.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type UnitStatus = "running" | "starting" | "exited" | "restarting" | "unknown"`
  - `interface UnitState { status: UnitStatus; since: string | null }`
  - `function parseUnitShowOutput(raw: string): Record<string, UnitState>`
  - `SystemCommands.readUnitStates(units: string[]): Promise<Record<string, UnitState>>`

**`systemctl show`, never `systemctl status`.** `status` renders journal lines and needs journal access, which is why `systemctl status caddy --no-pager` is one of the app's eight pinned commands. `show` is world-readable and needs none — verified on the host. Reaching for `status` here would turn a free read into a privilege question.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/unitState.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnitShowOutput } from "./unitState";

// `systemctl show a.service b.service -p Id,ActiveState,SubState,LoadState,ActiveEnterTimestamp`
// emits one blank-line-separated block per unit, in the order requested.
const TWO_UNITS = [
  "Id=swee.service",
  "ActiveState=active",
  "SubState=running",
  "LoadState=loaded",
  "ActiveEnterTimestamp=Fri 2026-10-02 02:47:38 UTC",
  "",
  "Id=caddy.service",
  "ActiveState=active",
  "SubState=running",
  "LoadState=loaded",
  "ActiveEnterTimestamp=Sat 2026-09-26 11:00:00 UTC",
].join("\n");

test("parses one block per unit, keyed by unit id", () => {
  const states = parseUnitShowOutput(TWO_UNITS);
  assert.deepEqual(Object.keys(states).sort(), ["caddy.service", "swee.service"]);
  assert.equal(states["swee.service"].status, "running");
  assert.equal(states["swee.service"].since, "Fri 2026-10-02 02:47:38 UTC");
});

test("maps every systemd state onto the existing canonical vocabulary", () => {
  const cases: Array<[string, string, string]> = [
    ["active", "running", "running"],
    ["activating", "start", "starting"],
    ["deactivating", "stop", "restarting"],
    ["reloading", "reload", "restarting"],
    ["failed", "failed", "exited"],
    ["inactive", "dead", "exited"],
  ];
  for (const [activeState, subState, expected] of cases) {
    const raw = `Id=x.service\nActiveState=${activeState}\nSubState=${subState}\nLoadState=loaded\nActiveEnterTimestamp=`;
    assert.equal(parseUnitShowOutput(raw)["x.service"].status, expected, `${activeState} should map to ${expected}`);
  }
});

test("a unit systemd does not know reads unknown, not exited", () => {
  // A service declared in the inventory but never installed. systemd answers
  // with inactive/dead rather than failing, so ActiveState alone would call
  // this "exited" — which reads as "it stopped" rather than "it was never here".
  const raw = "Id=ghost.service\nActiveState=inactive\nSubState=dead\nLoadState=not-found\nActiveEnterTimestamp=";
  assert.equal(parseUnitShowOutput(raw)["ghost.service"].status, "unknown");
});

test("an unrecognised ActiveState reads unknown rather than throwing", () => {
  const raw = "Id=x.service\nActiveState=inventing-new-states\nSubState=?\nLoadState=loaded\nActiveEnterTimestamp=";
  assert.equal(parseUnitShowOutput(raw)["x.service"].status, "unknown");
});

test("a timer carries its schedule; a service carries none", () => {
  const timer = [
    "Id=lyly-reconcile.timer",
    "ActiveState=active",
    "SubState=waiting",
    "LoadState=loaded",
    "ActiveEnterTimestamp=Fri 2026-10-02 00:00:00 UTC",
    "LastTriggerUSec=Fri 2026-10-02 04:57:56 UTC",
    "NextElapseUSecRealtime=Fri 2026-10-02 05:02:56 UTC",
    "",
    "Id=lyly-reconcile.service",
    "ActiveState=inactive",
    "SubState=dead",
    "LoadState=loaded",
    "ActiveEnterTimestamp=Fri 2026-10-02 04:57:56 UTC",
    "LastTriggerUSec=n/a",
    "NextElapseUSecRealtime=n/a",
  ].join("\n");
  const states = parseUnitShowOutput(timer);
  assert.equal(states["lyly-reconcile.timer"].lastTrigger, "Fri 2026-10-02 04:57:56 UTC");
  assert.equal(states["lyly-reconcile.timer"].nextElapse, "Fri 2026-10-02 05:02:56 UTC");
  // "n/a" is systemd's own filler, not a value. Rendering it would print "n/a"
  // where the page means "this unit has no schedule".
  assert.equal(states["lyly-reconcile.service"].lastTrigger, null);
  assert.equal(states["lyly-reconcile.service"].nextElapse, null);
});

test("an empty ActiveEnterTimestamp becomes null, not an empty string", () => {
  const raw = "Id=x.service\nActiveState=inactive\nSubState=dead\nLoadState=loaded\nActiveEnterTimestamp=";
  assert.equal(parseUnitShowOutput(raw)["x.service"].since, null);
});

test("empty output yields no states rather than throwing", () => {
  assert.deepEqual(parseUnitShowOutput(""), {});
  assert.deepEqual(parseUnitShowOutput("\n\n"), {});
});

test("a block with no Id is skipped", () => {
  const raw = "ActiveState=active\nSubState=running\nLoadState=loaded\nActiveEnterTimestamp=";
  assert.deepEqual(parseUnitShowOutput(raw), {});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test src/lib/unitState.test.ts`
Expected: FAIL — `Cannot find module './unitState'`

- [ ] **Step 3: Implement the parser**

Create `src/lib/unitState.ts`:

```ts
/**
 * Live unit state, read with `systemctl show` and no privilege at all.
 *
 * Deliberately NOT `systemctl status`: that renders recent journal lines and
 * therefore needs journal access, which is why `systemctl status caddy
 * --no-pager` is one of lyly-admin's eight sudo-pinned commands. `show` and
 * `is-active` are world-readable — verified on lychee 2026-10-02, where
 * `sudo -u lyly-admin systemctl is-active <four units>` answered without sudo.
 */

/** A subset of the app's canonical status vocabulary — the values a systemd
 *  unit can produce. `starting` and `unknown` are neutral, not red. */
export type UnitStatus = "running" | "starting" | "exited" | "restarting" | "unknown";

export interface UnitState {
  status: UnitStatus;
  /** systemd's own timestamp string, or null when the unit has never started. */
  since: string | null;
  /** Timer units only: when it last fired and when it is next due. Null on a
   *  .service, where systemd returns these keys empty. */
  lastTrigger: string | null;
  nextElapse: string | null;
}

export const UNIT_SHOW_PROPERTIES = [
  "Id",
  "ActiveState",
  "SubState",
  "LoadState",
  "ActiveEnterTimestamp",
  // Timer units only. systemd answers with these keys present but empty for a
  // .service, so asking for them costs nothing and avoids a second invocation
  // just to describe the reconciler's schedule.
  "LastTriggerUSec",
  "NextElapseUSecRealtime",
];

const ACTIVE_STATE_MAP: Record<string, UnitStatus> = {
  active: "running",
  activating: "starting",
  deactivating: "restarting",
  reloading: "restarting",
  failed: "exited",
  inactive: "exited",
};

/**
 * `systemctl show a b c -p ...` emits one blank-line-separated block per unit,
 * in the order requested. Keyed by Id rather than by position, so a unit
 * systemd silently omits cannot shift every later unit's state onto the wrong
 * row.
 */
export function parseUnitShowOutput(raw: string): Record<string, UnitState> {
  const states: Record<string, UnitState> = {};

  for (const block of raw.split(/\n\s*\n/)) {
    const fields: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1);
    }

    const id = fields.Id;
    if (!id) continue;

    // LoadState=not-found means the unit does not exist on this host. systemd
    // still answers inactive/dead, so ActiveState alone would report "exited",
    // which reads as "it stopped" rather than "it was never installed".
    const status: UnitStatus =
      fields.LoadState === "not-found"
        ? "unknown"
        : (ACTIVE_STATE_MAP[fields.ActiveState] ?? "unknown");

    const blank = (v: string | undefined): string | null => {
      const t = v?.trim();
      // systemd renders "never"/"n/a" for a timer that has not fired and for
      // every .service. Treat those as absent rather than printing them.
      return t && t !== "n/a" && t !== "never" ? t : null;
    };

    states[id] = {
      status,
      since: blank(fields.ActiveEnterTimestamp),
      lastTrigger: blank(fields.LastTriggerUSec),
      nextElapse: blank(fields.NextElapseUSecRealtime),
    };
  }

  return states;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsx --test src/lib/unitState.test.ts`
Expected: PASS, all eight.

- [ ] **Step 5: Add the command**

In `src/lib/systemCommands.ts`, import the new module and add to the `SystemCommands` interface, after `checkContainerStatus`:

```ts
  readUnitStates(units: string[]): Promise<Record<string, UnitState>>;
```

And to `realSystemCommands`:

```ts
  /**
   * One invocation for every unit, not one per unit: this runs on every render
   * of the services page, and the hostname dropdown already establishes that
   * per-row status checks are the thing to avoid.
   *
   * No sudo. `systemctl show` is world-readable; see unitState.ts for why this
   * is not `systemctl status`. Degrades to {} on any failure, so a page renders
   * deploy state with neutral liveness rather than erroring.
   */
  async readUnitStates(units) {
    if (units.length === 0) return {};
    try {
      const { stdout } = await run("/usr/bin/systemctl", [
        "show",
        ...units,
        "-p",
        UNIT_SHOW_PROPERTIES.join(","),
      ]);
      return parseUnitShowOutput(stdout);
    } catch {
      return {};
    }
  },
```

- [ ] **Step 6: Typecheck, run the full suite, commit**

```bash
npm run typecheck && npm run lint && npm test
```
Expected: green. The suite will fail to compile until `src/dev/fakes.ts` implements the new interface member — that is Task 4, so if `npm test` reports a missing `readUnitStates` on the fake, add the one-line stub `readUnitStates: () => Promise.resolve({})` now and let Task 4 give it real seed data.

```bash
git add src/lib/unitState.ts src/lib/unitState.test.ts src/lib/systemCommands.ts src/dev/fakes.ts
git commit -m "feat: read live unit state without privilege"
```

---

### Task 4: Join the two sources and serve the route

**Repo:** `~/WebstormProjects/personal/lyly-admin`

**Files:**
- Create: `src/lib/serviceBoard.ts`
- Create: `src/lib/serviceBoard.test.ts`
- Create: `src/routes/services.ts`
- Modify: `src/app.ts`
- Modify: `src/dev/fakes.ts`
- Modify: `src/dev/seed.ts`

**Interfaces:**
- Consumes: `readInventory`, `ServiceInventory`, `InventoryEntry`, `ServiceGroup` (Task 2); `UnitState`, `UnitStatus`, `SystemCommands.readUnitStates` (Task 3).
- Produces:
  - `interface BoardRow extends InventoryEntry { status: UnitStatus; since: string | null }`
  - `interface ServiceBoard { groups: Array<{ group: ServiceGroup; rows: BoardRow[] }>; generated: string | null; inventoryAvailable: boolean }`
  - `function buildBoard(inv: ServiceInventory, states: Record<string, UnitState>): ServiceBoard`
  - `GET /services` rendering through `renderServicesPage` (Task 5 supplies the view; this task renders a minimal `<pre>` so the route is testable on its own)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/serviceBoard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "./serviceBoard";
import type { ServiceInventory } from "./serviceInventory";
import type { UnitState } from "./unitState";

const inv: ServiceInventory = {
  generated: "2026-10-02T04:58:02Z",
  available: true,
  entries: [
    { name: "lyly-reconcile-timer", unit: "lyly-reconcile.timer", group: "reconciler", reconciled: false },
    { name: "lyly-reconcile", unit: "lyly-reconcile.service", group: "reconciler", reconciled: false },
    { name: "swee", unit: "swee.service", group: "service", reconciled: true, version: "v2.11.4" },
    { name: "caddy", unit: "caddy.service", group: "infrastructure", reconciled: false },
  ],
};

const noSchedule = { lastTrigger: null, nextElapse: null };

const states: Record<string, UnitState> = {
  "lyly-reconcile.timer": {
    status: "running", since: null,
    lastTrigger: "Fri 2026-10-02 04:57:56 UTC",
    nextElapse: "Fri 2026-10-02 05:02:56 UTC",
  },
  "lyly-reconcile.service": { status: "exited", since: null, ...noSchedule },
  "swee.service": { status: "running", since: "Fri 2026-10-02 02:47:38 UTC", ...noSchedule },
  "caddy.service": { status: "running", since: "Sat 2026-09-26 11:00:00 UTC", ...noSchedule },
};

test("groups rows in the fixed order reconciler, service, infrastructure", () => {
  const board = buildBoard(inv, states);
  assert.deepEqual(board.groups.map((g) => g.group), ["reconciler", "service", "infrastructure"]);
});

test("a timer's schedule reaches the row the page renders it from", () => {
  const board = buildBoard(inv, states);
  const timer = board.groups[0].rows[0];
  assert.equal(timer.nextElapse, "Fri 2026-10-02 05:02:56 UTC");
});

test("joins live status onto each inventory entry", () => {
  const board = buildBoard(inv, states);
  const swee = board.groups[1].rows[0];
  assert.equal(swee.name, "swee");
  assert.equal(swee.status, "running");
  assert.equal(swee.version, "v2.11.4");
});

test("a declared unit with no live state reads unknown, not missing", () => {
  const board = buildBoard(inv, {});
  for (const group of board.groups) {
    for (const row of group.rows) {
      assert.equal(row.status, "unknown");
      assert.equal(row.since, null);
    }
  }
});

test("a live unit absent from the inventory is not rendered and does not throw", () => {
  const board = buildBoard(inv, {
    ...states,
    "stranger.service": { status: "running", since: null, ...noSchedule },
  });
  const names = board.groups.flatMap((g) => g.rows.map((r) => r.name));
  assert.ok(!names.includes("stranger"));
  assert.equal(names.length, 4);
});

test("an empty group is dropped rather than rendered with no rows", () => {
  const onlyServices: ServiceInventory = { ...inv, entries: [inv.entries[1]] };
  const board = buildBoard(onlyServices, states);
  assert.deepEqual(board.groups.map((g) => g.group), ["service"]);
});

test("an unavailable inventory still yields a board, with no rows", () => {
  const board = buildBoard({ generated: null, entries: [], available: false }, states);
  assert.equal(board.inventoryAvailable, false);
  assert.deepEqual(board.groups, []);
  assert.equal(board.generated, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test src/lib/serviceBoard.test.ts`
Expected: FAIL — `Cannot find module './serviceBoard'`

- [ ] **Step 3: Implement**

Create `src/lib/serviceBoard.ts`:

```ts
import type { InventoryEntry, ServiceGroup, ServiceInventory } from "./serviceInventory";
import type { UnitState, UnitStatus } from "./unitState";

export interface BoardRow extends InventoryEntry {
  status: UnitStatus;
  since: string | null;
  /** Timer units only; the reconciler block renders these. Null everywhere else. */
  lastTrigger: string | null;
  nextElapse: string | null;
}

export interface ServiceBoard {
  groups: Array<{ group: ServiceGroup; rows: BoardRow[] }>;
  generated: string | null;
  inventoryAvailable: boolean;
}

/** Fixed display order: what deploys things, what runs, what carries traffic. */
const GROUP_ORDER: readonly ServiceGroup[] = ["reconciler", "service", "infrastructure"];

/**
 * The inventory says what SHOULD run; unit state says what IS running. The join
 * is driven by the inventory, so a unit alive on the host but declared nowhere
 * simply has no row — drift the page cannot show, which is why the inventory is
 * the declared set rather than a scrape.
 *
 * A declared unit with no live state reads `unknown` (neutral) rather than
 * `exited`, because the absence means the query failed, not that the service
 * stopped.
 */
export function buildBoard(inv: ServiceInventory, states: Record<string, UnitState>): ServiceBoard {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: inv.entries
      .filter((e) => e.group === group)
      .map((e): BoardRow => {
        const live = states[e.unit];
        return {
          ...e,
          status: live?.status ?? "unknown",
          since: live?.since ?? null,
          lastTrigger: live?.lastTrigger ?? null,
          nextElapse: live?.nextElapse ?? null,
        };
      }),
  })).filter((g) => g.rows.length > 0);

  return { groups, generated: inv.generated, inventoryAvailable: inv.available };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx tsx --test src/lib/serviceBoard.test.ts`
Expected: PASS, all seven.

- [ ] **Step 5: Add the route**

Create `src/routes/services.ts`:

```ts
import express from "express";
import type { Deps } from "../deps";
import { readInventory } from "../lib/serviceInventory";
import { buildBoard } from "../lib/serviceBoard";

export function createServicesRouter(deps: Deps): express.Router {
  const router = express.Router();

  router.get("/services", async (_req, res) => {
    const inventory = readInventory(deps.fs);
    const units = inventory.entries.map((e) => e.unit);
    const states = await deps.commands.readUnitStates(units);
    const board = buildBoard(inventory, states);

    // Placeholder rendering. Task 5 replaces this with the real page, designed
    // through impeccable; this exists so the route is independently testable.
    res.type("text/plain").send(JSON.stringify(board, null, 2));
  });

  return router;
}
```

In `src/app.ts`, import it and mount it beside the sites router:

```ts
import { createServicesRouter } from "./routes/services";
// ...
  app.use(createSitesRouter(deps));
  app.use(createServicesRouter(deps));
```

- [ ] **Step 6: Give the fakes real data**

In `src/dev/fakes.ts`, replace any stub from Task 3 with seed-backed state:

```ts
    readUnitStates: (units) =>
      Promise.resolve(
        Object.fromEntries(units.map((u) => [u, seededUnitStates[u] ?? { status: "unknown", since: null }])),
      ),
```

In `src/dev/seed.ts`, add the inventory to the in-memory filesystem and export the unit states. `palsave-api.service` is **deliberately absent** from `seededUnitStates`, so `npm run dev:mock` renders a declared-but-unknown row without anyone having to break the host to see that state — the same kind of deliberate seeding as the unmanaged `lychee.local` block already in this file.

```ts
export const SEEDED_INVENTORY = JSON.stringify({
  generated: new Date().toISOString(),
  services: [
    { name: "lyly-reconcile-timer", unit: "lyly-reconcile.timer", group: "reconciler", reconciled: false },
    { name: "lyly-reconcile", unit: "lyly-reconcile.service", group: "reconciler", reconciled: false },
    { name: "lyly-admin", unit: "lyly-admin.service", group: "service", reconciled: true,
      version: "a428e84", commit: "a428e842a101eb4da22ca29469297d71d0eda150",
      result: "skipped", gate: "ok", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
    { name: "swee", unit: "swee.service", group: "service", reconciled: true,
      version: "v2.11.4", commit: "af22c5683fcb100f8d27038fd2b71e744e46427a",
      result: "skipped", gate: "pin unchanged (v2.11.4)", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
    // The retry cap engaged. Note the result is "blocked", not "failed":
    // failed is the pre-cap state while the reconciler is still retrying and
    // alerts are firing; blocked is the cap, where the play succeeds, the
    // notifications stop and the service stays down. CLAUDE.md calls that the
    // state that looks like success, and it has no UI anywhere today. Seeded
    // so the page's loudest case is visible in dev mode, not only in an
    // incident. failed_attempts is what separates this blocked from a
    // CI-gate blocked.
    { name: "palsave-api", unit: "palsave-api.service", group: "service", reconciled: true,
      version: "v0.2.0", commit: "9fbb23a8348ea8ef93b81f01c93e811e980bcb09",
      result: "blocked",
      // Verbatim from roles/palsave_api_app/tasks/decide_gate.yml:118-120 —
      // the real string, not a paraphrase. Its length and the embedded
      // recovery command are what the page has to lay out.
      gate: "v0.2.0 failed 3 times; not retrying (promote another tag, or rm /opt/palsave-api/.failed-tag)",
      last_run: "2026-10-02T04:58:02Z", failed_attempts: 3 },
    { name: "palworld", unit: "palworld-palchuds.service", group: "service", reconciled: false },
    { name: "caddy", unit: "caddy.service", group: "infrastructure", reconciled: false },
    { name: "cloudflared-sites", unit: "cloudflared-sites.service", group: "infrastructure", reconciled: false },
  ],
}, null, 2);

export const seededUnitStates: Record<string, { status: string; since: string | null; lastTrigger: string | null; nextElapse: string | null }> = {
  "lyly-reconcile.timer": { status: "running", since: "Thu 2026-09-26 11:00:00 UTC",
    lastTrigger: "Fri 2026-10-02 04:57:56 UTC", nextElapse: "Fri 2026-10-02 05:02:56 UTC" },
  "lyly-reconcile.service": { status: "exited", since: "Fri 2026-10-02 04:57:56 UTC", lastTrigger: null, nextElapse: null },
  "lyly-admin.service": { status: "running", since: "Sat 2026-09-26 11:02:00 UTC", lastTrigger: null, nextElapse: null },
  "swee.service": { status: "running", since: "Fri 2026-10-02 02:47:38 UTC", lastTrigger: null, nextElapse: null },
  // palsave-api.service omitted on purpose — see above.
  "palworld-palchuds.service": { status: "running", since: "Thu 2026-10-01 06:54:00 UTC", lastTrigger: null, nextElapse: null },
  "caddy.service": { status: "running", since: "Sat 2026-09-26 11:00:00 UTC", lastTrigger: null, nextElapse: null },
  "cloudflared-sites.service": { status: "running", since: "Sat 2026-09-26 11:00:00 UTC", lastTrigger: null, nextElapse: null },
};
```

Register `SEEDED_INVENTORY` at `/var/lib/lychee-inventory/services.json` in the fake filesystem's initial contents, beside the existing seeded Caddyfile and tunnel config.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npm run typecheck && npm run lint && npm test
```
Expected: green, pristine.

Also run `npm run dev:mock` and open `/services` — expect JSON with three groups and one `unknown` row.

```bash
git add src/lib/serviceBoard.ts src/lib/serviceBoard.test.ts src/routes/services.ts src/app.ts src/dev/fakes.ts src/dev/seed.ts
git commit -m "feat: join inventory and live unit state behind /services"
```

---

### Task 5: The page

**Repo:** `~/WebstormProjects/personal/lyly-admin`

**Files:**
- Modify: `src/views/html.ts`
- Modify: `src/views/shell.ts`
- Modify: `src/views/shared.ts`
- Modify: `src/routes/services.ts`
- Modify: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `ServiceBoard`, `BoardRow` (Task 4).
- Produces: `function renderServicesPage(board: ServiceBoard): string`

**This task runs through `impeccable` and does not begin with code.**

- [ ] **Step 1: Invoke impeccable**

This is a new surface, so per `CLAUDE.md` it invokes plain `/impeccable`, not a scoped command. `DESIGN.md` is normative; do not reopen its decisions. If a layout question has more than one reasonable answer — and the two recorded in the spec's Open Questions both do — the answer is a rendered comparison via the project skill `.claude/skills/comparing-design-variants/`, not a written recommendation.

The spec fixes what is not a visual decision, and these are binding inputs rather than suggestions:

- three groups, in the order reconciler → service → infrastructure
- the existing canonical status vocabulary, with `starting` and `unknown` neutral rather than red
- staleness rendered as an **age** ("inventory written 3 hours ago"), never a raw timestamp
- deploy state subordinate to liveness, per the agreed purpose
- mono for machine facts, sans for sentences — `DESIGN.md`'s absolute split

The two open questions to resolve with a rendered comparison rather than prose: whether per-service `gate` strings live in the reconciler block or on each service row, and whether a stale inventory needs a threshold before it reads as wrong.

- [ ] **Step 2: Add the header item**

The header carries `sites` and `add site`, and a header item's destination never changes with location — a third item fits that rule without exception. Add `services` → `/services` in `src/views/shell.ts`, matching the existing `aria-current="page"` treatment exactly (Chalk on Hairline, 2px Ember Edge left rule) rather than inventing one.

- [ ] **Step 3: Implement the view**

Add `renderServicesPage(board: ServiceBoard): string` to `src/views/html.ts`, using the class constants in `src/views/shared.ts` and adding to them rather than inlining new Tailwind strings. Replace the placeholder in `src/routes/services.ts` with it.

- [ ] **Step 4: Cover the degraded states**

Add to `src/views/html.test.ts`:

```ts
test("an unavailable inventory renders an explanation, not an empty page", () => {
  const html = renderServicesPage({ groups: [], generated: null, inventoryAvailable: false });
  assert.ok(html.includes("inventory"));
  assert.ok(!html.includes("undefined"));
  assert.ok(!html.includes("NaN"));
});

test("a row with no deploy state renders no deploy fields rather than blanks", () => {
  const html = renderServicesPage({
    inventoryAvailable: true,
    generated: "2026-10-02T04:58:02Z",
    groups: [{ group: "service", rows: [
      { name: "palworld", unit: "palworld-palchuds.service", group: "service",
        reconciled: false, status: "running", since: null },
    ] }],
  });
  assert.ok(html.includes("palworld"));
  assert.ok(!html.includes("undefined"));
});
```

- [ ] **Step 5: Verify the design hook fired**

`.impeccable/hook.cache.json` records per-file edit counts and findings for the session. Check it rather than running the detector by hand — the hook is active and the manual pass is redundant. If you do run it anyway, scope it to `src/views`, never `src public`: `public/style.css` is gitignored Tailwind output and produces findings that exist in no source file.

- [ ] **Step 6: Full suite and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/views src/routes/services.ts
git commit -m "feat: the services page"
```

---

### Task 6: Live state on the request chain

**Repo:** `~/WebstormProjects/personal/lyly-admin`

**Files:**
- Modify: `src/views/html.ts`
- Modify: `src/routes/sites.ts`
- Modify: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `SystemCommands.readUnitStates` (Task 3), `UnitStatus` (Task 3).
- Produces: nothing later tasks rely on.

The site detail page draws a four-hop chain and hops 1–3 carry no live state. Hops 2 and 3 already name `cloudflared-sites` and Caddy; they gain status from the same single call. **Hop 1 (Cloudflare DNS) is unchanged and stays static** — Tier 1 scope is explicit that the app does not touch DNS, so it has no way to know and must not imply otherwise.

- [ ] **Step 1: Write the failing test**

Add to `src/views/html.test.ts`, following the existing detail-page tests' shape:

```ts
test("hops 2 and 3 carry live status; hop 1 stays static", () => {
  const html = renderSiteDetail(someStaticSite, {
    unitStates: {
      "cloudflared-sites.service": { status: "running", since: null },
      "caddy.service": { status: "exited", since: null },
    },
  });
  assert.ok(html.includes("cloudflared-sites"));
  assert.ok(html.includes("caddy"));
  // Hop 1 names Cloudflare DNS and must carry no status of any kind: the app
  // does not touch DNS, so any pill there would be invented.
  const dnsHop = html.slice(html.indexOf("Cloudflare DNS"), html.indexOf("cloudflared-sites"));
  assert.ok(!/status|running|exited|unknown/i.test(dnsHop));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — `renderSiteDetail` does not accept `unitStates`.

- [ ] **Step 3: Thread the states through**

In `src/routes/sites.ts`'s detail handler, call `deps.commands.readUnitStates(["caddy.service", "cloudflared-sites.service"])` alongside the existing status check, and pass the result into `renderSiteDetail`. Run it concurrently with the existing per-site status check via `Promise.all` — the list page already establishes that pattern, and a sequential second await would add latency for nothing.

In `src/views/html.ts`, render the status on hops 2 and 3 using the same pill component as the last hop. Do not introduce a second treatment.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test src/views/html.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/views/html.ts src/views/html.test.ts src/routes/sites.ts
git commit -m "feat: live state on the request chain's tunnel and Caddy hops"
```

---

## Verification on the host, after Tasks 1 and 6 are merged

```bash
sudo cat /var/lib/lychee-inventory/services.json
sudo -u lyly-admin cat /var/lib/lychee-inventory/services.json
sudo -u lyly-admin systemctl show swee.service caddy.service -p Id,ActiveState,LoadState
```

The second is the one that matters and the first cannot substitute for it: reading as root proves the file exists, not that the app's own account can read it. The third confirms `show` still needs no privilege after the fact rather than on the strength of one earlier check.

Then open `/services` and confirm the reconciler block's age advances across a tick.
