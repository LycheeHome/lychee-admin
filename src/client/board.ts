import type { BoardPayload } from "../shared/board";
import { isApplying } from "../views/boardFacts";
import { isRunning } from "../views/boardRowModel";

/**
 * Whether anything on the board is moving, which is when the board polls
 * fast. A row is in progress when the reconciler is applying a moved pin
 * (`isApplying`, the rule that puts `applying` on its pill), when a Deploy
 * requested a tag its `version` does not show yet, or when a host action is
 * running (`isRunning`, the rule that disables the strip). Every group the
 * payload carries counts; the API narrows it to one.
 */
export function boardInProgress(p: BoardPayload): boolean {
  const rows = p.board.groups.flatMap((g) => g.rows);
  if (rows.some((row) => isApplying(row))) return true;
  if (rows.some((row) => Object.hasOwn(p.requested, row.name) && p.requested[row.name] !== row.version)) return true;
  return Object.values(p.lastRuns).some((run) => isRunning(run));
}
