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
 * `assets` is read from `deps.clientAssets` on every call, never cached: the
 * dev server defines it as a getter that re-reads Vite's manifest.
 */
export function loadShell(deps: Deps, current: RailCurrent): ShellData {
  return { rail: { ...readRail(deps), current }, assets: deps.clientAssets ?? null };
}
