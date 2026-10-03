/**
 * Live unit state, read with `systemctl show` and no privilege at all.
 *
 * Deliberately NOT `systemctl status`: that renders recent journal lines and
 * therefore needs journal access, which is why `systemctl status caddy
 * --no-pager` is one of lyly-admin's eight sudo-pinned commands. `show` and
 * `is-active` are world-readable — verified on lychee 2026-10-02, where
 * `sudo -u lyly-admin systemctl is-active <four units>` answered without sudo.
 */

/** A subset of the app's canonical status vocabulary. `starting` and
 *  `unknown` are neutral, not red. The first five are what a systemd unit can
 *  produce; the last three exist only for container rows, which would
 *  otherwise lose exactly the states worth seeing (an unhealthy container is
 *  running, and collapsing it to "running" would paint it green). */
export type UnitStatus =
  | "running"
  | "starting"
  | "exited"
  | "restarting"
  | "unknown"
  | "unhealthy"
  | "paused"
  | "not-created";

export interface UnitState {
  status: UnitStatus;
  /**
   * When the CURRENT state began, as systemd's own timestamp string — not
   * "since this unit last started". Running or starting: ActiveEnterTimestamp.
   * Exited: InactiveEnterTimestamp (the stop time; the active one would name a
   * start time as though it were a stop). Restarting and unknown: whichever is
   * non-empty, active preferred — indicative rather than exact there. Null
   * when systemd has no timestamp for it.
   */
  since: string | null;
}

export const UNIT_SHOW_PROPERTIES = [
  "Id",
  "ActiveState",
  "SubState",
  "LoadState",
  "ActiveEnterTimestamp",
  "InactiveEnterTimestamp",
  // Deliberately no timer-schedule properties. NextElapseUSecRealtime is only
  // populated for calendar timers; the reconciler's is monotonic, so it is
  // empty there. The schedule has one owner: parseTimerSchedule below.
];

const ACTIVE_STATE_MAP: Record<string, UnitStatus> = {
  active: "running",
  activating: "starting",
  // A reloading service is up and serving; this app reloads Caddy on every
  // site add, so calling it not-running would be a state it causes itself.
  reloading: "running",
  // A unit that is stopping may be stopping for good, and "restarting"
  // promises a return nothing guarantees. `systemctl restart` passes through
  // deactivating too and the two are indistinguishable from ActiveState alone,
  // so this picks the answer that is wrong for less time: "exited" is
  // transiently early, where "restarting" could be wrong indefinitely. As a
  // result no ActiveState currently maps to "restarting"; it stays in the
  // type because the vocabulary is shared and fixed.
  deactivating: "exited",
  failed: "exited",
  inactive: "exited",
};

/**
 * `systemctl show a b c -p ...` emits one blank-line-separated block per unit,
 * in the order requested. Keyed by Id rather than by position, so a unit
 * systemd silently omits cannot shift every later unit's state onto the wrong
 * row. An omitted unit is simply absent from the result; the caller treats a
 * missing key as unknown.
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

    const clean = (v: string | undefined): string | null => {
      const t = v?.trim();
      // systemd renders "n/a"/"never" for filler. Treat as absent rather than
      // printing them.
      return t && t !== "n/a" && t !== "never" ? t : null;
    };

    const active = clean(fields.ActiveEnterTimestamp);
    const inactive = clean(fields.InactiveEnterTimestamp);
    // Per-state pick; see UnitState.since. A oneshot between ticks (the
    // reconciler) has an empty ActiveEnterTimestamp but a real
    // InactiveEnterTimestamp, which is exactly why exited reads the latter.
    const since =
      status === "running" || status === "starting"
        ? active
        : status === "exited"
          ? inactive
          : (active ?? inactive);

    states[id] = {
      status,
      since,
    };
  }

  return states;
}

export interface TimerSchedule {
  next: Date | null;
  last: Date | null;
}

/**
 * Parses `systemctl list-timers <unit> --no-pager --output=json`. Used instead
 * of `show` because the reconciler's timer is monotonic (OnUnitActiveUSec), so
 * `NextElapseUSecRealtime` is empty for it; list-timers does the wall-clock
 * conversion itself. `next`/`last` are microseconds since the Unix epoch, and
 * 0 or absent means "no such time". Anything unparseable degrades to nulls.
 */
export function parseTimerSchedule(raw: string): TimerSchedule {
  const none: TimerSchedule = { next: null, last: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return none;
  }
  const entry: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!entry || typeof entry !== "object") return none;

  const toDate = (v: unknown): Date | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v / 1000) : null;
  const e = entry as Record<string, unknown>;
  return { next: toDate(e.next), last: toDate(e.last) };
}
