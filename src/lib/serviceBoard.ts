import type { InventoryEntry, ServiceGroup, ServiceInventory } from "./serviceInventory";
import type { TimerSchedule, UnitState, UnitStatus } from "./unitState";

export type BoardRow = InventoryEntry & {
  status: UnitStatus;
  /** When the current state began; see UnitState.since. Always null for a
   *  container: compose reports elapsed text, not a timestamp. */
  since: string | null;
};

export interface ServiceBoard {
  groups: Array<{ group: ServiceGroup; rows: BoardRow[] }>;
  /** The reconciler timer's schedule. One timer, so one schedule on the board
   *  rather than a field every row would carry and only one could fill. */
  schedule: TimerSchedule;
  /** The unit that owns `schedule`, decided once here so the route that reads
   *  the schedule and the row that shows it cannot disagree. Null: none declared. */
  timerUnit: string | null;
  generated: string | null;
  inventoryAvailable: boolean;
}

/**
 * The reconciler's timer, found in the declared set rather than named in code:
 * the inventory is the declared set precisely so a new service needs no app
 * release. No such entry means null, never a guessed unit name.
 */
export function findTimerUnit(inv: ServiceInventory): string | null {
  for (const e of inv.entries) {
    if (e.kind === "unit" && e.group === "reconciler" && e.unit.endsWith(".timer")) return e.unit;
  }
  return null;
}

/** Fixed display order: what deploys things, what runs, what carries traffic. */
const GROUP_ORDER: readonly ServiceGroup[] = ["reconciler", "service", "infrastructure"];

/**
 * The inventory says what SHOULD run; unit state says what IS running. The join
 * is driven by the inventory, so a unit alive on the host but declared nowhere
 * simply has no row — drift the page cannot show, which is why the inventory is
 * the declared set rather than a scrape.
 *
 * A declared unit or container with no live state reads `unknown` (neutral)
 * rather than `exited`, because the absence means the query failed, not that
 * the service stopped. Containers are looked up by compose project name and
 * never carry `since`.
 */
export function buildBoard(
  inv: ServiceInventory,
  states: Record<string, UnitState>,
  schedule: TimerSchedule,
  containerStates: Record<string, UnitStatus> = {},
): ServiceBoard {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: inv.entries
      .filter((e) => e.group === group)
      .map((e): BoardRow => {
        if (e.kind === "container") {
          return { ...e, status: containerStates[e.container] ?? "unknown", since: null };
        }
        const live = states[e.unit];
        return { ...e, status: live?.status ?? "unknown", since: live?.since ?? null };
      }),
  })).filter((g) => g.rows.length > 0);

  return { groups, schedule, timerUnit: findTimerUnit(inv), generated: inv.generated, inventoryAvailable: inv.available };
}
