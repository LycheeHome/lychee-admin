// Types only: nothing here may carry runtime code, because the server build
// (CommonJS) and the client build (Vite) both read this file.
import type { ServiceBoard } from "../lib/serviceBoard";
import type { ActionState } from "../lib/hostOperations";
export type { ActionState } from "../lib/hostOperations";
export type { BoardRow, ServiceBoard } from "../lib/serviceBoard";
export type { ServiceGroup } from "../lib/serviceInventory";

/** Success envelope for every /api route. */
export type ApiOk<T> = { ok: true } & T;
/** Error envelope for every /api route. */
export type ApiError = { ok: false; reason: string };

/**
 * GET /api/services?group=…: the board narrowed to one group, whether the
 * WHOLE board was empty (the narrowing discards that, and the page's
 * "unavailable" explanation depends on it), and the server's clock as ISO.
 */
export type BoardPayload = {
  board: ServiceBoard;
  boardEmpty: boolean;
  now: string;
  /** Site rows whose declaration is absent and whose container is confirmed down: they offer Prune. */
  prunable: string[];
  /** Site rows whose declaration is absent but whose container is not yet confirmed down: a retiring line, no Prune. */
  retiring: string[];
  /** Hostnames that are managed sites, so a site resource's name links to its page. */
  managed: string[];
  /**
   * The managed domain (`DOMAIN`). A row's name maps to a hostname in
   * `managed` only through it (`<label>-lychee-land` to `<label>.lychee.land`),
   * and the Prune guard's site-name check reads it, as the HTML board does.
   */
  domain: string;
  /** Unit name to the tag a Deploy requested that the inventory has not yet applied. */
  requested: Record<string, string>;
  /** The last host-action run per unit. */
  lastRuns: Record<string, ActionState>;
};
