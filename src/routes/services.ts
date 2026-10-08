import express from "express";
import type { Deps } from "../deps";
import { isSiteName } from "../lib/declarationWriter";
import { readInventory } from "../lib/serviceInventory";
import { buildBoard, findTimerUnit } from "../lib/serviceBoard";
import { renderServicesPage } from "../views/html";
import type { ServiceStatus, TimerSchedule } from "../lib/unitState";

// A function, not a shared constant: it lands on board.schedule, and a shared
// mutable object is the shape readInventory's unavailable() exists to avoid.
const noSchedule = (): TimerSchedule => ({ next: null, last: null });
const CONFIRM_DOWN_REASON = "the container hasn't been confirmed down yet; try after the next reconcile";

export function createServicesRouter(deps: Deps): express.Router {
  const router = express.Router();

  router.get("/services", async (_req, res) => {
    // Every read below already degrades, so this should be unreachable; it is
    // here because Express 4 does not catch an async handler's rejection, and
    // this is the one page whose design goal is that it never errors.
    try {
      const inventory = readInventory(deps.fs);
      const timer = findTimerUnit(inventory);

      // Each read degrades independently; the page must render without either.
      const units = inventory.entries.flatMap((e) => (e.kind === "unit" ? [e.unit] : []));
      const projects = inventory.entries.flatMap((e) => (e.kind === "container" ? [e.container] : []));
      const [states, schedule, statuses, declarations] = await Promise.all([
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
      ]);
      const board = buildBoard(inventory, states, schedule, Object.fromEntries(statuses));
      const prunable = new Set(
        (declarations ?? []).filter((d) => d.state === "absent" && isSiteName(d.name)).map((d) => d.name),
      );

      res.type("html").send(renderServicesPage(board, new Date(), prunable));
    } catch (error) {
      res.status(500).type("text/plain").send(`Could not render services: ${String(error)}`);
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
      if (!isSiteName(name)) {
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
