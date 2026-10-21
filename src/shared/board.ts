// Types only: nothing here may carry runtime code, because the server build
// (CommonJS) and the client build (Vite) both read this file.
export type { BoardRow, ServiceBoard } from "../lib/serviceBoard";
export type { ServiceGroup } from "../lib/serviceInventory";

/** Success envelope for every /api route. */
export type ApiOk<T> = { ok: true } & T;
/** Error envelope for every /api route. */
export type ApiError = { ok: false; reason: string };
