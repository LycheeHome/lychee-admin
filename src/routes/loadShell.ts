import type { Deps } from "../deps";
import type { RailCurrent, ShellData } from "../views/shell";
import { readRail } from "./rail";

/**
 * What every page's shell needs, read cheaply: the rail's rows (`readRail`,
 * no status checks; health is the island's poll) and the client bundle's tags.
 *
 * It lives beside the routes rather than in src/views/shell.ts because
 * `readRail` reads `config`, which demands the environment at import.
 *
 * No route calls it since every client route sends the static document; it
 * goes with layout(). `assets` is always null now.
 */
export function loadShell(deps: Deps, current: RailCurrent): ShellData {
  return { rail: { ...readRail(deps), current }, assets: null };
}
