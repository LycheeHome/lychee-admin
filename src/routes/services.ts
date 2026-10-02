import express from "express";
import type { Deps } from "../deps";
import { readInventory } from "../lib/serviceInventory";
import { buildBoard } from "../lib/serviceBoard";
import type { TimerSchedule } from "../lib/unitState";

const NO_SCHEDULE: TimerSchedule = { next: null, last: null };

export function createServicesRouter(deps: Deps): express.Router {
  const router = express.Router();

  router.get("/services", async (_req, res) => {
    const inventory = readInventory(deps.fs);

    // The timer is found in the declared set, not named here: the inventory is
    // the declared set precisely so a new service needs no app release. No
    // such entry means no call, never a guessed unit name.
    const timer = inventory.entries.find((e) => e.group === "reconciler" && e.unit.endsWith(".timer"));

    // Each read degrades independently; the page must render without either.
    const [states, schedule] = await Promise.all([
      deps.commands.readUnitStates(inventory.entries.map((e) => e.unit)).catch(() => ({})),
      timer ? deps.commands.readTimerSchedule(timer.unit).catch(() => NO_SCHEDULE) : NO_SCHEDULE,
    ]);
    const board = buildBoard(inventory, states, schedule);

    // Placeholder rendering. The next task replaces this with the real page,
    // designed through impeccable; this exists so the route is testable alone.
    res.type("text/plain").send(JSON.stringify(board, null, 2));
  });

  return router;
}
