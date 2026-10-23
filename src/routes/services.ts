import express from "express";
import { config } from "../config";
import type { Deps } from "../deps";
import * as caddyfile from "../lib/caddyfile";
import { isManagedHostname } from "../lib/siteValidation";
import { isSiteName } from "../lib/declarationWriter";
import { declaredTag, pendingTag } from "../lib/siteResource";
import { isHostAction, readCheckedActionState, readLastRuns, requestAction } from "../lib/hostOperations";
import { readInventory } from "../lib/serviceInventory";
import { buildBoard, findTimerUnit } from "../lib/serviceBoard";
import type { ServiceBoard } from "../lib/serviceBoard";
import type { ApiError, ApiOk, BoardPayload } from "../shared/board";
import { GROUP_LABELS } from "../views/boardRowModel";
import { renderClientPage } from "../views/clientShell";
import { loadShell } from "./loadShell";
import { cachedRead, clearReadCaches } from "./readCache";
import type { ServiceGroup } from "../lib/serviceInventory";
import type { ServiceStatus, TimerSchedule } from "../lib/unitState";

// A function, not a shared constant: it lands on board.schedule, and a shared
// mutable object is the shape readInventory's unavailable() exists to avoid.
const noSchedule = (): TimerSchedule => ({ next: null, last: null });
const CONFIRM_DOWN_REASON = "the container hasn't been confirmed down yet; try after the next reconcile";

/**
 * The board's three pages, one group each, all rendered by the client. Every
 * row's POSTs stay under /services.
 */
const CLIENT_PAGES: ReadonlyArray<[path: string, group: ServiceGroup]> = [
  ["/services", "service"],
  ["/reconciler", "reconciler"],
  ["/infrastructure", "infrastructure"],
];

/** Each board page's rail link, by the group it holds. */
const GROUP_PAGES: Record<ServiceGroup, "services" | "reconciler" | "infrastructure"> = {
  reconciler: "reconciler",
  service: "services",
  infrastructure: "infrastructure",
};

const GROUPS: readonly ServiceGroup[] = ["reconciler", "service", "infrastructure"];
const isServiceGroup = (value: string): value is ServiceGroup => (GROUPS as readonly string[]).includes(value);

export interface BoardPageData {
  board: ServiceBoard;
  prunable: Set<string>;
  managed: Set<string>;
  requested: Map<string, string>;
  lastRuns: Awaited<ReturnType<typeof readLastRuns>>;
  now: Date;
}

/** Drops every cached read, the board's included. Every write route calls it before answering. */
export function clearBoardCache(): void {
  clearReadCaches();
}

/**
 * The whole board, read and joined: one data path for /api/services and
 * /api/health. Every read degrades on its own; the board always comes back.
 * It reads the whole board; each caller narrows it to its own group.
 */
export function loadBoardPage(deps: Deps, opts: { now?: () => number } = {}): Promise<BoardPageData> {
  // A rejection must not be served for 5s; readBoardPage degrades everything
  // and should not reject, but cachedRead evicts one regardless.
  return cachedRead("board", deps, () => readBoardPage(deps), opts.now);
}

async function readBoardPage(deps: Deps): Promise<BoardPageData> {
  const inventory = readInventory(deps.fs);
  const timer = findTimerUnit(inventory);

  // The sites the app manages, so a site's row can link to its page. An
  // unreadable Caddyfile is an empty set: the board renders, unlinked.
  let managed = new Set<string>();
  try {
    managed = new Set(
      caddyfile
        .parseSites(deps.fs.readFile(config.caddyfilePath))
        .filter((site) => isManagedHostname(site.hostname, config.domain))
        .map((site) => site.hostname),
    );
  } catch {
    // degrade to no links
  }

  // Each read degrades independently; the page must render without either.
  const units = inventory.entries.flatMap((e) => (e.kind === "unit" ? [e.unit] : []));
  const projects = inventory.entries.flatMap((e) => (e.kind === "container" ? [e.container] : []));
  const [states, schedule, statuses, declarations, lastRuns] = await Promise.all([
    deps.commands.readUnitStates(units).catch(() => ({})),
    timer ? deps.commands.readTimerSchedule(timer).catch(noSchedule) : noSchedule(),
    // One wrapper call per project, concurrently; each degrades alone.
    Promise.all(
      projects.map(async (p): Promise<[string, ServiceStatus]> => [
        p,
        await deps.commands.readResourceStatus(p).catch((): ServiceStatus => "unknown"),
      ]),
    ),
    // Which site rows can be pruned. null (an unreadable clone) and a
    // failed read both mean no Prune control anywhere: the button is
    // offered only on evidence that the declaration is absent.
    deps.commands.readDeclarations().catch(() => null),
    // Host actions: one systemd read for every listed action of every row
    // that has them. Degrades to no last-run line by itself.
    readLastRuns(deps, inventory.entries),
  ]);
  const board = buildBoard(inventory, states, schedule, Object.fromEntries(statuses));
  const prunable = new Set(
    (declarations ?? []).filter((d) => d.state === "absent" && isSiteName(d.name, config.domain)).map((d) => d.name),
  );

  // A Deploy this app committed that the reconciler has not reported yet.
  // An unreadable clone has no declarations, so every row keeps its offer.
  const requested = new Map<string, string>();
  for (const g of board.groups) {
    for (const row of g.rows) {
      if (row.kind !== "container") continue;
      const tag = pendingTag(row, declaredTag((declarations ?? []).find((d) => d.name === row.name)));
      if (tag !== null) requested.set(row.name, tag);
    }
  }

  return { board, prunable, managed, requested, lastRuns, now: new Date() };
}

export function createServicesRouter(deps: Deps): express.Router {
  const router = express.Router();

  // The three board pages are the client's: the shared shell around a React
  // mount point, titled as the client titles them after an in-app navigation.
  // The data comes from /api/services, so nothing here reads the board.
  for (const [path, group] of CLIENT_PAGES) {
    router.get(path, (_req, res) => {
      // One read of the bundle (the dev server's getter re-reads the manifest),
      // checked here and then emitted by layout() from the same shell.
      const shell = loadShell(deps, { page: GROUP_PAGES[group] });
      if (!shell.assets) return res.status(500).type("text/plain").send("client bundle missing; run npm run build");
      return res.type("html").send(renderClientPage(GROUP_LABELS[group], GROUP_PAGES[group], shell));
    });
  }

  // The same board as JSON, for the client. Sets and Maps do not serialise, so
  // the board goes out narrowed to the requested group, with the sets as arrays and the map as a record.
  router.get("/api/services", async (req, res) => {
    const group = req.query.group;
    if (typeof group !== "string" || !isServiceGroup(group)) {
      const reason: ApiError["reason"] = "group must be one of reconciler, service, infrastructure";
      return res.status(400).json({ ok: false, reason } satisfies ApiError);
    }
    try {
      const { board, now, prunable, managed, requested, lastRuns } = await loadBoardPage(deps);
      const only: ServiceBoard = { ...board, groups: board.groups.filter((g) => g.group === group) };
      // The page's "unavailable" vs "lists no X" choice depends on the whole
      // board, which the narrowing above discards, so it travels separately.
      const boardEmpty = board.groups.length === 0;
      return res.json({
        ok: true,
        board: only,
        boardEmpty,
        now: now.toISOString(),
        prunable: [...prunable],
        managed: [...managed],
        domain: config.domain,
        requested: Object.fromEntries(requested),
        lastRuns,
      } satisfies ApiOk<BoardPayload>);
    } catch (error) {
      return res.status(500).json({ ok: false, reason: `Could not read services: ${String(error)}` } satisfies ApiError);
    }
  });

  // Host actions (start/stop/restart/update) on a declared unit, as the
  // operator. A refusal is always JSON, never a redirect, like the routes below.
  router.post("/services/:name/actions/:action", async (req, res) => {
    const { name, action } = req.params;
    // The raw string is checked before anything, the audit log included, reads it.
    if (!isHostAction(action)) return res.status(404).json({ ok: false, reason: `no action ${action}` });
    try {
      const result = await requestAction(deps, name, action, { kind: "operator" });
      clearBoardCache();
      if (!result.ok) return res.status(result.status).json({ ok: false, reason: result.message });
      if (String(req.headers.accept ?? "").includes("application/json")) {
        return res.status(202).json({ ok: true, state: result.state });
      }
      return res.redirect(303, "/services");
    } catch (error) {
      return res.status(500).json({ ok: false, reason: `could not start ${action} on ${name}: ${String(error)}` });
    }
  });

  router.get("/services/:name/actions/:action/state", async (req, res) => {
    const { name, action } = req.params;
    try {
      const result = await readCheckedActionState(deps, name, action, { kind: "operator" });
      if (!result.ok) return res.status(result.status).json({ ok: false, reason: result.message });
      // A run that has settled changes the board's last-run line, and the
      // client re-fetches the board right after seeing it: do not serve that
      // re-fetch the read from before the run finished.
      if (result.state.state !== "running") clearBoardCache();
      return res.json({ ok: true, state: result.state });
    } catch (error) {
      return res.status(502).json({ ok: false, reason: `could not read ${name}'s ${action}: ${String(error)}` });
    }
  });

  // One resource, one tag. The tag is read from the inventory here and never
  // from the request, so the only value this can write is one the reconciler
  // itself published as available; a hand-crafted POST cannot name another.
  router.post("/services/:name/deploy", async (req, res) => {
    const { name } = req.params;
    const { logAction } = deps.logger;
    try {
      const entry = readInventory(deps.fs).entries.find((e) => e.name === name);
      if (!entry) {
        res.status(404).json({ ok: false, reason: `No declared service named ${name}.` });
        return;
      }
      if (!entry.available || entry.available === entry.version) {
        res.status(409).json({ ok: false, reason: `${name} has no newer version on offer.` });
        return;
      }
      // Already the pin: a second write of the same tag would only race the first.
      if (entry.target === entry.available) {
        res.status(409).json({ ok: false, reason: `${entry.available} is already requested for ${name}.` });
        return;
      }
      // Never throws by contract; the catch below is for the contract failing.
      const result = await deps.commands.writeDeclarationTag(name, entry.available);
      clearBoardCache();
      if (!result.ok) {
        logAction({ action: "deploy-service-failed", hostname: name, detail: `${entry.available}: ${result.reason}` });
        res.status(502).json({ ok: false, reason: result.reason });
        return;
      }
      logAction({ action: "deploy-service", hostname: name, detail: entry.available });
      res.json({ ok: true, tag: entry.available });
    } catch (error) {
      logAction({ action: "deploy-service-failed", hostname: name, detail: String(error) });
      res.status(502).json({ ok: false, reason: `Could not request the deploy: ${String(error)}` });
    }
  });

  // Deletes a retired site's declaration. The container must be confirmed down
  // first: the inventory is the reconciler's own record, and an entry with no
  // installed version and a settled result is what "down" looks like there.
  // The writer re-checks `state: absent` against the freshly pulled file.
  //
  // `awaiting-image` alone is not proof: a running, never-deployed site
  // publishes it too, and if Deploy wrote a tag and a reconcile is bringing the
  // container up while the inventory still shows the previous tick, the entry
  // would pass and the prune would orphan a running container. So on that path
  // the writer must also find the declaration TAGLESS after its pull
  // (`requireTagless`); a tagless declaration can never have been brought up,
  // and nothing in this app removes a tag. A `tagged` refusal is the same 409
  // as an unconfirmed entry. `deployed` with no version needs no such check.
  router.post("/resources/:name/prune", async (req, res) => {
    const { name } = req.params;
    const { logAction } = deps.logger;
    try {
      // Every 404 and 409 is an audited refusal, exactly one entry per request
      // (a writer refusal that maps to one is logged as refused, not failed).
      const refuse = (status: 404 | 409, reason: string) => {
        logAction({ action: "prune-declaration-refused", hostname: name, detail: reason });
        res.status(status).json({ ok: false, reason });
      };
      if (!isSiteName(name, config.domain)) {
        refuse(404, `No site resource named ${name}.`);
        return;
      }
      const declarations = await deps.commands.readDeclarations();
      if (declarations === null) {
        res.status(502).json({ ok: false, reason: "Could not read the declarations clone." });
        return;
      }
      if (!declarations.some((d) => d.name === name)) {
        refuse(404, `No declaration named ${name}.`);
        return;
      }
      const entry = readInventory(deps.fs).entries.find((e) => e.name === name);
      if (!entry || entry.version || !entry.result || !["deployed", "awaiting-image"].includes(entry.result)) {
        refuse(409, CONFIRM_DOWN_REASON);
        return;
      }
      const result = await deps.commands.pruneSiteDeclaration(name, { requireTagless: entry.result === "awaiting-image" });
      clearBoardCache();
      if (!result.ok) {
        if (result.code === "tagged") {
          // Same refusal as an unconfirmed entry, so the same body; the log
          // keeps the writer's own reason.
          logAction({ action: "prune-declaration-refused", hostname: name, detail: result.reason });
          res.status(409).json({ ok: false, reason: CONFIRM_DOWN_REASON });
          return;
        }
        if (result.code === "not-absent") return refuse(409, result.reason);
        if (result.code === "missing") return refuse(404, result.reason);
        logAction({ action: "prune-declaration-failed", hostname: name, detail: result.reason });
        res.status(502).json({ ok: false, reason: result.reason });
        return;
      }
      logAction({ action: "prune-declaration", hostname: name });
      res.json({ ok: true });
    } catch (error) {
      logAction({ action: "prune-declaration-failed", hostname: name, detail: String(error) });
      res.status(502).json({ ok: false, reason: `Could not prune the declaration: ${String(error)}` });
    }
  });

  return router;
}
