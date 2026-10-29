import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { activityPageQuery, fetchActivityPage } from "./activity";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, body: unknown): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { urls };
}

const ok = { ok: true, events: [], next: null, subjects: [], sources: { app: true, reconciler: true }, now: "x" };

test("fetchActivityPage builds the URL from filters and cursor", async () => {
  const s = stub(200, ok);
  await fetchActivityPage({ subject: null, who: null, kind: null }, null);
  await fetchActivityPage({ subject: "a.lychee.land", who: "app", kind: "deploy" }, "abc");
  assert.equal(s.urls[0], "/api/activity?limit=50");
  assert.equal(s.urls[1], "/api/activity?limit=50&subject=a.lychee.land&who=app&kind=deploy&before=abc");
});

test("fetchActivityPage throws the server's reason", async () => {
  stub(400, { ok: false, reason: "unknown kind: nope" });
  await assert.rejects(fetchActivityPage({ subject: null, who: null, kind: "nope" }, null), /unknown kind: nope/);
});

test("activityPageQuery key and paging", () => {
  const q = activityPageQuery({ subject: "s", who: null, kind: "add" });
  assert.deepEqual(q.queryKey, ["activity-page", "s", null, "add"]);
  assert.equal(q.initialPageParam, null);
  assert.equal(q.getNextPageParam({ next: "n" } as never), "n");
});
