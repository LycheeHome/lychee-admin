// What the services board does with one answer from a host action's state
// route: keep going, show the running state, or stop and reload so the server
// render decides. Pure, so the one property that matters is tested
// (src/views/actionPoll.test.ts): the poll always ends.
//
// A classic script, loaded before app.js, which reads it as a global; the
// footer also exports it for the Node test. No module syntax, so it runs as
// served with no build step.
(function (root) {
  // Consecutive 502s or network failures this long, and the poll gives up.
  // Long enough to ride out lychee-admin restarting mid-update (every deploy
  // restarts it), short enough that a broken read does not poll for ever.
  const POLL_GIVE_UP_MS = 60000;
  // After a click, a settled state that started before the click (less this
  // slack for clock skew) is the previous run, read before systemd picked up
  // the new job. STALE_POLLS of those and the page reloads anyway.
  const STALE_SLACK_MS = 30000;
  const STALE_POLLS = 5;

  /**
   * outcome: { kind: "response", status, body } or { kind: "network-error" }.
   * memo: { failingSince, stalePolls }, threaded from one poll to the next.
   * clickedAt: when this page asked for the action, or null when it was
   * rendered mid-run (then any settled state is the run's own end).
   * Returns { next: "continue" | "update" | "reload", memo }.
   */
  function decidePoll(outcome, memo, now, clickedAt) {
    const transient =
      outcome.kind === "network-error" || (outcome.kind === "response" && outcome.status >= 500);
    if (transient) {
      const failingSince = memo.failingSince ?? now;
      return {
        next: now - failingSince >= POLL_GIVE_UP_MS ? "reload" : "continue",
        memo: { ...memo, failingSince },
      };
    }

    // Any other non-2xx (401 credentials changed, 403 refused, 404 the unit or
    // action is no longer listed) will not get better by asking again.
    const body = outcome.body;
    const state = body && typeof body === "object" && body.ok === true ? body.state : undefined;
    if (outcome.status < 200 || outcome.status >= 300 || !state || typeof state !== "object") {
      return { next: "reload", memo };
    }

    const ok = { ...memo, failingSince: null };
    if (state.state === "running") return { next: "update", memo: ok };

    if (clickedAt !== null) {
      const started = Date.parse(state.startedAt ?? "");
      const stale =
        state.state === "idle" || !Number.isFinite(started) || started < clickedAt - STALE_SLACK_MS;
      if (stale && ok.stalePolls + 1 < STALE_POLLS) {
        return { next: "continue", memo: { ...ok, stalePolls: ok.stalePolls + 1 } };
      }
    }
    return { next: "reload", memo: ok };
  }

  const api = { decidePoll, POLL_GIVE_UP_MS, STALE_POLLS };
  root.actionPoll = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
