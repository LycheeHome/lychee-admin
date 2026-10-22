import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderServicesPage } from "../../views/html";
import type { ShellData } from "../../views/shell";
import type { ActionState, BoardPayload, BoardRow, ServiceBoard, ServiceGroup } from "../../shared/board";
import { Board } from "../components/BoardRows";
import { canonical } from "../test/canonical";

/*
 * The React board against the server's renderServicesPage, for every branch a
 * row can render, in each group React is going to own. The server is the
 * reference until Task 6 retires it.
 */

const NOW = new Date("2026-10-02T05:00:00Z");
const NO_SCHEDULE = { next: null, last: null };
const DOMAIN = "lychee.land";
const GROUPS: readonly ServiceGroup[] = ["service", "reconciler", "infrastructure"];
const PAGE: Record<ServiceGroup, "services" | "reconciler" | "infrastructure"> = {
  service: "services",
  reconciler: "reconciler",
  infrastructure: "infrastructure",
};

function shell(group: ServiceGroup): ShellData {
  return { rail: { sites: [], hostAvailable: true, current: { page: PAGE[group] }, domain: DOMAIN }, assets: null };
}

function container(name: string, group: ServiceGroup, extra: Partial<BoardRow> = {}): BoardRow {
  return { name, kind: "container", container: name, group, reconciled: true, status: "running", since: null, ...extra } as BoardRow;
}

function unit(name: string, group: ServiceGroup, extra: Partial<BoardRow> = {}): BoardRow {
  return {
    name,
    kind: "unit",
    unit: `${name}.service`,
    group,
    reconciled: false,
    status: "running",
    since: "2026-10-01T05:00:00Z",
    ...extra,
  } as BoardRow;
}

function payload(group: ServiceGroup, rows: BoardRow[], extra: Partial<BoardPayload> = {}): BoardPayload {
  const board: ServiceBoard = {
    inventoryAvailable: true,
    schedule: NO_SCHEDULE,
    timerUnit: null,
    generated: "2026-10-02T04:58:02Z",
    groups: [{ group, rows }],
  };
  return {
    board,
    boardEmpty: false,
    now: NOW.toISOString(),
    domain: DOMAIN,
    prunable: [],
    managed: [],
    requested: {},
    lastRuns: {},
    ...extra,
  };
}

// The board region: the frame the page body opens with, up to the end of
// <main>, which takes in the requested-line template the page appends after
// the frame when an offer is on it.
const START = '<div class="max-w-[1080px] mx-auto w-full flex flex-col gap-8">';
const END = "</main>";

function serverRegion(p: BoardPayload, group: ServiceGroup): string {
  const html = renderServicesPage(
    p.board,
    new Date(p.now),
    new Set(p.prunable),
    p.domain,
    p.lastRuns,
    group,
    new Set(p.managed),
    new Map(Object.entries(p.requested)),
    shell(group),
  );
  const start = html.indexOf(START);
  const end = html.indexOf(END, start);
  assert.ok(start >= 0 && end > start, "board region markers not found in the server page");
  return html.slice(start, end);
}

/** Asserts parity and returns the server's region, so a test can check its fixture reached the branch it names. */
function assertParity(p: BoardPayload, group: ServiceGroup, reaches: string[] = []): string {
  const server = serverRegion(p, group);
  const client = renderToStaticMarkup(<Board payload={p} group={group} />);
  assert.equal(canonical(client), canonical(server));
  for (const branch of reaches) assert.ok(server.includes(branch), `fixture never reached ${branch}`);
  return server;
}

const run = (state: ActionState["state"], extra: Partial<ActionState> = {}): ActionState => ({
  unit: "palworld",
  action: "update",
  state,
  startedAt: "2026-10-02T04:40:00Z",
  finishedAt: "2026-10-02T04:43:41Z",
  logTail: "",
  ...extra,
});

const ACTIONS = { actions: ["start", "stop", "restart", "update"] } as Partial<BoardRow>;

for (const group of GROUPS) {
  describe(`Board parity with renderServicesPage (${group})`, () => {
    test("a row offering a newer tag, with the requested-line template", () => {
      assertParity(
        payload(group, [container("notes", group, { version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "deployed" })]),
        group,
        ["data-offer", "data-deploy=", "data-requested-template"],
      );
    });

    test("a requested tag the reconciler has not applied", () => {
      const server = assertParity(
        payload(group, [container("notes", group, { version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "deployed" })], {
          requested: { notes: "v1.5.0" },
        }),
        group,
        ["data-requested"],
      );
      assert.ok(!server.includes("data-offer"), "a requested tag must replace the offer");
    });

    test("a requested tag that is not the offered one leaves the offer", () => {
      assertParity(
        payload(group, [container("notes", group, { version: "v1.4.0", target: "v1.4.0", available: "v1.6.0", result: "deployed" })], {
          requested: { notes: "v1.5.0" },
        }),
        group,
        ["data-offer"],
      );
    });

    test("a blocked deploy", () => {
      assertParity(
        payload(group, [
          container("notes", group, {
            version: "v1.4.0",
            target: "v1.5.0",
            available: "v1.6.0",
            result: "blocked",
            gateCode: "ci-failed",
            gate: "job test concluded: failure",
          }),
        ]),
        group,
        ["data-deploy-state", "data-gate", "data-offer"],
      );
    });

    test("a failed deploy", () => {
      assertParity(
        payload(group, [
          container("notes", group, {
            version: "v1.4.0",
            target: "v1.5.0",
            available: "v1.6.0",
            result: "failed",
            failedStep: "pull: denied",
            failedAttempts: 2,
          }),
          container("bare", group, { version: "v1", result: "failed" }),
        ]),
        group,
        ["data-deploy-failed", "data-failed-step", "cmd-reconcile-log-notes", "cmd-reconcile-log-bare", "data-offer"],
      );
    });

    test("a prunable site row, and site names linked only when managed", () => {
      const server = assertParity(
        payload(
          group,
          [
            container("gone-lychee-land", group, { status: "exited", result: "deployed" }),
            container("app-lychee-land", group, { version: "0.1.0" }),
            container("other-lychee-land", group, { version: "0.1.0" }),
            container("palsave-api", group, { version: "v1" }),
          ],
          { prunable: ["gone-lychee-land", "palsave-api"], managed: ["app.lychee.land"] },
        ),
        group,
        ["data-prune-line", 'href="/sites/app.lychee.land"'],
      );
      assert.ok(!server.includes('data-prune="palsave-api"'), "a hand-declared resource is never pruned");
      assert.ok(!server.includes('href="/sites/other.lychee.land"'), "an unmanaged hostname is not linked");
    });

    test("a host-action strip at rest, up and down", () => {
      assertParity(
        payload(group, [unit("palworld", group, ACTIONS), unit("palworld-b", group, { ...ACTIONS, status: "exited" })]),
        group,
        ["data-host-actions", "data-action-confirm", 'data-host-action="start"', 'data-host-action="stop"'],
      );
    });

    test("a host-action strip mid-run", () => {
      const server = assertParity(
        payload(group, [unit("palworld", group, ACTIONS)], {
          lastRuns: { palworld: run("running", { finishedAt: undefined, logTail: "Downloading update\nverifying\n" }) },
        }),
        group,
        ["data-running=", "updating", "update running · started", "disabled"],
      );
      assert.ok(!server.includes("data-action-log"), "a running action has no finished log");
    });

    test("a running action with no output yet and no start time", () => {
      assertParity(
        payload(group, [unit("palworld", group, ACTIONS)], {
          lastRuns: { palworld: run("running", { startedAt: undefined, finishedAt: undefined }) },
        }),
        group,
        ["no output yet"],
      );
    });

    test("a failed last run with its log, open", () => {
      assertParity(
        payload(group, [unit("palworld", group, ACTIONS)], {
          lastRuns: { palworld: run("failed", { logTail: "steamcmd: error\nexit 8\n" }) },
        }),
        group,
        ["data-action-log open", "log · 2 lines", "took 3m 41s"],
      );
    });

    test("a succeeded run: one line closed, and no output", () => {
      assertParity(
        payload(group, [unit("palworld", group, ACTIONS), unit("palworld-b", group, ACTIONS)], {
          lastRuns: {
            palworld: run("succeeded", { action: "restart", logTail: "ok\n" }),
            "palworld-b": run("succeeded", { unit: "palworld-b", action: "start", logTail: "  \n" }),
          },
        }),
        group,
        ["log · 1 line", "log · no output"],
      );
    });

    test("an unknown unit state, at rest and while an action runs", () => {
      const server = assertParity(
        payload(
          group,
          [
            unit("caddy", group, { status: "unknown", since: null }),
            container("notes", group, { status: "unknown", version: "v1" }),
            unit("palworld", group, { ...ACTIONS, status: "unknown", since: null }),
          ],
          { lastRuns: { palworld: run("running") } },
        ),
        group,
        ["couldn't read this unit's state", "couldn't read this container's state"],
      );
      // palworld's running action replaces the pill, so it says nothing about the read.
      const palworld = server.slice(server.indexOf('data-service="palworld"'));
      assert.ok(!palworld.includes("couldn't read"), "a running action replaces the unknown line");
    });

    test("an unavailable inventory", () => {
      assertParity(
        {
          ...payload(group, []),
          board: { groups: [], schedule: NO_SCHEDULE, timerUnit: null, generated: null, inventoryAvailable: false },
          boardEmpty: true,
        },
        group,
        ["inventory-unavailable"],
      );
    });

    test("an available inventory that declares nothing anywhere", () => {
      assertParity(
        {
          ...payload(group, []),
          board: { groups: [], schedule: NO_SCHEDULE, timerUnit: null, generated: null, inventoryAvailable: true },
          boardEmpty: true,
        },
        group,
        ["inventory-unavailable"],
      );
    });

    test("an empty group", () => {
      const other: ServiceGroup = group === "service" ? "reconciler" : "service";
      const p = payload(group, []);
      assertParity({ ...p, board: { ...p.board, groups: [{ group: other, rows: [unit("x", other)] }] } }, group, ["group-empty"]);
    });

    test("a mismatch is caught", () => {
      const p = payload(group, [container("notes", group, { version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "deployed" })]);
      const server = serverRegion(p, group);
      const other = renderToStaticMarkup(<Board payload={{ ...p, requested: { notes: "v1.5.0" } }} group={group} />);
      assert.notEqual(canonical(other), canonical(server));
    });
  });
}

describe("Board parity: the infrastructure fixtures carried over", () => {
  test("two healthy rows", () => {
    assertParity(
      payload("infrastructure", [unit("caddy", "infrastructure", { version: "v2.11.4" }), unit("cloudflared-sites", "infrastructure")]),
      "infrastructure",
    );
  });

  test("blocked, failed and applying rows", () => {
    assertParity(
      payload("infrastructure", [
        unit("caddy", "infrastructure", { version: "v2.11.4", result: "blocked", gateCode: "ci-failed", gate: "job test concluded: failure" }),
        unit("cloudflared-sites", "infrastructure", { version: "v1", target: "v2", result: "failed", failedStep: "pull: denied", failedAttempts: 2 }),
        unit("tunnel-b", "infrastructure", { version: "v1", target: "v2", result: "deployed" }),
        unit("tunnel-c", "infrastructure", { result: "blocked", gate: "something new" }),
        unit("tunnel-d", "infrastructure", { result: "failed", status: "exited" }),
      ]),
      "infrastructure",
      ["data-deploy-state", "data-gate", "data-deploy-failed", "data-failed-step", "applying", "2 attempts", "blocked ·"],
    );
  });

  test("a row that owns the board's timer schedule", () => {
    const p = payload("reconciler", [unit("tick", "reconciler", { unit: "tick.timer" } as Partial<BoardRow>)]);
    assertParity(
      {
        ...p,
        board: {
          ...p.board,
          timerUnit: "tick.timer",
          schedule: { next: new Date("2026-10-02T05:10:00Z"), last: new Date("2026-10-02T04:55:00Z") },
        },
      },
      "reconciler",
      ["next run in 10 minutes", "last run 5 minutes ago"],
    );
  });
});
