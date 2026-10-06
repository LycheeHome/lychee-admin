import express from "express";
import type { Deps } from "../deps";
import { readInventory } from "../lib/serviceInventory";
import { buildBoard, findTimerUnit } from "../lib/serviceBoard";
import { renderServicesPage } from "../views/html";
import type { ServiceStatus, TimerSchedule } from "../lib/unitState";

// A function, not a shared constant: it lands on board.schedule, and a shared
// mutable object is the shape readInventory's unavailable() exists to avoid.
const noSchedule = (): TimerSchedule => ({ next: null, last: null });

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
      const [states, schedule, statuses] = await Promise.all([
        deps.commands.readUnitStates(units).catch(() => ({})),
        timer ? deps.commands.readTimerSchedule(timer).catch(noSchedule) : noSchedule(),
        // One wrapper call per project, concurrently; each degrades alone.
        Promise.all(
          projects.map(async (p): Promise<[string, ServiceStatus]> => [
            p,
            await deps.commands.readResourceStatus(p).catch((): ServiceStatus => "unknown"),
          ]),
        ),
      ]);
      const board = buildBoard(inventory, states, schedule, Object.fromEntries(statuses));

      res.type("html").send(renderServicesPage(board));
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

  return router;
}
