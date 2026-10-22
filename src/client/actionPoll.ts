/*
 * What the services board does with one answer from a host action's state
 * route: keep going, show the running state, or stop and re-read the board so
 * the server's reading decides. A typed port of public/actionPoll.js, with
 * the same constants and the same decisions; its tests are ported too
 * (actionPoll.test.ts). The one property that matters: the poll always ends.
 *
 * "reload" keeps its name from the original, where it reloaded the page. The
 * React board re-fetches the board instead (HostActions in BoardRows.tsx).
 */

/**
 * Consecutive 502s or network failures this long, and the poll gives up.
 * Long enough to ride out lychee-admin restarting mid-update (every deploy
 * restarts it), short enough that a broken read does not poll for ever.
 */
export const POLL_GIVE_UP_MS = 60000;
/**
 * After a click, a settled state that started before the click (less this
 * slack for clock skew) is the previous run, read before systemd picked up
 * the new job. STALE_POLLS of those and the poll ends anyway.
 */
export const STALE_SLACK_MS = 30000;
export const STALE_POLLS = 5;

/** One answer from GET /services/:name/actions/:action/state, or none at all. */
export type PollOutcome = { kind: "response"; status: number; body: unknown } | { kind: "network-error" };
/** Threaded from one poll to the next. */
export type PollMemo = { failingSince: number | null; stalePolls: number };
export type PollDecision = { next: "continue" | "update" | "reload"; memo: PollMemo };

type StateLike = { state?: unknown; startedAt?: unknown };

/**
 * `clickedAt` is when this page asked for the action, or null when the run
 * was already under way when the board was read (then any settled state is
 * the run's own end).
 */
export function decidePoll(outcome: PollOutcome, memo: PollMemo, now: number, clickedAt: number | null): PollDecision {
  const transient = outcome.kind === "network-error" || outcome.status >= 500;
  if (transient) {
    const failingSince = memo.failingSince ?? now;
    return {
      next: now - failingSince >= POLL_GIVE_UP_MS ? "reload" : "continue",
      memo: { ...memo, failingSince },
    };
  }

  // Any other non-2xx (401 credentials changed, 403 refused, 404 the unit or
  // action is no longer listed) will not get better by asking again.
  const body = outcome.body as { ok?: unknown; state?: unknown } | null;
  const state = body && typeof body === "object" && body.ok === true ? body.state : undefined;
  if (outcome.status < 200 || outcome.status >= 300 || !state || typeof state !== "object") {
    return { next: "reload", memo };
  }
  const s = state as StateLike;

  const ok: PollMemo = { ...memo, failingSince: null };
  if (s.state === "running") return { next: "update", memo: ok };

  if (clickedAt !== null) {
    const started = Date.parse(typeof s.startedAt === "string" ? s.startedAt : "");
    const stale = s.state === "idle" || !Number.isFinite(started) || started < clickedAt - STALE_SLACK_MS;
    if (stale && ok.stalePolls + 1 < STALE_POLLS) {
      return { next: "continue", memo: { ...ok, stalePolls: ok.stalePolls + 1 } };
    }
  }
  return { next: "reload", memo: ok };
}
