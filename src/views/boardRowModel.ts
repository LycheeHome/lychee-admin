// What a services-board row's controls say and which of them it shows, as
// data and class strings. The React board (src/client/components/BoardRows.tsx)
// renders from this, as the retired server board did, so the two could not
// disagree about which controls a row carries or what they say.
// boardFacts.ts holds the row's words; this file holds everything around
// them. No node imports: Vite bundles this file into the client.
import type { HostAction } from "../lib/platform";
import type { ActionState } from "../lib/hostOperations";
import { describeStatus, type DeployTrouble, type StatusLabels, type StatusTone } from "../lib/siteDisplay";
import { hostnameForResource, isSiteName } from "../lib/siteNames";
import type { BoardRow, ServiceBoard } from "../lib/serviceBoard";
import type { ServiceGroup } from "../lib/serviceInventory";
import { offeredTag, rowVerdict } from "./boardFacts";
import { FOCUS_RING, formatAge, formatDuration } from "./shared";

/** A run in progress names itself on the pill, neutral, the way `applying` does. */
export const ACTION_RUNNING_WORD: Record<HostAction, string> = {
  start: "starting",
  stop: "stopping",
  restart: "restarting",
  update: "updating",
};
export const ACTION_LABEL: Record<HostAction, string> = { start: "Start", stop: "Stop", restart: "Restart", update: "Update" };
/** Strip order: the way up first, then the two that cycle it, then the way down. */
export const ACTION_ORDER: readonly HostAction[] = ["start", "restart", "update", "stop"];

/**
 * The three actions that disconnect players ask first, inline, in place of the
 * strip. Start does not: nobody is on a server that is down. Copy names what
 * happens to the people on it, because that is the cost the operator weighs.
 */
export const ACTION_CONFIRM: Partial<Record<HostAction, { copy: (unit: string) => string; go: string }>> = {
  stop: {
    copy: (u) => `Stop ${u}? Everyone on the server is disconnected, and it stays down until someone starts it.`,
    go: "Stop server",
  },
  restart: { copy: (u) => `Restart ${u}? Everyone on the server is disconnected for about a minute.`, go: "Restart server" },
  update: {
    copy: (u) => `Update ${u}? The server stops, steamcmd updates it, then it starts again; everyone is disconnected until it's back.`,
    go: "Update server",
  },
};

/**
 * An action's log, in full and wrapping — the multi-line Command Block's
 * reading shape without its copy button, since this is output to read rather
 * than text to paste. Never clipped: the tail is already bounded at 50 lines.
 */
export const LOG_TAIL =
  "font-mono text-[0.72rem] leading-[1.6] bg-stone-900 border border-stone-700 rounded-md px-3 py-2.5 text-stone-300 whitespace-pre-wrap [overflow-wrap:anywhere] m-0 mt-1.5";
/** The inline confirmation: Stop's sits in the Danger card's wash, the others on Hearth Lift. */
const CONFIRM_BASE = "mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-2.5";
export const CONFIRM_DANGER = `${CONFIRM_BASE} border border-red-900/60 bg-red-950/20`;
export const CONFIRM_QUIET = `${CONFIRM_BASE} border border-stone-700 bg-stone-800`;
/** The finished log's disclosure summary; SERVICE_DETAIL is prepended by the renderer. */
export const LOG_SUMMARY = `w-fit cursor-pointer rounded-sm marker:text-stone-500 hover:text-stone-300 ${FOCUS_RING}`;
/** The pulsing dot before a running action's fact. */
export const RUNNING_DOT = "inline-block h-1.5 w-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse align-middle mr-1.5";
/** A managed site's resource name, linked to its page. */
export const SITE_NAME_LINK = `text-stone-50 no-underline hover:underline ${FOCUS_RING}`;

/**
 * Whether a host action is running. The one predicate for "active": the strip
 * disables its buttons on it, the pill names the action on it, and the client
 * polls faster on it.
 */
export function isRunning(run: ActionState | undefined): run is ActionState & { state: "running" } {
  return run?.state === "running";
}

/** The pill: a running host action replaces it, neutral, the way `applying` does. */
export function rowPill(labels: StatusLabels, run: ActionState | undefined): StatusLabels {
  return isRunning(run) ? { ...labels, pill: ACTION_RUNNING_WORD[run.action], tone: "neutral" } : labels;
}

/**
 * A pill that says `unknown` is a failed read, not a state; this says which
 * read. Null while an action runs, since that word replaces the pill.
 */
export function unknownSentence(row: BoardRow, labels: StatusLabels, run: ActionState | undefined): string | null {
  if (labels.pill !== "unknown" || isRunning(run)) return null;
  return row.kind === "container"
    ? "lychee-admin couldn't read this container's state."
    : "lychee-admin couldn't read this unit's state from systemd.";
}

/**
 * The hostname a row's name links to, or null. A site's row links to its
 * page, but only when the app manages that hostname: a name that merely ends
 * in the suffix is not a site.
 */
export function siteLinkHost(name: string, domain: string, managed: ReadonlySet<string>): string | null {
  const host = hostnameForResource(name, domain);
  return host && managed.has(host) ? host : null;
}

/** The retiring line's reason: what Prune waits for, true whether or not the down succeeds. */
export const RETIRING_REASON = "Prune follows once the reconciler confirms the container down";

/**
 * A retired site row's treatment. `down`: confirmed down (the server's
 * `prunable`), so the pill reads `retired` and Prune follows. `retiring`:
 * retired but not yet confirmed down, so the pill keeps the live state and a
 * retiring line says why there is no Prune yet. Null for every other row, and
 * for a non-site name whatever the caller passed: a hand-declared resource
 * (palsave-api) is never pruned from here.
 */
export function retiredRow(
  name: string,
  prunable: ReadonlySet<string>,
  retiring: ReadonlySet<string>,
  domain: string,
): "down" | "retiring" | null {
  if (!isSiteName(name, domain)) return null;
  if (prunable.has(name)) return "down";
  return retiring.has(name) ? "retiring" : null;
}

/** What decides how a board row reads beyond its own facts: the retired sets, the domain, and a running host action. */
export interface RowShownContext {
  prunable: ReadonlySet<string>;
  retiring: ReadonlySet<string>;
  domain: string;
  run: ActionState | undefined;
}

/**
 * How the board shows a row: its verdict, then a retired site confirmed down
 * reading `retired`, then a running host action's word. The board draws it and
 * the rail counts it, so a page's count and its summary line name the same rows.
 */
export function rowShown(
  row: BoardRow,
  ctx: RowShownContext,
): { labels: StatusLabels; trouble: DeployTrouble | null; retired: "down" | "retiring" | null } {
  const { labels: verdict, trouble } = rowVerdict(row);
  const retired = retiredRow(row.name, ctx.prunable, ctx.retiring, ctx.domain);
  // Confirmed down, the row says what its site page says; before that, the
  // pill stays the container's live state, which is the board's job.
  const labels = retired === "down" ? describeStatus({ kind: "retired" }) : rowPill(verdict, ctx.run);
  return { labels, trouble, retired };
}

/**
 * The row's offer, or null. `requested` is true once the declaration already
 * holds the offered tag, and the requested line stands in its place. A pending
 * tag that is not the offered one leaves the offer alone: it is a different
 * request.
 */
export function rowOffer(row: BoardRow, pending: string | undefined): { tag: string; requested: boolean } | null {
  const tag = offeredTag(row);
  return tag ? { tag, requested: pending === tag } : null;
}

/**
 * Which host actions a unit row shows, in strip order. Start, Stop and Restart
 * follow the unit's live state: Start only when it is not up, Stop and Restart
 * only when it is not down. A state this page could not read (`unknown`)
 * shows all three, because hiding any would be a guess. Empty for a row
 * without a strip; a strip can also be empty, when every listed action is
 * hidden by the live state.
 */
export function shownActions(row: BoardRow): HostAction[] {
  if (!hasHostActions(row)) return [];
  const listed = new Set(row.actions);
  const up = row.status === "running" || row.status === "starting" || row.status === "restarting";
  const down = row.status === "exited";
  return ACTION_ORDER.filter((a) => listed.has(a) && !(a === "start" && up) && !((a === "stop" || a === "restart") && down));
}

/** Whether a row carries the host-action strip: a unit whose entry lists actions. A row without is exactly the row it was before actions existed. */
export function hasHostActions(row: BoardRow): row is BoardRow & { kind: "unit"; actions: HostAction[] } {
  return row.kind === "unit" && Boolean(row.actions && row.actions.length > 0);
}

/** A row's last run as a fact: "update succeeded · 2 hours ago · took 3m 41s", or the running form. */
export type ActionFact =
  | { running: true; action: HostAction; started: string | null }
  | { running: false; action: HostAction; state: "succeeded" | "failed"; tone: StatusTone; age: string | null; took: string | null };

export function actionFact(run: ActionState | undefined, now: Date): ActionFact | null {
  if (!run || run.state === "idle") return null;
  if (isRunning(run)) return { running: true, action: run.action, started: formatAge(run.startedAt, now) };
  // Neither idle nor running, so finished: failed or succeeded.
  const failed = run.state === "failed";
  return {
    running: false,
    action: run.action,
    state: failed ? "failed" : "succeeded",
    tone: failed ? "bad" : "ok",
    age: formatAge(run.finishedAt, now),
    took: formatDuration(run.startedAt, run.finishedAt),
  };
}

/** A finished run's log: a disclosure, open when the run failed; `body` null when there was no output. */
export function actionLog(run: ActionState | undefined): { body: string | null; lines: number; open: boolean } | null {
  if (!run || run.state === "idle" || isRunning(run)) return null;
  const body = run.logTail.trimEnd();
  if (body === "") return { body: null, lines: 0, open: false };
  return { body, lines: body.split("\n").length, open: run.state === "failed" };
}

/** What a running action's live tail shows; empty when no action runs. */
export function actionTail(run: ActionState | undefined): string {
  return isRunning(run) ? run.logTail.trimEnd() || "no output yet" : "";
}

/** The busy note beside a running strip. */
export function actionBusy(name: string): string {
  return `an action is already running on ${name}`;
}

export const GROUP_LABELS: Record<ServiceGroup, string> = {
  reconciler: "Reconciler",
  service: "Services",
  infrastructure: "Infrastructure",
};

/** What a readable inventory with nothing in this group lists. */
const GROUP_NONE: Record<ServiceGroup, string> = {
  reconciler: "reconciler units",
  service: "services",
  infrastructure: "infrastructure units",
};

/** "Inventory written 2 minutes ago", or empty when the inventory is unavailable. */
export function inventoryFreshness(board: Pick<ServiceBoard, "generated" | "inventoryAvailable">, now: Date): string {
  if (!board.inventoryAvailable) return "";
  const written = formatAge(board.generated, now);
  return written ? `Inventory written ${written}` : "Inventory write time unknown";
}

/**
 * What stands in the group's place. An empty board, readable or not, is the
 * unavailable explanation on every page: with nothing declared anywhere,
 * "lists none" would undersell it. `boardEmpty` is whether the WHOLE board had
 * no groups, which a board narrowed to one group no longer shows.
 */
export function boardContent(inventoryAvailable: boolean, boardEmpty: boolean, rows: number): "unavailable" | "rows" | "none" {
  return !inventoryAvailable || boardEmpty ? "unavailable" : rows > 0 ? "rows" : "none";
}

/** The inventory is readable and declares something, just not here: a plain fact, not a fault. */
export function groupNoneSentence(group: ServiceGroup): string {
  return `The inventory lists no ${GROUP_NONE[group]}.`;
}

export function unavailableSentence(group: ServiceGroup): string {
  return `There are no ${GROUP_NONE[group]} to show: the inventory could not be read, or it declares none this page recognises. Without it there is no list of what should be running and nothing to check live state against. It is published by the reconciler on each tick; if it has never run, or the file was removed, this page stays empty.`;
}
