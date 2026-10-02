// Not unit-testable here: readUnitStates / readTimerSchedule in
// systemCommands.ts wrap execFile with no exec seam, so their argument vectors,
// the absence of sudo, and the 2s timeout are verifiable only by reading them.
// Everything below covers the pure parsers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimerSchedule, parseUnitShowOutput } from "./unitState";

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
    // Stopping may be for good; see ACTIVE_STATE_MAP.
    ["deactivating", "stop", "exited"],
    // Up and serving during a reload; this app reloads Caddy on every add.
    ["reloading", "reload", "running"],
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

test("a timer and a service both parse to liveness only; no schedule fields", () => {
  const raw = [
    "Id=lyly-reconcile.timer",
    "ActiveState=active",
    "SubState=waiting",
    "LoadState=loaded",
    "ActiveEnterTimestamp=Fri 2026-10-02 00:00:00 UTC",
    "",
    "Id=lyly-reconcile.service",
    "ActiveState=inactive",
    "SubState=dead",
    "LoadState=loaded",
    "ActiveEnterTimestamp=Fri 2026-10-02 04:57:56 UTC",
  ].join("\n");
  const states = parseUnitShowOutput(raw);
  assert.deepEqual(states["lyly-reconcile.timer"], { status: "running", since: "Fri 2026-10-02 00:00:00 UTC" });
  assert.equal(states["lyly-reconcile.service"].status, "exited");
});

const REAL_TIMERS =
  '[{"next":1790964685639426,"left":1790964685639426,"last":1790964385637936,"passed":440826018386,"unit":"lyly-reconcile.timer","activates":"lyly-reconcile.service"}]';

test("list-timers JSON parses to two Dates from epoch microseconds", () => {
  const { next, last } = parseTimerSchedule(REAL_TIMERS);
  assert.equal(next?.getTime(), 1790964685639);
  assert.equal(last?.getTime(), 1790964385637);
});

test("an empty list-timers array yields no schedule", () => {
  assert.deepEqual(parseTimerSchedule("[]"), { next: null, last: null });
});

test("non-JSON list-timers output yields no schedule without throwing", () => {
  assert.deepEqual(parseTimerSchedule("Failed to list timers"), { next: null, last: null });
  assert.deepEqual(parseTimerSchedule(""), { next: null, last: null });
});

test("a missing or zero next leaves last intact", () => {
  assert.deepEqual(parseTimerSchedule('[{"last":1790964385637936}]').next, null);
  assert.equal(parseTimerSchedule('[{"last":1790964385637936}]').last?.getTime(), 1790964385637);
  assert.equal(parseTimerSchedule('[{"next":0,"last":1790964385637936}]').next, null);
});

test("since is the start of the current state, not the last start", () => {
  const unit = (active: string, a: string, i: string) =>
    parseUnitShowOutput(
      `Id=x.service\nActiveState=${active}\nSubState=s\nLoadState=loaded\nActiveEnterTimestamp=${a}\nInactiveEnterTimestamp=${i}`,
    )["x.service"].since;
  assert.equal(unit("active", "A", "I"), "A");
  assert.equal(unit("activating", "A", "I"), "A");
  assert.equal(unit("inactive", "A", "I"), "I");
  assert.equal(unit("failed", "A", "I"), "I");
  // A oneshot between ticks: never "entered active", but did go inactive.
  assert.equal(unit("inactive", "", "Fri 2026-10-02 18:17:20 UTC"), "Fri 2026-10-02 18:17:20 UTC");
  assert.equal(unit("inventing-new-states", "", "I"), "I");
  assert.equal(unit("inventing-new-states", "A", "I"), "A");
});

test("systemd's n/a and never fillers are not timestamps", () => {
  const raw = "Id=x.service\nActiveState=active\nSubState=running\nLoadState=loaded\nActiveEnterTimestamp=n/a\nInactiveEnterTimestamp=never";
  assert.equal(parseUnitShowOutput(raw)["x.service"].since, null);
  const stopped = "Id=x.service\nActiveState=inactive\nSubState=dead\nLoadState=loaded\nActiveEnterTimestamp=A\nInactiveEnterTimestamp=never";
  assert.equal(parseUnitShowOutput(stopped)["x.service"].since, null);
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

test("a unit systemd omits from its output is absent, and does not shift the rest", () => {
  // Keyed by Id, not position: asking for three and getting two back must
  // leave the missing one undefined for the caller to treat as unknown.
  const states = parseUnitShowOutput(TWO_UNITS);
  assert.equal(states["palworld.service"], undefined);
  assert.equal(states["caddy.service"].since, "Sat 2026-09-26 11:00:00 UTC");
});
