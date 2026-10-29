import type { AuditLine } from "../lib/auditLog";
import type { Lifetime, ReconcilerEvent } from "../lib/reconcilerEvents";
import { hostnameForResource } from "../lib/siteNames";
import type { ActivityEvent, ActivityFilters, ActivityKind } from "../shared/activity";

export interface ActivityContext {
  domain: string;
  /** Managed hostnames in the Caddyfile; null when it could not be read (no site links then). */
  sites: ReadonlySet<string> | null;
  /** Inventory name → board-row href, for every listed entry. */
  units: ReadonlyMap<string, string>;
}

type Outcome = { kind: ActivityKind; outcome: string; tone: ActivityEvent["tone"]; detail: string | null };

const ok = (kind: ActivityKind, outcome: string): Outcome => ({ kind, outcome, tone: "ok", detail: null });
const bad = (kind: ActivityKind, outcome: string, detail: string | null = null): Outcome => ({ kind, outcome, tone: "bad", detail });
const neutral = (kind: ActivityKind, outcome: string): Outcome => ({ kind, outcome, tone: "neutral", detail: null });

/** Every event type has a row, so a type the feed gains is a type error here. */
const RECONCILER: { [T in ReconcilerEvent["type"]]: (e: Extract<ReconcilerEvent, { type: T }>) => Outcome } = {
  deployed: (e) => ok("deploy", e.from === null ? `deployed ${e.to}` : `deployed ${e.from} → ${e.to}`),
  failed: (e) => bad("deploy", `failed at ${e.failed_step.split(": ")[0]}`, e.failed_step),
  blocked: (e) => bad("deploy", `blocked · ${e.gate_code}`, e.gate || null),
  "awaiting-image": () => neutral("deploy", "awaiting image"),
  recovered: (e) => ok("deploy", `recovered after ${e.attempts} ${e.attempts === 1 ? "attempt" : "attempts"}`),
  stopped: () => neutral("stop", "stopped"),
  down: (e) => neutral("stop", `down, was ${e.from}`),
  added: () => neutral("add", "declared"),
  removed: () => neutral("remove", "pruned"),
};

/** A base action's kind and its success outcome; `deploy-service` and `host-action` build theirs from the line. */
const AUDIT = {
  "add-site": { kind: "add", outcome: "added" },
  "remove-site": { kind: "remove", outcome: "removed" },
  "delete-site-files": { kind: "files", outcome: "files deleted" },
  "deploy-service": { kind: "deploy", outcome: "requested" },
  "attach-site": { kind: "attach", outcome: "attached" },
  "detach-site": { kind: "remove", outcome: "retired" },
  "change-repository": { kind: "repository", outcome: "repository changed" },
  "prune-declaration": { kind: "prune", outcome: "pruned" },
  // Not shown: sameOrigin logs it for any refused cross-site mutation, with the Host header as hostname.
  "refused-cross-site": null,
  "host-action": { kind: "host", outcome: "started" },
} satisfies Record<string, { kind: ActivityKind; outcome: string } | null>;

type BaseAction = keyof typeof AUDIT;

/** Longest first, so `-rollback-failed` is not read as `-failed`. */
const SUFFIXES = [
  ["-rollback-failed", "rollback failed"],
  ["-rolled-back", "rolled back"],
  ["-failed", "failed"],
  ["-refused", "refused"],
] as const;

const isBase = (a: string): a is BaseAction => Object.hasOwn(AUDIT, a);

function auditOutcome(line: AuditLine): Outcome | null {
  let base = line.action;
  let variant: string | null = null;
  for (const [suffix, word] of SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      variant = word;
      break;
    }
  }
  if (!isBase(base)) return null;
  const entry = AUDIT[base];
  if (entry === null) return null;
  const { kind, outcome } = entry;
  if (variant) return bad(kind, variant, variant === "rolled back" ? null : (line.detail ?? null));
  if (base === "deploy-service") return neutral(kind, line.detail ? `${line.detail} requested` : outcome);
  if (base === "host-action") {
    const action = line.hostAction ?? "action";
    return line.outcome?.startsWith("refused")
      ? bad(kind, `${action} refused`, line.outcome.replace(/^refused:?\s*/, "") || null)
      : neutral(kind, `${action} started`);
  }
  return neutral(kind, outcome);
}

/** A site resource shows as its hostname; it links to the site while that is in the Caddyfile, else to its board row, else nowhere. */
function subjectOf(raw: string, ctx: ActivityContext): { subject: string; href: string | null } {
  const subject = hostnameForResource(raw, ctx.domain) ?? raw;
  if (ctx.sites?.has(subject)) return { subject, href: `/sites/${encodeURIComponent(subject)}` };
  return { subject, href: ctx.units.get(raw) ?? null };
}

interface Ranked {
  ms: number;
  seq: number;
  event: ActivityEvent;
}

/**
 * The audit log and the reconciler's history as one list, newest first. Times
 * are compared as parsed milliseconds, never as text, because the two sources
 * write different precisions; an unparseable time is dropped. A tick's events
 * share an `at` and arrive in A-HIST-1 order, so the later file position wins
 * a tie; across sources the reconciler's comes first, being the effect.
 */
export function buildActivity(
  audit: AuditLine[] | null,
  lifetimes: Lifetime[] | null,
  ctx: ActivityContext,
  limit: number,
): ActivityEvent[] {
  const ranked: Ranked[] = [];
  let seq = 0;
  const push = (at: string, event: ActivityEvent) => {
    const ms = Date.parse(at);
    seq += 1;
    if (Number.isNaN(ms)) return;
    ranked.push({ ms, seq, event });
  };

  for (const line of audit ?? []) {
    const mapped = auditOutcome(line);
    if (!mapped) {
      seq += 1;
      continue;
    }
    const { subject, href } = subjectOf(line.unit ?? line.hostname ?? "", ctx);
    push(line.timestamp, { at: line.timestamp, who: "app", subject, href, ...mapped });
  }
  for (const lifetime of lifetimes ?? []) {
    const { subject, href } = subjectOf(lifetime.name, ctx);
    for (const e of lifetime.events) {
      const mapped = (RECONCILER[e.type] as (e: ReconcilerEvent) => Outcome)(e);
      push(e.at, { at: e.at, who: "reconciler", subject, href, ...mapped });
    }
  }

  ranked.sort(
    (a, b) =>
      b.ms - a.ms ||
      (a.event.who === b.event.who ? 0 : a.event.who === "reconciler" ? -1 : 1) ||
      b.seq - a.seq,
  );
  return ranked.slice(0, Math.max(0, limit)).map((r) => r.event);
}

/** A cursor that does not decode to a position; the route answers it with a 400. */
export class ActivityCursorError extends Error {}

const b64urlEncode = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function decodeCursor(cursor: string): { t: number; n: number } {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
    if (typeof parsed === "object" && parsed !== null) {
      const { t, n } = parsed as { t?: unknown; n?: unknown };
      if (typeof t === "number" && Number.isInteger(t) && typeof n === "number" && Number.isInteger(n) && n > 0) return { t, n };
    }
  } catch {
    // falls through to the typed error
  }
  throw new ActivityCursorError("malformed cursor");
}

/**
 * One page of `events` (`buildActivity`'s full ordered output): filtered, then
 * everything up to the cursor skipped, then `limit` taken. The cursor is the
 * last returned event's time in milliseconds plus how many events at exactly
 * that time have been returned so far, so a tick a page boundary splits
 * resumes in the middle instead of repeating or dropping its rest. `subjects`
 * is every distinct subject of the unfiltered list.
 */
export function pageActivity(
  events: ActivityEvent[],
  query: ActivityFilters & { before: string | null; limit: number },
): { events: ActivityEvent[]; next: string | null; subjects: string[] } {
  const subjects = [...new Set(events.map((e) => e.subject))].sort((a, b) => a.localeCompare(b));
  const subject = query.subject?.toLowerCase() ?? null;
  const matched = events.filter(
    (e) =>
      (subject === null || e.subject.toLowerCase() === subject) &&
      (query.who === null || e.who === query.who) &&
      (query.kind === null || e.kind === query.kind),
  );

  let start = 0;
  if (query.before !== null) {
    const { t, n } = decodeCursor(query.before);
    while (start < matched.length && Date.parse(matched[start].at) > t) start += 1;
    let skipped = 0;
    while (skipped < n && start < matched.length && Date.parse(matched[start].at) === t) {
      start += 1;
      skipped += 1;
    }
  }

  const end = Math.min(matched.length, start + Math.max(0, query.limit));
  const page = matched.slice(start, end);
  if (end >= matched.length || page.length === 0) return { events: page, next: null, subjects };
  const t = Date.parse(page[page.length - 1].at);
  // Events at this time already returned: earlier pages' share of it plus this page's.
  let n = 0;
  for (let i = end - 1; i >= 0 && Date.parse(matched[i].at) === t; i -= 1) n += 1;
  return { events: page, next: b64urlEncode(JSON.stringify({ t, n })), subjects };
}

/** `now`, `<n>m`, `<n>h` or `<n>d`; a future time reads `now`, never a negative age. */
export function shortAge(at: string, now: Date): string {
  const seconds = Math.floor((now.getTime() - Date.parse(at)) / 1000);
  if (!(seconds >= 60)) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
