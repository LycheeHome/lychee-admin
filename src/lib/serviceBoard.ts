import type { InventoryEntry, ServiceGroup, ServiceInventory } from "./serviceInventory";
import type { TimerSchedule, UnitState, UnitStatus } from "./unitState";

export interface BoardRow extends InventoryEntry {
  status: UnitStatus;
  /** When the current state began; see UnitState.since. */
  since: string | null;
}

export interface ServiceBoard {
  groups: Array<{ group: ServiceGroup; rows: BoardRow[] }>;
  /** The reconciler timer's schedule. One timer, so one schedule on the board
   *  rather than a field every row would carry and only one could fill. */
  schedule: TimerSchedule;
  generated: string | null;
  inventoryAvailable: boolean;
}

/** Fixed display order: what deploys things, what runs, what carries traffic. */
const GROUP_ORDER: readonly ServiceGroup[] = ["reconciler", "service", "infrastructure"];

/**
 * The inventory says what SHOULD run; unit state says what IS running. The join
 * is driven by the inventory, so a unit alive on the host but declared nowhere
 * simply has no row — drift the page cannot show, which is why the inventory is
 * the declared set rather than a scrape.
 *
 * A declared unit with no live state reads `unknown` (neutral) rather than
 * `exited`, because the absence means the query failed, not that the service
 * stopped.
 */
export function buildBoard(
  inv: ServiceInventory,
  states: Record<string, UnitState>,
  schedule: TimerSchedule,
): ServiceBoard {
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: inv.entries
      .filter((e) => e.group === group)
      .map((e): BoardRow => {
        const live = states[e.unit];
        return { ...e, status: live?.status ?? "unknown", since: live?.since ?? null };
      }),
  })).filter((g) => g.rows.length > 0);

  return { groups, schedule, generated: inv.generated, inventoryAvailable: inv.available };
}
