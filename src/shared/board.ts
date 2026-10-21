// Types only: nothing here may carry runtime code, because the server build
// (CommonJS) and the client build (Vite) both read this file.
import type { ServiceBoard } from "../lib/serviceBoard";
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
};
