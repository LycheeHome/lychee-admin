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
 * Caddy and the sites tunnel are named in code, not read from the inventory:
 * they are what carries every site, and the sites list must still notice them
 * down when the inventory is missing.
 */
const FIXED_UNITS = [
  { name: "caddy", unit: "caddy.service", consequence: "Every site is unreachable from outside" },
  { name: "cloudflared-sites", unit: "cloudflared-sites.service", consequence: "Every site is unreachable from outside" },
] as const;

const WATCH_TIMER = "lychee-watch.timer";

/** The words that are bad on the board: this mirrors the bad tone rowLabels
 *  gives them. starting, unknown and running are not problems. */
const BAD_WORDS = new Set(["exited", "restarting", "paused", "unhealthy"]);

/** The inventory's reconciler units, or none when it is missing or empty. */
function reconcilerUnits(inventory: ServiceInventory | null) {
  if (!inventory) return [];
  const out: { name: string; unit: string }[] = [];
  for (const e of inventory.entries) {
    if (e.kind === "unit" && e.group === "reconciler") out.push({ name: e.name, unit: e.unit });
  }
  return out;
}

/** The unit names whose state the sites list must read to decide hostProblems. */
export function hostProblemUnits(inventory: ServiceInventory | null): string[] {
  const units: string[] = FIXED_UNITS.map((f) => f.unit);
  for (const r of reconcilerUnits(inventory)) {
    if (!units.includes(r.unit)) units.push(r.unit);
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

  for (const f of FIXED_UNITS) {
    const w = word(f.unit);
    if (w) problems.push({ name: f.name, word: w, consequence: f.consequence, page: "infrastructure", href: "/infrastructure" });
  }

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
