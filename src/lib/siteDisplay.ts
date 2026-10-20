import type { ContainerHealth, ContainerState } from "./containerStatus";
import type { ServiceInventory } from "./serviceInventory";
import { findTimerUnit } from "./serviceBoard";
import type { UnitState } from "./unitState";

/**
 * How the detail page learned about a site's liveness. Plain reverse-proxy
 * sites get a raw TCP check; sites scaffolded with a framework get container
 * lifecycle state plus Docker's own health verdict. Static sites get neither,
 * so the route passes no status at all for them.
 *
 * Declared here rather than in the view because describeStatus() below is the
 * only thing that interprets it, and lib must not import from views.
 */
export type SiteStatus =
  | { kind: "tcp"; responding: boolean }
  | { kind: "container"; state: ContainerState; health?: ContainerHealth }
  /** Attached to a repository, no tag deployed yet: there is no container to
   *  ask, because the reconciler takes no compose action for a tagless image. */
  | { kind: "awaiting-image" }
  /** The reconciler tried to deploy the first tag and failed; nothing is
   *  installed, so there is still no container to ask. A failed REDEPLOY is not
   *  this: an older version is installed, and the container reports itself. */
  | { kind: "failed" };

export type StatusTone = "ok" | "bad" | "neutral";

export interface StatusLabels {
  /** Worst-case single word for the header pill, e.g. "unhealthy" over "running". */
  pill: string;
  /** Fuller line for the request-path card's last hop, e.g. "running · unhealthy". */
  hop: string;
  tone: StatusTone;
}

/**
 * One canonical vocabulary for site state, used by both the header pill and
 * the last routing hop so the page can never describe one fact two ways.
 *
 * "starting", "unknown" and "not deployed" are deliberately neutral rather
 * than bad, because none of them is a failure: a container still running its
 * first health check is not broken, a status we failed to read is not evidence
 * the site is down, and a container that was never created — or that was
 * deliberately taken down with `docker compose down` — has not crashed. The
 * bad tone is reserved for something that tried and failed, so that red keeps
 * meaning "this needs you now". The status word still says the site is not
 * serving; only the alarm is withdrawn.
 *
 * "awaiting image" is neutral for the same reason: a repository attached
 * before its first tag is pushed, or before the reconciler has looked, is the
 * expected state between two steps, not a fault. "failed" is its opposite and
 * is bad: the reconciler attempted that first deploy and could not complete
 * it, which is exactly "tried and failed", and nothing will change until the
 * operator reads why.
 */
export function describeStatus(status: SiteStatus): StatusLabels {
  if (status.kind === "failed") {
    return { pill: "failed", hop: "deploy failed", tone: "bad" };
  }
  if (status.kind === "awaiting-image") {
    return { pill: "awaiting image", hop: "awaiting first image", tone: "neutral" };
  }
  if (status.kind === "tcp") {
    return status.responding
      ? { pill: "responding", hop: "responding", tone: "ok" }
      : { pill: "not responding", hop: "not responding", tone: "bad" };
  }

  switch (status.state) {
    case "running":
      if (status.health === "unhealthy") {
        return { pill: "unhealthy", hop: "running · unhealthy", tone: "bad" };
      }
      if (status.health === "starting") {
        return { pill: "starting", hop: "running · health check starting", tone: "neutral" };
      }
      // health === "healthy", or undefined for an image built before the
      // HEALTHCHECK instruction existed — say nothing rather than guess.
      return {
        pill: "running",
        hop: status.health === "healthy" ? "running · healthy" : "running",
        tone: "ok",
      };
    case "exited":
      return { pill: "exited", hop: "exited", tone: "bad" };
    case "restarting":
      return { pill: "restarting", hop: "restarting · crash-looping", tone: "bad" };
    case "paused":
      return { pill: "paused", hop: "paused", tone: "bad" };
    case "not-created":
      return { pill: "not deployed", hop: "not deployed", tone: "neutral" };
    case "unknown":
      return { pill: "unknown", hop: "can't check", tone: "neutral" };
    // Exhaustiveness guard: if a new ContainerState member is added,
    // this becomes a compile error instead of a silent runtime undefined.
    default: {
      const unreachable: never = status.state;
      return unreachable;
    }
  }
}

/**
 * What a site resource reads while nothing is installed: the reconciler has
 * never confirmed a version, so the container is not asked and its live state
 * (an `exited` left by a failed first deploy) would only contradict the
 * reconciler's own verdict. Shared by the site page and the services board so
 * the two cannot give one resource two words. Null means this rule has no
 * opinion and the caller reads the container as usual.
 */
export function undeployedStatus(entry: {
  version?: string;
  result?: string;
}): { kind: "failed" } | { kind: "awaiting-image" } | null {
  if (entry.version) return null;
  if (entry.result === "failed") return { kind: "failed" };
  if (entry.result === "awaiting-image") return { kind: "awaiting-image" };
  return null;
}

export interface HostnameParts {
  /** The bright leading part — the whole hostname when there is nothing to dim. */
  lead: string;
  /** The dimmed trailing ".<domain>", or "" when the hostname is the apex domain. */
  dimmed: string;
}

/**
 * Splits a hostname so the page can dim the part that is the same on every
 * site. The apex domain is itself a managed site (isManagedHostname admits
 * config.domain), and it has no subdomain to separate, so it stays whole.
 */
export function splitHostnameForDisplay(hostname: string, domain: string): HostnameParts {
  const suffix = `.${domain}`;
  if (hostname.length > suffix.length && hostname.endsWith(suffix)) {
    return { lead: hostname.slice(0, -suffix.length), dimmed: suffix };
  }
  return { lead: hostname, dimmed: "" };
}

/** Why a reconciled site's deploy is not going through, as the board
 *  shows it. `bad` is something to act on; `neutral` is a wait. */
export interface DeployTrouble { tone: "bad" | "neutral"; word: "blocked" | "failed" | "waiting"; reason: string }

const BAD = "bad" as const;
const NEUTRAL = "neutral" as const;

// Keyed by the contract's gate_code (A-GATE-1). The codes that mean "nothing
// is wrong" (ok, up-to-date, awaiting-image, unknown) are deliberately absent.
const BLOCKED_TROUBLE: Record<string, DeployTrouble> = {
  "ci-failed": { tone: BAD, word: "blocked", reason: "CI failed" },
  "ci-unknown": { tone: BAD, word: "blocked", reason: "CI result unknown" },
  "retry-capped": { tone: BAD, word: "blocked", reason: "retry limit reached" },
  "pin-unresolved": { tone: BAD, word: "blocked", reason: "tag didn't resolve" },
  "declaration-rejected": { tone: BAD, word: "blocked", reason: "declaration rejected" },
  "not-applied": { tone: BAD, word: "blocked", reason: "not applied" },
  "image-unavailable": { tone: BAD, word: "blocked", reason: "image unavailable" },
  "provenance-failed": { tone: BAD, word: "blocked", reason: "provenance check failed" },
  "token-missing": { tone: BAD, word: "blocked", reason: "no GitHub token on the host" },
  "env-mismatch": { tone: BAD, word: "blocked", reason: ".env doesn't match" },
  "ci-pending": { tone: NEUTRAL, word: "waiting", reason: "CI running" },
  "host-pending": { tone: NEUTRAL, word: "waiting", reason: "waiting for systemd" },
};

/**
 * Classifies a reconciled entry's last run. `failed` needs no code: a failed
 * run is always trouble. `blocked` is trouble only for a code in the table, so
 * a blocked row from an older inventory without gate_code, an empty code and a
 * code this app does not know all read as no trouble rather than a guess.
 * Any other result never produces a line.
 */
export function deployTrouble(entry: { result?: string; gateCode?: string }): DeployTrouble | null {
  if (entry.result === "failed") return { tone: BAD, word: "failed", reason: "deploy failed" };
  if (entry.result !== "blocked" || entry.gateCode === undefined) return null;
  return Object.hasOwn(BLOCKED_TROUBLE, entry.gateCode) ? { ...BLOCKED_TROUBLE[entry.gateCode] } : null;
}

export interface HostProblem {
  /** The inventory's name for the unit, which is what the board's rows are keyed by. */
  name: string;
  /** The unit's status word, as the board would show it. */
  word: string;
  /** What the operator loses while it stays that way. */
  consequence: string;
  page: "infrastructure" | "reconciler";
  href: "/infrastructure" | "/reconciler";
}

/**
 * Caddy and the sites tunnel are named in code, not only read from the
 * inventory: they are what carries every site, and the sites list must still
 * notice them down when the inventory is missing. The name is the inventory's
 * when it lists the unit, else this fallback.
 */
const FIXED_UNITS = [
  { name: "caddy", unit: "caddy.service" },
  { name: "cloudflared-sites", unit: "cloudflared-sites.service" },
] as const;

const WATCH_TIMER = "lychee-watch.timer";

const SITES_DOWN = "Every site is unreachable from outside";

/** The words that are bad on the board: this mirrors the bad tone rowLabels
 *  gives them. paused and unhealthy are kept for that mirroring but cannot
 *  reach this function, since a UnitStatus never takes them. */
const BAD_WORDS = new Set(["exited", "restarting", "paused", "unhealthy"]);

interface HostUnit {
  name: string;
  unit: string;
}

/** The inventory's unit entries in one group; none when it is missing or empty. */
function groupUnits(inventory: ServiceInventory | null, group: "infrastructure" | "reconciler"): HostUnit[] {
  if (!inventory) return [];
  const out: HostUnit[] = [];
  for (const e of inventory.entries) {
    if (e.kind === "unit" && e.group === group) out.push({ name: e.name, unit: e.unit });
  }
  return out;
}

/** Fixed units first (inventory name when listed), then the other
 *  infrastructure units in inventory order, each unit once. */
function infrastructureUnits(inventory: ServiceInventory | null): HostUnit[] {
  const listed = groupUnits(inventory, "infrastructure");
  const out: HostUnit[] = FIXED_UNITS.map((f) => ({
    name: listed.find((l) => l.unit === f.unit)?.name ?? f.name,
    unit: f.unit,
  }));
  for (const l of listed) {
    if (!out.some((o) => o.unit === l.unit)) out.push(l);
  }
  return out;
}

/** Reconciler units, minus any already counted as infrastructure. */
function reconcilerUnits(inventory: ServiceInventory | null): HostUnit[] {
  const infra = infrastructureUnits(inventory);
  return groupUnits(inventory, "reconciler").filter((r) => !infra.some((i) => i.unit === r.unit));
}

/** The unit names whose state the sites list must read to decide hostProblems. */
export function hostProblemUnits(inventory: ServiceInventory | null): string[] {
  const units: string[] = [];
  for (const u of [...infrastructureUnits(inventory), ...reconcilerUnits(inventory)]) {
    if (!units.includes(u.unit)) units.push(u.unit);
  }
  return units;
}

/**
 * Host units that are down and what that costs, infrastructure first. The
 * sites list reads no host state otherwise, so a Caddy outage would leave it
 * green; this is the one place that says otherwise.
 */
export function hostProblems(
  unitStates: Record<string, UnitState>,
  inventory: ServiceInventory | null,
): HostProblem[] {
  const problems: HostProblem[] = [];
  const word = (unit: string): string | null => {
    const status = unitStates[unit]?.status;
    return status && BAD_WORDS.has(status) ? status : null;
  };

  for (const i of infrastructureUnits(inventory)) {
    const w = word(i.unit);
    if (w) problems.push({ name: i.name, word: w, consequence: SITES_DOWN, page: "infrastructure", href: "/infrastructure" });
  }

  // Assumes the inventory's `infrastructure` and `reconciler` groups hold only
  // long-lived units (timers, daemons). A oneshot service there would sit
  // inactive -> exited between runs and show as a permanent false problem.
  // The watcher is matched by name so it can never be taken for the full-run
  // timer, whatever order the inventory lists them in.
  const units = reconcilerUnits(inventory);
  const fullRun = inventory
    ? findTimerUnit({ ...inventory, entries: inventory.entries.filter((e) => e.kind !== "unit" || e.unit !== WATCH_TIMER) })
    : null;
  for (const r of units) {
    const w = word(r.unit);
    if (!w) continue;
    const consequence =
      r.unit === WATCH_TIMER
        ? "Changes wait for the 15-minute full run"
        : r.unit === fullRun
          ? "The 15-minute full run has stopped"
          : "Deploys may not apply";
    problems.push({ name: r.name, word: w, consequence, page: "reconciler", href: "/reconciler" });
  }
  return problems;
}
