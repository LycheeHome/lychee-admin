import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ActionState, BoardPayload, ServiceBoard, ServiceGroup } from "../../shared/board";
import type { Site } from "../../lib/caddyfile";
import { PruneLine } from "./DeployLines";
import { SiteDetail } from "./SiteDetail";
import { SERVICE_DETAIL, TONE_PILL, TONE_TEXT, BUTTON_OFFER, BUTTON_DANGER, BUTTON_SECONDARY_COMPACT } from "../../views/shared";
import { Board } from "./BoardRows";
import { canonical } from "../test/canonical";

/*
 * The services board's markup rules, against the React Board. These were
 * src/views/html.test.ts's tests of the server's renderServicesPage, carried
 * over when that renderer was retired: same names, same fixtures, same
 * assertions. Only the renderer behind `renderServicesPage` below changed.
 */

/**
 * The retired renderer's signature, now building the payload the way
 * GET /api/services does (the board narrowed to `group`, "the whole board is
 * empty" alongside it, sets and maps as arrays and records) and rendering it
 * with the React Board, without controls: the board's first paint.
 *
 * The markup is respelled where React and the server wrote the same DOM
 * differently, so the assertions read as they did: `●` as `&#9679;`, U+00A0
 * as `&nbsp;`, `&#x27;` as `&#39;`, and an empty attribute (`data-gate=""`)
 * in its bare form (`data-gate`). Those spellings parse to identical nodes;
 * the frozen parity fixtures (BoardParity.test.tsx) hold the rest of the
 * markup to what the server rendered.
 */
function renderServicesPage(
  board: ServiceBoard,
  now: Date,
  prunable: ReadonlySet<string>,
  domain: string,
  lastRuns: Readonly<Record<string, ActionState>> = {},
  group: ServiceGroup = "service",
  managed: ReadonlySet<string> = new Set(),
  requested: ReadonlyMap<string, string> = new Map(),
): string {
  const payload: BoardPayload = {
    board: { ...board, groups: board.groups.filter((g) => g.group === group) },
    boardEmpty: board.groups.length === 0,
    now: now.toISOString(),
    domain,
    prunable: [...prunable],
    managed: [...managed],
    requested: Object.fromEntries(requested),
    lastRuns: { ...lastRuns },
  };
  return renderToStaticMarkup(<Board payload={payload} group={group} />)
    .replace(/●/g, "&#9679;")
    .replace(/\u00a0/g, "&nbsp;")
    .replace(/&#x27;/g, "&#39;")
    .replace(/ ([a-z][a-z-]*)=""/g, " $1");
}

describe("renderServicesPage", () => {
  const NO_SCHEDULE = { next: null, last: null };
  const NOW = new Date("2026-10-02T05:00:00Z");

  test("an unavailable inventory renders an explanation, not an empty page", () => {
    const html = renderServicesPage({ groups: [], schedule: NO_SCHEDULE, timerUnit: null, generated: null, inventoryAvailable: false }, NOW, new Set(), "lychee.land");
    assert.ok(html.includes("inventory"));
    assert.ok(!html.includes("undefined"));
    assert.ok(!html.includes("NaN"));
  });

  test("a row with no deploy state renders no deploy fields rather than blanks", () => {
    const html = renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: NO_SCHEDULE, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "palworld", kind: "unit", unit: "palworld-palchuds.service", group: "service",
            reconciled: false, status: "running", since: null },
        ] }],
      },
      NOW, new Set(), "lychee.land",
    );
    assert.ok(html.includes("palworld"));
    assert.ok(html.includes("Inventory written 2 minutes ago"));
    assert.ok(!html.includes("undefined"));
    assert.ok(!html.includes("NaN"));
    assert.ok(!html.includes("data-gate"));
    const row = html.slice(html.indexOf('data-service="palworld"'), html.indexOf("</li>"));
    assert.ok(row.includes("palworld"));
    assert.ok(!row.includes(" · "));
  });

  test("an available inventory with no recognised groups explains itself rather than rendering a bare frame", () => {
    const html = renderServicesPage(
      { groups: [], schedule: NO_SCHEDULE, timerUnit: null, generated: "2026-10-02T04:58:00Z", inventoryAvailable: true },
      NOW, new Set(), "lychee.land",
    );
    assert.ok(html.includes('id="inventory-unavailable"'));
  });

  test("a timer whose next run is in the past says nothing about the next run", () => {
    const html = renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: { next: new Date("2026-10-02T04:59:00Z"), last: new Date("2026-10-02T04:58:00Z") },
        timerUnit: "lychee-reconcile.timer",
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "reconciler", rows: [
          { name: "lychee-reconcile-timer", kind: "unit", unit: "lychee-reconcile.timer", group: "reconciler",
            reconciled: false, status: "running", since: null },
        ] }],
      },
      NOW, new Set(), "lychee.land", {}, "reconciler",
    );
    assert.ok(!html.includes("next run"));
    assert.ok(html.includes("last run 2 minutes ago"));
  });

  test("an unknown unit at the retry cap shows a neutral pill and the full gate string", () => {
    const gate = "v0.2.0 failed 3 times; not retrying (promote another tag, or rm /opt/palsave-api/.failed-tag)";
    const html = renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: NO_SCHEDULE, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "palsave-api", kind: "unit", unit: "palsave-api.service", group: "service", reconciled: true,
            version: "v0.2.0", result: "blocked", failedAttempts: 3, gate, status: "unknown", since: null },
        ] }],
      },
      NOW, new Set(), "lychee.land",
    );
    assert.ok(html.includes("v0.2.0 · blocked · 3 attempts"));
    assert.ok(html.includes(gate));
    assert.ok(html.includes(TONE_PILL.neutral));
    assert.ok(!html.includes(TONE_PILL.bad));
  });

  /** The status word of each rendered row, in page order. */
  const pills = (html: string): string[] => [...html.matchAll(/data-row-pill><span class="[^"]*"><span aria-hidden="true">&#9679;<\/span> ([a-z ]+)<\/span>/g)].map((m) => m[1]);

  function offerBoard(extra: Record<string, unknown>) {
    return renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: NO_SCHEDULE, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
            status: "running", since: null, ...extra } as never,
        ] }],
      },
      NOW, new Set(), "lychee.land",
    );
  }

  test("target equal to version renders as running", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.4.0" });
    assert.deepEqual(pills(html), ["running"]);
    assert.ok(!html.includes("\u2192"));
  });

  test("target different from version renders as applying, showing both as one fact", () => {
    const html = offerBoard({ version: "v0.2.0", target: "v0.3.0", result: "deployed" });
    assert.deepEqual(pills(html), ["applying"]);
    assert.ok(html.includes("v0.2.0 \u2192 v0.3.0"));
    assert.ok(!html.includes("v0.3.0 · deployed"));
  });

  test("applying is neutral, never red", () => {
    const html = offerBoard({ version: "v0.2.0", target: "v0.3.0", result: "deployed" });
    assert.ok(html.includes(`${TONE_PILL.neutral}"><span aria-hidden="true">&#9679;</span> applying`));
    assert.ok(!html.includes(TONE_PILL.bad));
  });

  test("applying does not hide a live failure", () => {
    const html = offerBoard({ version: "v0.2.0", target: "v0.3.0", result: "deployed", status: "exited" });
    assert.deepEqual(pills(html), ["exited"]);
  });

  test("an undeployed failed container reads failed, not its live state", () => {
    const html = offerBoard({ version: "", target: "0.1.0", result: "failed", status: "exited" });
    assert.deepEqual(pills(html), ["failed"]);
    assert.ok(html.includes(`${TONE_PILL.bad}"><span aria-hidden="true">&#9679;</span> failed`));
  });

  test("an undeployed awaiting-image container reads awaiting image", () => {
    const html = offerBoard({ version: "", result: "awaiting-image", status: "not-created" });
    assert.deepEqual(pills(html), ["awaiting image"]);
    assert.ok(html.includes(`${TONE_PILL.neutral}"><span aria-hidden="true">&#9679;</span> awaiting image`));
  });

  test("an undeployed row with another result keeps its live state", () => {
    const html = offerBoard({ version: "", result: "deployed", status: "not-created" });
    assert.deepEqual(pills(html), ["not deployed"]);
  });

  test("a non-site undeployed failed container reads failed", () => {
    const html = offerBoard({ name: "palsave-api", container: "palsave-api", version: "", result: "failed", status: "exited" });
    assert.deepEqual(pills(html), ["failed"]);
  });

  test("an installed container still shows its live state", () => {
    const html = offerBoard({ version: "0.2.0", result: "failed", status: "running" });
    assert.deepEqual(pills(html), ["running"]);
  });

  test("a unit row is unaffected", () => {
    const html = offerBoard({ kind: "unit", unit: "notes.service", version: "", result: "failed", status: "running" });
    assert.deepEqual(pills(html), ["running"]);
  });

  test("a blocked row with a moved pin does not read applying", () => {
    const html = offerBoard({ version: "v0.2.0", target: "v0.3.0", result: "blocked", gate: "job test concluded: failure" });
    assert.deepEqual(pills(html), ["running"]);
    assert.ok(!html.includes("applying"));
  });

  test("a failed row or one with no result and a moved pin does not read applying", () => {
    assert.deepEqual(pills(offerBoard({ version: "v0.2.0", target: "v0.3.0", result: "failed" })), ["running"]);
    assert.deepEqual(pills(offerBoard({ version: "v0.2.0", target: "v0.3.0" })), ["running"]);
  });

  /** The row's deploy line, tags stripped, or null when it has none. */
  const deployLine = (html: string): string | null => {
    const m = html.match(/<p [^>]*data-deploy-state>(.*?)<\/p>/s);
    return m ? m[1].replace(/<[^>]+>/g, "").replace(/&#9679;/g, "\u25CF").replace(/\s+/g, " ").trim() : null;
  };
  /** The facts paragraph: the SERVICE_DETAIL one straight after the name/deploy lines. */
  const factsLine = (html: string): string | null =>
    html.match(new RegExp(`<p class="${SERVICE_DETAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">([^<]*)</p>`))?.[1] ?? null;

  test("a ci-failed row shows the deploy line in the bad tone", () => {
    const html = offerBoard({ version: "v2.11.4", result: "blocked", gateCode: "ci-failed", status: "running" });
    assert.ok(html.includes("data-deploy-state"));
    assert.ok(html.includes(`<span class="${TONE_TEXT.bad}"><span aria-hidden="true">&#9679;</span> deploy blocked</span>`));
    assert.ok(html.includes("\u00B7 CI failed"));
    assert.deepEqual(pills(html), ["running"]);
  });

  // Static markup merges adjacent text, so only a live render shows the
  // split: two text nodes (" deploy ", "blocked") sit a fraction of a pixel
  // off the server's one and antialias differently, which a pixel compare
  // against the server board caught.
  test("the deploy phrase is one text node, as the server writes it", () => {
    const payload: BoardPayload = {
      board: {
        inventoryAvailable: true, schedule: NO_SCHEDULE, timerUnit: null, generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
            status: "running", since: null, version: "v2.11.4", result: "blocked", gateCode: "ci-failed" } as never,
        ] }],
      },
      boardEmpty: false, now: NOW.toISOString(), domain: "lychee.land",
      prunable: [], managed: [], requested: {}, lastRuns: {},
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(<Board payload={payload} group="service" />));
    const span = host.querySelector("[data-deploy-state] > span");
    assert.ok(span, "no deploy line");
    const texts = Array.from(span.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue);
    assert.deepEqual(texts, [" deploy blocked"]);
    root.unmount();
    host.remove();
  });

  test("the facts line drops the result word when the line shows", () => {
    const html = offerBoard({ version: "v2.11.4", result: "blocked", gateCode: "ci-failed", status: "running" });
    const facts = factsLine(html);
    assert.ok(facts?.includes("v2.11.4"));
    assert.ok(!facts?.includes("blocked"));
  });

  test("a ci-pending row shows the line in the neutral tone", () => {
    const html = offerBoard({ version: "v2.11.4", result: "blocked", gateCode: "ci-pending", status: "running" });
    assert.ok(html.includes(`<span class="${TONE_TEXT.neutral}"><span aria-hidden="true">&#9679;</span> deploy waiting</span>`));
    assert.ok(!html.includes(`<span class="${TONE_TEXT.bad}">`));
  });

  test("an undeployed failed row has no deploy line", () => {
    const html = offerBoard({ version: "", result: "failed", status: "exited" });
    assert.ok(!html.includes("data-deploy-state"));
  });

  test("a blocked row with no gate code has no line and keeps blocked in its facts", () => {
    const html = offerBoard({ version: "v1", result: "blocked", status: "running" });
    assert.ok(!html.includes("data-deploy-state"));
    assert.ok(factsLine(html)?.includes("blocked"));
  });

  test("facts never print the raw reconciler result words", () => {
    const rows: Record<string, unknown>[] = [
      { version: "v1.4.0", result: "skipped", gateCode: "up-to-date", gate: "pin unchanged (1.4.0)" },
      { result: "deployed", gateCode: "ok" },
      { result: "awaiting-image", gateCode: "awaiting-image" },
      { version: "v1.4.0", result: "failed", failedAttempts: 1 },
      { version: "v2.11.4", result: "blocked", gateCode: "ci-failed", gate: "job test concluded: failure" },
    ];
    for (const extra of rows) {
      const facts = factsLine(offerBoard(extra)) ?? "";
      for (const word of ["skipped", "deployed", "failed", "awaiting-image", "blocked"]) {
        assert.ok(!facts.includes(word), `${JSON.stringify(extra)} printed ${word}`);
      }
    }
  });

  test("a skipped up-to-date row shows no gate line", () => {
    const html = offerBoard({ version: "v1.4.0", result: "skipped", gateCode: "up-to-date", gate: "pin unchanged (1.4.0)" });
    assert.ok(!html.includes("data-gate"));
  });

  test("a retry-capped row's deploy line is the bare word and the gate line carries the full sentence", () => {
    const gate = "v0.2.0 failed 3 times; not retrying (promote another tag, or rm /opt/x/.failed-tag)";
    const html = offerBoard({ result: "blocked", gateCode: "retry-capped", gate });
    assert.equal(deployLine(html), "● deploy blocked");
    assert.ok(html.includes(gate));
    assert.ok(html.includes("data-gate"));
  });

  test("a not-applied row with no gate keeps its reason on the deploy line", () => {
    const html = offerBoard({ result: "blocked", gateCode: "not-applied" });
    assert.equal(deployLine(html), "● deploy blocked · not applied");
    assert.ok(!html.includes("data-gate"));
  });

  test("a blocked row with a gate and no code keeps blocked in its facts and its gate line", () => {
    const html = offerBoard({ version: "v0.2.0", result: "blocked", gate: "job test concluded: failure" });
    assert.ok(!html.includes("data-deploy-state"));
    assert.ok(factsLine(html)?.includes("blocked"));
    assert.ok(html.includes("data-gate"));
    assert.ok(html.includes("job test concluded: failure"));
  });

  test("a failed row keeps its gate line; an empty gate renders none", () => {
    assert.ok(offerBoard({ version: "v1.4.0", result: "failed", gate: "health check failed after install" }).includes("data-gate"));
    assert.ok(!offerBoard({ result: "failed", gate: "" }).includes("data-gate"));
  });

  test("a running host action does not hide the deploy line", () => {
    const html = renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: NO_SCHEDULE, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "notes", kind: "unit", unit: "notes.service", group: "service", reconciled: true,
            version: "v1", result: "blocked", gateCode: "retry-capped", status: "running", since: null } as never,
        ] }],
      },
      NOW, new Set(), "lychee.land",
      { notes: { unit: "notes", action: "restart", state: "running", logTail: "" } },
    );
    assert.ok(html.includes("data-deploy-state"));
    assert.ok(html.includes("retry limit reached"));
  });

  test("an installed failed row reads deploy failed once", () => {
    const html = offerBoard({ version: "0.1.0", target: "0.2.0", result: "failed", status: "running" });
    assert.equal(deployLine(html), "\u25CF deploy failed");
  });

  test("a unit row with ci-failed shows the line", () => {
    const html = offerBoard({ kind: "unit", unit: "notes.service", result: "blocked", gateCode: "ci-failed" });
    assert.ok(html.includes("data-deploy-state"));
  });

  test("a row whose only fact was the result renders no empty facts line", () => {
    const html = offerBoard({ result: "blocked", gateCode: "ci-failed" });
    assert.ok(html.includes("data-deploy-state"));
    assert.ok(!html.includes(`<p class="${SERVICE_DETAIL}"></p>`));
  });

  test("an available newer than version offers Deploy", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.4.0", available: "v1.5.0" });
    assert.ok(html.includes("data-offer"));
    assert.ok(html.includes("v1.5.0 available"));
    assert.ok(html.includes('data-deploy="notes"'));
    assert.ok(html.includes(BUTTON_OFFER));
    assert.ok(!html.includes(BUTTON_DANGER));
  });

  test("no available, or available equal to version, offers nothing", () => {
    assert.ok(!offerBoard({ version: "v1.4.0" }).includes("data-deploy"));
    assert.ok(!offerBoard({ version: "v1.4.0", available: "v1.4.0" }).includes("data-deploy"));
  });

  test("a tag already requested is not offered again", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", available: "v1.5.0", result: "blocked", gate: "job test concluded: failure" });
    assert.ok(!html.includes("data-deploy"));
  });

  test("a failed row with a newer tag shows its facts and gate, then the offer", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result: "failed", gate: "health check failed after install" });
    assert.ok(html.includes("v1.4.0"));
    assert.ok(html.includes("deploy failed"));
    assert.ok(html.includes("health check failed after install"));
    assert.ok(html.includes("v1.6.0 available"));
    assert.ok(html.includes('data-deploy="notes"'));
    assert.ok(html.indexOf("data-gate") < html.indexOf("data-offer"));
  });

  test("a failed row renders the failure line: the target, the escaped failed step and the journal", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result: "failed", failedAttempts: 2,
      failedStep: "Start the container: <exit 1> & gone" });
    assert.match(html, /data-deploy-failed/);
    assert.match(html, /Deploying <span[^>]*>v1\.5\.0<\/span> failed at this step:/);
    assert.ok(html.includes("Start the container: &lt;exit 1&gt; &amp; gone"));
    assert.ok(!html.includes("<exit 1>"));
    assert.match(html, /journalctl -u lychee-reconcile/);
    assert.ok(html.includes("v1.4.0 · 2 attempts"));
    assert.ok(html.includes("deploy failed"));
    assert.ok(html.indexOf("data-deploy-failed") < html.indexOf("data-offer"));
  });

  test("a failed row without a failed step still renders the failure line", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", result: "failed" });
    assert.match(html, /data-deploy-failed/);
    assert.match(html, /Deploying <span[^>]*>v1\.5\.0<\/span> failed\./);
    assert.match(html, /journalctl -u lychee-reconcile/);
    assert.ok(!html.includes("data-failed-step"));
  });

  test("the board's failure line has the two-unit command and no recovery sentence", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", result: "failed" });
    assert.ok(html.includes("The reconciler retries this tag on every run; its log for the last hour shows each attempt:"));
    assert.ok(html.includes("journalctl -u lychee-reconcile -u lychee-reconcile-app --since &quot;1 hour ago&quot;"));
    assert.ok(!html.includes("To recover"));
  });

  test("a failed board row with no target says the log has the latest attempt, not that a tag is retried", () => {
    const html = offerBoard({ version: "v1.4.0", result: "failed" });
    assert.ok(html.includes("The reconciler's log for the last hour has the latest attempt:") || html.includes("The reconciler&#39;s log for the last hour has the latest attempt:"));
    assert.ok(html.includes("journalctl -u lychee-reconcile -u lychee-reconcile-app --since &quot;1 hour ago&quot;"));
    assert.ok(!html.includes("retries this tag"));
  });

  test("rows that are not failed render no failure line", () => {
    for (const result of ["deployed", "skipped", "blocked", "awaiting-image", undefined]) {
      const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result, failedStep: "x" });
      assert.ok(!html.includes("data-deploy-failed"), String(result));
      assert.ok(!html.includes("journalctl"), String(result));
    }
  });

  test("two failed rows get distinct journal command ids", () => {
    const html = renderServicesPage(
      {
        inventoryAvailable: true, schedule: NO_SCHEDULE, timerUnit: null, generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: ["a", "b"].map((name) => (
          { name, kind: "container", container: name, group: "service", reconciled: true, target: "v1", result: "failed", status: "exited", since: null } as never
        )) }],
      },
      NOW, new Set(), "lychee.land",
    );
    const ids = [...html.matchAll(/<pre id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });

  test("a failed row never re-offers the tag that failed", () => {
    const html = offerBoard({ version: "v1.4.0", target: "v1.5.0", available: "v1.5.0", result: "failed", gate: "health check failed after install" });
    assert.ok(html.includes("health check failed after install"));
    assert.ok(!html.includes('data-deploy="'));
  });

  test("a blocked row puts the offer after the gate", () => {
    const html = offerBoard({ version: "v1.4.0", available: "v1.5.0", result: "blocked", gate: "not retrying" });
    assert.ok(html.indexOf("data-gate") < html.indexOf("data-offer"));
  });

  function pillFor(status: "running" | "starting" | "exited" | "restarting" | "unknown"): string {
    return renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: NO_SCHEDULE, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "x", kind: "unit", unit: "x.service", group: "service", reconciled: false, status, since: null },
        ] }],
      },
      NOW, new Set(), "lychee.land",
    );
  }

  test("the Three-Tone Status Rule holds at the view: exited and restarting are Scorch, starting and unknown are neutral", () => {
    for (const status of ["exited", "restarting"] as const) {
      const html = pillFor(status);
      assert.ok(html.includes(`${TONE_PILL.bad}"><span aria-hidden="true">&#9679;</span> ${status}`), status);
    }
    for (const status of ["starting", "unknown"] as const) {
      const html = pillFor(status);
      assert.ok(html.includes(`${TONE_PILL.neutral}"><span aria-hidden="true">&#9679;</span> ${status}`), status);
      assert.ok(!html.includes(TONE_PILL.bad), status);
    }
    assert.ok(pillFor("running").includes(`${TONE_PILL.ok}"><span aria-hidden="true">&#9679;</span> running`));
  });
});

describe("one board page per group", () => {
  const NOW = new Date("2026-10-02T05:00:00Z");
  const unit = (name: string, group: "service" | "reconciler" | "infrastructure") => ({
    name, kind: "unit" as const, unit: `${name}.service`, group, reconciled: false, status: "running" as const, since: null,
  });
  const BOARD = {
    inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: "2026-10-02T04:58:02Z",
    groups: [
      { group: "reconciler" as const, rows: [unit("lychee-watch-timer", "reconciler")] },
      { group: "service" as const, rows: [unit("swee", "service")] },
      { group: "infrastructure" as const, rows: [unit("caddy", "infrastructure")] },
    ],
  };
  const rows = (html: string) => [...html.matchAll(/<li [^>]*data-service="([^"]+)"/g)].map((m) => m[1]);
  const eyebrow = (html: string) => html.match(/<h2 [^>]*>([^<]*)<\/h2>/)?.[1];

  for (const [group, label, name] of [
    ["service", "Services", "swee"],
    ["reconciler", "Reconciler", "lychee-watch-timer"],
    ["infrastructure", "Infrastructure", "caddy"],
  ] as const) {
    // The page's <title> is the shell's now, not the board's: the route
    // tests' mount cases pin it for each of the three URLs.
    test(`the ${group} page holds only its group, named by the eyebrow, with no group heading`, () => {
      const html = renderServicesPage(BOARD, NOW, new Set(), "lychee.land", {}, group);
      assert.deepEqual(rows(html), [name]);
      assert.equal(eyebrow(html), label);
      assert.ok(html.includes("Inventory written 2 minutes ago"));
      assert.doesNotMatch(html, /<h3[^>]*>(Reconciler|Services|Infrastructure)<\/h3>/);
    });
  }

  test("a readable inventory with no rows in the page's group says so plainly", () => {
    const html = renderServicesPage({ ...BOARD, groups: BOARD.groups.slice(1) }, NOW, new Set(), "lychee.land", {}, "reconciler");
    assert.match(html, /id="group-empty"[^>]*>\s*The inventory lists no reconciler units\.\s*</);
    assert.ok(!html.includes('id="inventory-unavailable"'));
    assert.ok(html.includes("Inventory written"));
  });

  test("the services page says so plainly too", () => {
    const html = renderServicesPage({ ...BOARD, groups: [BOARD.groups[0]] }, NOW, new Set(), "lychee.land", {}, "service");
    assert.match(html, /id="group-empty"[^>]*>\s*The inventory lists no services\.\s*</);
  });

  test("an unreadable inventory gets today's explanation on every page, not the empty sentence", () => {
    for (const group of ["service", "reconciler", "infrastructure"] as const) {
      const html = renderServicesPage({ ...BOARD, groups: [], inventoryAvailable: false }, NOW, new Set(), "lychee.land", {}, group);
      assert.ok(html.includes('id="inventory-unavailable"'), group);
      assert.ok(!html.includes('id="group-empty"'), group);
    }
  });

  test("the explanation names the page's own group", () => {
    const explain = (group: "service" | "reconciler" | "infrastructure") =>
      renderServicesPage({ ...BOARD, groups: [], inventoryAvailable: false }, NOW, new Set(), "lychee.land", {}, group);
    assert.match(explain("service"), /There are no services to show: the inventory could not be read/);
    assert.match(explain("reconciler"), /There are no reconciler units to show: the inventory could not be read/);
    assert.match(explain("infrastructure"), /There are no infrastructure units to show: the inventory could not be read/);
    assert.doesNotMatch(explain("reconciler"), /no services to show/);
  });
});

describe("Prune on the services board", () => {
  const NOW = new Date("2026-10-02T05:00:00Z");
  const row = (name: string, extra: Record<string, unknown> = {}) => ({
    name, kind: "container" as const, container: name, group: "service" as const,
    reconciled: true, result: "deployed" as const, status: "not-created" as const, since: null, ...extra,
  });
  const board = (names: string[]) => ({
    inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: null,
    groups: [{ group: "service" as const, rows: names.map((n) => row(n)) }],
  });
  const rowOf = (html: string, name: string) => {
    const start = html.indexOf(`data-service="${name}"`);
    return html.slice(start, html.indexOf("</li>", start));
  };

  // Was against the server's renderPruneControl; the site page's repository
  // card now renders DeployLines' PruneLine, so the board's row is checked
  // against that, as the same DOM. Its markup against what the retired server
  // control rendered is held by the frozen board fixtures (the
  // *-prunable-and-links cases); the gone-detached detail fixture that also
  // held it was retired by the retired-state spec (2026-10-26).
  test("a row whose site declaration is absent carries the same control as the site page", () => {
    const html = renderServicesPage(board(["gone-lychee-land", "app-lychee-land"]), NOW, new Set(["gone-lychee-land"]), "lychee.land");
    const prune = rowOf(html, "gone-lychee-land").match(/<p [^>]*data-prune-line[\s\S]*?<\/p>/)?.[0];
    assert.ok(prune, "expected the prune line on the retired row");
    assert.equal(canonical(prune), canonical(renderToStaticMarkup(<PruneLine name="gone-lychee-land" />)));
    assert.doesNotMatch(rowOf(html, "app-lychee-land"), /data-prune/);
  });

  test("the prune button on the board is the compact secondary", () => {
    const markup = rowOf(renderServicesPage(board(["gone-lychee-land"]), NOW, new Set(["gone-lychee-land"]), "lychee.land"), "gone-lychee-land");
    assert.ok(markup.includes(`class="${BUTTON_SECONDARY_COMPACT}"`));
    assert.doesNotMatch(markup, /min-h-10/);
  });

  test("a non-site name gets no control even if it is named absent", () => {
    const html = renderServicesPage(board(["palsave-api"]), NOW, new Set(["palsave-api"]), "lychee.land");
    assert.doesNotMatch(html, /data-prune/);
  });

  test("with nothing named absent (or the clone unreadable) no row carries the control", () => {
    assert.doesNotMatch(renderServicesPage(board(["gone-lychee-land"]), NOW, new Set(), "lychee.land"), /data-prune/);
  });
});

describe("host actions on the services board", () => {
  const NOW = new Date("2026-10-02T05:00:00Z");
  const PAL = "palworld-palchuds";
  type Run = Record<string, ActionState>;

  function board(row: Record<string, unknown>, lastRuns: Run = {}): string {
    return renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: { next: null, last: null },
        timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: PAL, kind: "unit", unit: `${PAL}.service`, group: "service", reconciled: false,
            status: "running", since: null, actions: ["start", "stop", "restart", "update"], ...row } as never,
        ] }],
      },
      NOW, new Set(), "lychee.land", lastRuns,
    );
  }

  /** The opening tag of each action button, keyed by action. */
  const buttons = (html: string): Record<string, string> =>
    Object.fromEntries([...html.matchAll(/<button [^>]*data-host-action="([a-z]+)"[^>]*>/g)].map((m) => [m[1], m[0]]));
  const pills = (html: string): string[] => [...html.matchAll(/data-row-pill><span class="[^"]*"><span aria-hidden="true">&#9679;<\/span> ([a-z ]+)<\/span>/g)].map((m) => m[1]);
  const elementWith = (html: string, attr: string): string => {
    const m = html.match(new RegExp(`<[a-z]+ [^>]*${attr}[^>]*>`));
    assert.ok(m, `no element with ${attr}`);
    return m[0];
  };

  test("a row whose entry lists no actions has no action controls", () => {
    const html = board({ actions: undefined });
    assert.deepEqual(buttons(html), {});
    assert.ok(!html.includes("data-host-actions"));
    const empty = board({ actions: [] });
    assert.deepEqual(buttons(empty), {});
  });

  test("only the listed actions get buttons", () => {
    assert.deepEqual(Object.keys(buttons(board({ actions: ["restart"] }))), ["restart"]);
  });

  test("a running unit offers Restart, Update and Stop, and no Start", () => {
    const b = buttons(board({ status: "running" }));
    assert.deepEqual(Object.keys(b), ["restart", "update", "stop"]);
  });

  test("a stopped unit offers Start and Update only: no Stop, and no Restart", () => {
    const b = buttons(board({ status: "exited" }));
    assert.deepEqual(Object.keys(b), ["start", "update"]);
  });

  test("Restart follows Stop: shown while the unit is up or unreadable, hidden when it is down", () => {
    for (const status of ["running", "starting", "restarting", "unknown"]) {
      const keys = Object.keys(buttons(board({ status })));
      assert.ok(keys.includes("restart"), status);
      assert.ok(keys.includes("stop"), status);
    }
    assert.deepEqual(Object.keys(buttons(board({ status: "unknown" }))), ["start", "restart", "update", "stop"]);
  });

  test("Stop is the only coloured action: Start, Restart and Update are compact secondary", () => {
    for (const status of ["running", "exited", "unknown"]) {
      const b = buttons(board({ status }));
      for (const [action, tag] of Object.entries(b)) {
        const expected = action === "stop" ? BUTTON_DANGER : BUTTON_SECONDARY_COMPACT;
        assert.ok(tag.includes(`class="${expected}"`), `${status} ${action}: ${tag}`);
        assert.ok(!tag.includes(BUTTON_OFFER), `${status} ${action}`);
      }
    }
  });

  test("stop, restart and update each confirm inline with their own copy; start does not", () => {
    const html = board({ status: "running" });
    const confirms = [...html.matchAll(/data-action-confirm="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(confirms.sort(), ["restart", "stop", "update"]);
    assert.ok(html.includes(`Stop ${PAL}? Everyone on the server is disconnected, and it stays down until someone starts it.`));
    assert.ok(html.includes(`Restart ${PAL}? Everyone on the server is disconnected for about a minute.`));
    assert.ok(html.includes(`Update ${PAL}? The server stops, steamcmd updates it, then it starts again; everyone is disconnected until it&#39;s back.`) ||
      html.includes(`Update ${PAL}? The server stops, steamcmd updates it, then it starts again; everyone is disconnected until it's back.`));
    assert.match(html, /data-action-go="stop"[^>]*>Stop server</);
    assert.match(html, /data-action-go="restart"[^>]*>Restart server</);
    assert.match(html, /data-action-go="update"[^>]*>Update server</);
    // Hidden until a button asks for it.
    assert.match(elementWith(html, 'data-action-confirm="stop"'), /\shidden/);
    const startOnly = board({ status: "exited", actions: ["start"] });
    assert.ok(!startOnly.includes("data-action-confirm"));
  });

  test("the unit name in the confirmation copy is escaped", () => {
    const html = board({ name: `x"<y`, status: "running", actions: ["stop"] });
    assert.ok(html.includes("Stop x&quot;&lt;y?"));
    assert.ok(!html.includes(`Stop x"<y`));
  });

  test("at rest nothing is disabled and the busy line is hidden", () => {
    const html = board({ status: "running" });
    for (const tag of Object.values(buttons(html))) assert.ok(!/\sdisabled(?=[\s>])/.test(tag), tag);
    assert.match(elementWith(html, "data-action-busy"), /\shidden/);
    assert.deepEqual(pills(html), ["running"]);
  });

  test("while an action runs: neutral pill naming it, every button disabled, the busy line, the live tail open", () => {
    const html = board({ status: "running" }, {
      [PAL]: { unit: PAL, action: "update", state: "running", startedAt: "2026-10-02T04:59:12Z", logTail: "Stopping\n Update state (0x61) downloading\n" },
    });
    assert.deepEqual(pills(html), ["updating"]);
    assert.ok(html.includes(TONE_PILL.neutral));
    const b = buttons(html);
    assert.ok(Object.keys(b).length > 0);
    for (const tag of Object.values(b)) assert.match(tag, /\sdisabled(?=[\s>])/);
    const busy = html.slice(html.indexOf("data-action-busy"));
    assert.ok(!/^[^>]*\shidden/.test(busy));
    assert.ok(busy.includes(`an action is already running on ${PAL}`));
    assert.match(elementWith(html, "data-host-actions"), /data-running="update"/);
    assert.ok(html.includes("update running · started 48 seconds ago"));
    const tail = elementWith(html, "data-action-tail");
    assert.ok(!/\shidden/.test(tail));
    assert.ok(html.includes(" Update state (0x61) downloading"));
  });

  test("each action's running word", () => {
    for (const [action, word] of [["start", "starting"], ["stop", "stopping"], ["restart", "restarting"], ["update", "updating"]]) {
      const html = board({ status: "running" }, { [PAL]: { unit: PAL, action: action as never, state: "running", logTail: "" } });
      assert.deepEqual(pills(html), [word]);
    }
  });

  test("a finished run is a fact line and a closed log disclosure with every line", () => {
    const log = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const html = board({ status: "running" }, {
      [PAL]: { unit: PAL, action: "update", state: "succeeded", startedAt: "2026-10-02T02:56:19Z", finishedAt: "2026-10-02T03:00:00Z", logTail: log },
    });
    assert.match(html, /update <span[^>]*>succeeded<\/span> · 2 hours ago · took 3m 41s/);
    const details = elementWith(html, "data-action-log");
    assert.ok(details.startsWith("<details"));
    assert.ok(!/\sopen/.test(details));
    assert.ok(html.includes("log · 14 lines"));
    assert.ok(html.includes("line 1\n") && html.includes("line 14"));
    assert.deepEqual(pills(html), ["running"]);
  });

  test("a failed run opens its log by default", () => {
    const html = board({ status: "exited" }, {
      [PAL]: { unit: PAL, action: "restart", state: "failed", startedAt: "2026-10-02T04:58:58Z", finishedAt: "2026-10-02T04:59:00Z", logTail: "Job for palworld-palchuds.service failed\n" },
    });
    assert.match(html, /restart <span[^>]*text-red-300[^>]*>failed<\/span> · 1 minute ago · took 2s/);
    assert.match(elementWith(html, "data-action-log"), /\sopen/);
    assert.ok(html.includes("log · 1 line<"));
  });

  test("an empty log reads no output", () => {
    const html = board({ status: "running" }, {
      [PAL]: { unit: PAL, action: "restart", state: "succeeded", startedAt: "2026-10-02T04:58:58Z", finishedAt: "2026-10-02T04:59:00Z", logTail: "" },
    });
    assert.ok(html.includes("no output"));
    assert.ok(!html.includes("log · 0 lines"));
  });

  test("a never-run row has no last-run line and no log", () => {
    const html = board({ status: "running" }, { [PAL]: { unit: PAL, action: "start", state: "idle", logTail: "" } });
    assert.ok(!html.includes("data-action-log"));
    assert.ok(!html.includes("succeeded") && !html.includes("failed"));
    assert.match(elementWith(html, "data-action-fact"), /\shidden/);
  });

  test("the log is escaped", () => {
    const html = board({ status: "running" }, {
      [PAL]: { unit: PAL, action: "restart", state: "failed", finishedAt: "2026-10-02T04:59:00Z", logTail: "<script>x</script>\n" },
    });
    assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
  });
});

describe("board rows link to their sites, and unknown explains itself", () => {
  const NOW = new Date("2026-10-02T05:00:00Z");
  type Run = Record<string, ActionState>;

  function page(row: Record<string, unknown>, managed: ReadonlySet<string> = new Set(), lastRuns: Run = {}): string {
    return renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: { next: null, last: null },
        timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "x", kind: "unit", unit: "x.service", group: "service", reconciled: false, status: "running", since: null, ...row } as never,
        ] }],
      },
      NOW, new Set(), "lychee.land", lastRuns, "service", managed,
    );
  }
  const site = { name: "app-lychee-land", kind: "container", container: "app-lychee-land", version: "0.2.0", reconciled: true };
  const UNIT_SENTENCE = "lychee-admin couldn&#39;t read this unit&#39;s state from systemd.";
  const CONTAINER_SENTENCE = "lychee-admin couldn&#39;t read this container&#39;s state.";

  test("every board row carries an anchor", () => {
    assert.ok(page(site).includes('id="service-app-lychee-land"'));
  });

  test("a managed site's board row links to its site", () => {
    assert.ok(page(site, new Set(["app.lychee.land"])).includes('href="/sites/app.lychee.land"'));
  });

  test("a site row not in the managed set stays plain text", () => {
    assert.ok(!page(site, new Set()).includes('href="/sites/'));
  });

  test("a non-site row never links", () => {
    const html = page({ name: "palsave-api" }, new Set(["app.lychee.land", "palsave-api.lychee.land"]));
    assert.ok(!html.includes('href="/sites/'));
  });

  test("an unknown unit row explains itself", () => {
    assert.ok(page({ status: "unknown" }).includes(UNIT_SENTENCE));
  });

  test("an unknown container row explains itself", () => {
    assert.ok(page({ ...site, status: "unknown" }).includes(CONTAINER_SENTENCE));
  });

  test("a known row has no unknown sentence", () => {
    const html = page({ status: "running" });
    assert.ok(!html.includes(UNIT_SENTENCE) && !html.includes(CONTAINER_SENTENCE));
  });

  test("a running host action suppresses the unknown sentence", () => {
    const html = page(
      { status: "unknown", actions: ["restart"] },
      new Set(),
      { x: { unit: "x", action: "restart", state: "running", logTail: "" } },
    );
    assert.ok(!html.includes(UNIT_SENTENCE) && !html.includes(CONTAINER_SENTENCE));
  });
});

describe("the requested line on the board", () => {
  const NOW_REQ = new Date("2026-10-02T05:00:00Z");
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  function boardWith(extra: Record<string, unknown>, requested?: ReadonlyMap<string, string>) {
    return renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: { next: null, last: null }, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
            status: "running", since: null, ...extra } as never,
        ] }],
      },
      NOW_REQ, new Set(), "lychee.land", {}, "service", new Set(), requested,
    );
  }

  test("a board row whose pending tag equals the offer shows the requested line, not Deploy", () => {
    const html = boardWith({ available: "0.3.0", version: "0.2.0" }, new Map([["notes", "0.3.0"]]));
    assert.ok(html.includes("data-requested"));
    assert.ok(!html.includes('data-deploy="'));
  });

  test("an empty map, or a different pending tag, leaves the offer as it was", () => {
    for (const requested of [new Map<string, string>(), new Map([["notes", "0.2.5"]])]) {
      const html = boardWith({ available: "0.3.0", version: "0.2.0" }, requested);
      assert.ok(html.includes('data-deploy="notes"'));
      // The inert template carries one requested line by design; the row must not.
      assert.ok(!html.replace(/<template[\s\S]*?<\/template>/, "").includes("data-requested"));
    }
  });

  test("the board carries the template once when it renders an offer, and not otherwise", () => {
    assert.equal(count(boardWith({ available: "0.3.0", version: "0.2.0" }), "data-requested-template"), 1);
    assert.equal(count(boardWith({ version: "0.2.0" }), "data-requested-template"), 0);
  });
});

describe("the board shares its offer and its prose measure with the site page", () => {
  const NEXT_SITE: Site = { hostname: "app.lychee.land", type: "reverse-proxy", target: "3000", framework: "nextjs", healthcheckPath: "/api/health" };
  const BASE = {
    sitesRoot: "/var/www",
    domain: "lychee.land",
    tunnelId: "11111111-2222-3333-4444-555555555555",
    tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
    caddyfilePath: "/etc/caddy/Caddyfile",
    scaffold: { buildCommand: "npm run build", runCommand: "npm start" },
    scaffoldFiles: [{ name: "Dockerfile", content: "FROM node:20-alpine\n" }],
  };

  // Was "the offer is the same markup the services board renders" in
  // html.test.ts, byte for byte against the server board; now the same DOM.
  test("the site page's offer is the same markup the board renders", () => {
    const board = renderServicesPage(
      {
        groups: [
          {
            group: "service",
            rows: [
              { kind: "container", container: "app-lychee-land", name: "app-lychee-land", group: "service", reconciled: true, version: "0.2.0", available: "0.3.0", result: "deployed", status: "running", since: null },
            ],
          },
        ],
        schedule: { next: null, last: null },
        timerUnit: null,
        generated: null,
        inventoryAvailable: true,
      },
      new Date("2026-10-05T00:00:00Z"), new Set(), "lychee.land",
    );
    // The site page as the client renders it now (React's SiteDetail, from
    // GET /api/sites/:hostname's payload), where it was renderSiteDetail.
    const site = renderToStaticMarkup(
      <SiteDetail
        payload={{
          site: NEXT_SITE,
          filesPath: null,
          caddyfileError: null,
          ...BASE,
          resource: { name: "app-lychee-land", repo: "app-site", version: "0.2.0", available: "0.3.0", result: "deployed" },
          status: { kind: "container", state: "running", health: "healthy" },
        }}
      />,
    );
    const offerOf = (html: string) => html.match(/<p[^>]*data-offer[^>]*>[\s\S]*?<\/p>/)?.[0];
    const fromBoard = offerOf(board);
    const fromSite = offerOf(site);
    assert.ok(fromBoard && fromSite);
    assert.equal(canonical(fromBoard), canonical(fromSite));
  });

  // Was the "services board with a failed row" case of "Smoke sentences hold
  // a readable measure" in html.test.ts; the rule is the same.
  test("every Smoke paragraph carries the measure: services board with a failed row", () => {
    const failedBoard = renderServicesPage(
      {
        inventoryAvailable: true,
        schedule: { next: null, last: null }, timerUnit: null,
        generated: "2026-10-02T04:58:02Z",
        groups: [{ group: "service", rows: [
          { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true, status: "running", since: null,
            version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result: "failed", failedAttempts: 1,
            failedStep: "Start the container: exit 1" } as never,
        ] }],
      },
      new Date("2026-10-02T05:00:00Z"), new Set(), "lychee.land",
    );
    const uncapped = (failedBoard.match(/<p\b[^>]*>/g) ?? []).filter((tag) => {
      const cls = tag.match(/class="([^"]*)"/)?.[1] ?? "";
      const capped = cls.includes("max-w-[25rem]") || cls.includes("max-w-[46ch]");
      return cls.includes("text-stone-400") && cls.includes("text-[0.8rem]") && !cls.includes("font-mono") && !capped;
    });
    assert.deepEqual(uncapped, []);
    assert.ok(!failedBoard.includes("max-w-[70ch]"));
    // The test above must have rendered prose to check, or it proves nothing.
    assert.ok(failedBoard.includes("data-deploy-failed"));
  });
});
