// What a services-board row says, as data. The React board
// (src/client/components/BoardRows.tsx) renders from this, as the retired
// server board did, so the two could not disagree about a row's words. No
// node imports: Vite bundles this file into the client.
import {
  type DeployTrouble,
  type SiteStatus,
  type StatusLabels,
  describeStatus,
  deployTrouble,
  troubleGate,
  undeployedStatus,
} from "../lib/siteDisplay";
import type { BoardRow, ServiceBoard } from "../lib/serviceBoard";
import { formatAge } from "./shared";

/**
 * A board row's status through the same describeStatus() the site pages use,
 * so the services board cannot grow a second vocabulary. Rows are units and
 * containers alike, which is why this takes ServiceStatus rather than
 * UnitStatus: the two words a unit can never produce, `unhealthy` and
 * `paused`, are exactly the ones a container row needs. `starting` and
 * `unhealthy` are the pair that have to be mapped back onto a container's
 * state/health shape, since describeStatus() reads them from there.
 */
export function rowLabels(status: BoardRow["status"]): StatusLabels {
  if (status === "starting") return describeStatus({ kind: "container", state: "running", health: "starting" });
  if (status === "unhealthy") return describeStatus({ kind: "container", state: "running", health: "unhealthy" });
  return describeStatus({ kind: "container", state: status });
}

export type DeployFacts = Pick<BoardRow, "available" | "version" | "target" | "result">;

/**
 * `target` is what the reconciler has been asked to run; `version` is what
 * it last confirmed running. "Applying" means the reconciler last ran
 * cleanly (`deployed` or `skipped`) and the pin has since moved, so the next
 * tick will install it. A moved pin on a `blocked` or `failed` row is NOT
 * applying: the retry cap, an unresolvable pin and a red CI gate all leave
 * target != version indefinitely while the old build keeps running, and
 * calling that "applying" would promise progress that is never coming.
 * An allowlist, not a denylist, because `result` can also be absent or
 * `unknown`, and those must not read as applying either.
 */
export function isApplying(row: DeployFacts): boolean {
  const settled = row.result === "deployed" || row.result === "skipped";
  return settled && Boolean(row.version && row.target && row.target !== row.version);
}

/**
 * The tag a row offers, or null. Nothing is offered while a deploy is in
 * flight (applying), because a second request on top of an unapplied one would
 * race the first, and the pinned tag is never offered again, so the tag that
 * just failed or was blocked cannot be re-requested from here.
 *
 * `blocked` and `failed` both offer anything else. The failure stays visible
 * beside the offer (the gate line, or the failure line naming the tag, the
 * step and the journal), and the reconciler retries the failing pin every
 * tick, so a different, newer tag is the way out; withholding it left a hand
 * edit of lychee-resources as the only one. A failed row is never applying:
 * isApplying() requires a clean last run.
 *
 * Shared by the services board (both renderers) and a site's own page, so
 * they can never disagree about whether a tag is on offer.
 */
export function offeredTag(row: DeployFacts): string | null {
  return row.available && row.available !== row.version && row.available !== row.target && !isApplying(row)
    ? row.available
    : null;
}

export interface RowSummary {
  applying: boolean;
  /** Non-null for a container with nothing installed: the reconciler's verdict stands in for its live state. */
  undeployed: SiteStatus | null;
  /** The pill before any running host action replaces it: `applying` (neutral) unless the live state is already red. */
  labels: StatusLabels;
  /** The deploy-state line, or null. */
  trouble: DeployTrouble | null;
  /** The gate sentence, shown in full, or null. */
  gate: string | null;
  /** The facts line's parts, joined with " · " by the renderer. */
  facts: string[];
}

/**
 * A row's verdict: its pill and its deploy line. The board and the rail's
 * counts both read it, so a board page's count and its summary line can never
 * name different rows.
 */
export function rowVerdict(row: BoardRow): Pick<RowSummary, "applying" | "undeployed" | "labels" | "trouble"> {
  const applying = isApplying(row);
  // A container with no installed version reads the reconciler's verdict, as
  // the site page does: the container is not asked about a version that was
  // never installed, and its live state would contradict that page.
  const undeployed = row.kind === "container" ? undeployedStatus(row) : null;
  const live = undeployed ? describeStatus(undeployed) : rowLabels(row.status);
  // Neutral, and only while the live state is not already red: "applying"
  // must never hide a container that is actually failing.
  const labels = applying && live.tone !== "bad" ? { ...live, pill: "applying", tone: "neutral" as const } : live;
  // The pill stays the thing's own health; a deploy that is blocked or failed
  // gets its own line, so a healthy old build never reads as a broken one. An
  // undeployed container's trouble is already its pill, so it gets no line.
  const trouble = undeployed ? null : deployTrouble(row);
  return { applying, undeployed, labels, trouble };
}

/** Everything a row says except its controls, which each renderer owns. `now` is a parameter so ages are testable. */
export function summarizeRow(row: BoardRow, board: Pick<ServiceBoard, "schedule" | "timerUnit">, now: Date): RowSummary {
  const { applying, undeployed, labels, trouble } = rowVerdict(row);

  const facts: string[] = [];
  // One fact with an arrow, not two: version and target are a single change.
  if (applying) facts.push(`${row.version} → ${row.target}`);
  else if (row.version) facts.push(row.version);
  const gate = troubleGate(row);
  // The raw result word is the reconciler's vocabulary (`skipped`, `deployed`,
  // `awaiting-image`), not the operator's, so it is never printed. The one
  // exception is a blocked run with no deploy line to say so: without it the
  // row would not say the deploy is blocked at all.
  if (row.result === "blocked" && !trouble) facts.push(row.result);
  if (row.failedAttempts) facts.push(`${row.failedAttempts} ${row.failedAttempts === 1 ? "attempt" : "attempts"}`);
  const changed = formatAge(row.since, now);
  if (changed) facts.push(`changed ${changed}`);

  // The full-run timer carries the schedule, as the board does; the watcher's
  // timer row shows only its state.
  if (row.kind === "unit" && row.unit === board.timerUnit) {
    // Only a future time is a "next run". A timer that has just fired or not
    // yet computed its next elapse is normal, and a past "next" would render
    // as a negative interval, so it says nothing. new Date() because over
    // JSON the schedule arrives as strings.
    const upcoming = board.schedule.next && new Date(board.schedule.next).getTime() > now.getTime();
    const next = upcoming ? formatAge(board.schedule.next, now) : null;
    const last = formatAge(board.schedule.last, now);
    if (next) facts.push(`next run ${next}`);
    if (last) facts.push(`last run ${last}`);
  }

  return { applying, undeployed, labels, trouble, gate, facts };
}
