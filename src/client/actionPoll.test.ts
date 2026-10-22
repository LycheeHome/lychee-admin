// The host-action poll's decision, ported from public/actionPoll.js to a
// typed module the React board imports. Every case of
// src/views/actionPoll.test.ts is here, against the port: the one property
// that matters is that the poll always ends.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { POLL_GIVE_UP_MS, STALE_POLLS, STALE_SLACK_MS, decidePoll, type PollMemo, type PollOutcome } from "./actionPoll";

const FRESH: PollMemo = { failingSince: null, stalePolls: 0 };
const NOW = Date.UTC(2026, 9, 13, 10, 0, 0);
const res = (status: number, body: unknown): PollOutcome => ({ kind: "response", status, body });
const state = (s: string, startedAt?: string) => ({ ok: true, state: { unit: "u", action: "restart", state: s, logTail: "", ...(startedAt ? { startedAt } : {}) } });

describe("the port keeps public/actionPoll.js's constants", () => {
  test("60s give-up, 30s slack, five stale polls", () => {
    assert.equal(POLL_GIVE_UP_MS, 60000);
    assert.equal(STALE_SLACK_MS, 30000);
    assert.equal(STALE_POLLS, 5);
  });
});

describe("decidePoll: the poll always ends", () => {
  for (const status of [401, 403, 404]) {
    test(`${status} stops and reloads at once`, () => {
      assert.equal(decidePoll(res(status, { ok: false, reason: "x" }), FRESH, NOW, null).next, "reload");
      assert.equal(decidePoll(res(status, {}), FRESH, NOW, NOW - 1000).next, "reload");
    });
  }

  test("an answer with no state stops and reloads", () => {
    assert.equal(decidePoll(res(200, { ok: true }), FRESH, NOW, null).next, "reload");
    assert.equal(decidePoll(res(200, {}), FRESH, NOW, null).next, "reload");
    assert.equal(decidePoll(res(200, { ok: false }), FRESH, NOW, null).next, "reload");
  });

  test("502s and network failures retry, then reload after about a minute of them", () => {
    let memo = FRESH;
    let t = NOW;
    for (const outcome of [res(502, { ok: false }), { kind: "network-error" } as PollOutcome, res(502, {})]) {
      const d = decidePoll(outcome, memo, t, null);
      assert.equal(d.next, "continue");
      memo = d.memo;
      t += 2000;
    }
    assert.equal(decidePoll(res(502, {}), memo, NOW + POLL_GIVE_UP_MS - 1, null).next, "continue");
    assert.equal(decidePoll(res(502, {}), memo, NOW + POLL_GIVE_UP_MS, null).next, "reload");
    assert.equal(decidePoll({ kind: "network-error" }, memo, NOW + POLL_GIVE_UP_MS, null).next, "reload");
  });

  test("a success resets the failure count", () => {
    const failing = decidePoll(res(502, {}), FRESH, NOW, null).memo;
    const ok = decidePoll(res(200, state("running", "2026-10-13T09:59:58.000Z")), failing, NOW + 50_000, null);
    assert.equal(ok.next, "update");
    assert.equal(ok.memo.failingSince, null);
    assert.equal(decidePoll(res(502, {}), ok.memo, NOW + POLL_GIVE_UP_MS + 1000, null).next, "continue");
  });

  test("running keeps polling; succeeded or failed reloads", () => {
    assert.equal(decidePoll(res(200, state("running")), FRESH, NOW, null).next, "update");
    assert.equal(decidePoll(res(200, state("succeeded", "2026-10-13T09:59:58.000Z")), FRESH, NOW, null).next, "reload");
    assert.equal(decidePoll(res(200, state("failed", "2026-10-13T09:59:58.000Z")), FRESH, NOW, NOW - 2000).next, "reload");
  });

  test("after a click, the previous run's settled state waits a few polls, then reloads anyway", () => {
    const old = state("succeeded", "2026-10-13T09:00:00.000Z");
    let memo = FRESH;
    for (let i = 1; i < STALE_POLLS; i++) {
      const d = decidePoll(res(200, old), memo, NOW + i * 2000, NOW);
      assert.equal(d.next, "continue", `poll ${i}`);
      memo = d.memo;
    }
    assert.equal(decidePoll(res(200, old), memo, NOW + STALE_POLLS * 2000, NOW).next, "reload");
    // idle right after a click is the job not yet picked up: also waited out.
    assert.equal(decidePoll(res(200, state("idle")), FRESH, NOW + 2000, NOW).next, "continue");
  });
});
