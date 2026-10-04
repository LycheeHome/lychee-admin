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
            await deps.commands.readServiceStatus(p).catch((): ServiceStatus => "unknown"),
          ]),
        ),
      ]);
      const board = buildBoard(inventory, states, schedule, Object.fromEntries(statuses));

      res.type("html").send(renderServicesPage(board));
    } catch (error) {
      res.status(500).type("text/plain").send(`Could not render services: ${String(error)}`);
    }
  });

  return router;
}
