// Types only: nothing here may carry runtime code, because the server build
// (CommonJS) and the client build (Vite) both read this file.

/**
 * GET /api/rail: the rail's rows, read without a status check. `sites` is null
 * when the Caddyfile cannot be read; `hostAvailable` is false when the
 * reconciler's inventory cannot be read.
 */
export interface RailPayload {
  sites: { hostname: string; hint: string }[] | null;
  hostAvailable: boolean;
  domain: string;
}

/**
 * Which rail item is current: a page's own link, a site's row, or nothing
 * (the add-site page, whose breadcrumb carries its location; the not-found
 * page; and any URL no route owns).
 */
export type RailCurrent =
  | { page: "overview" | "activity" | "sites" | "services" | "reconciler" | "infrastructure" }
  | { site: string }
  | null;

/** What the rail renders: its rows from GET /api/rail, and the item to mark current. */
export interface RailData {
  /** Managed sites in Caddyfile order, `hint` being `static` or `:<port>`; null when the Caddyfile is unreadable. */
  sites: Array<{ hostname: string; hint: string }> | null;
  /** Whether the inventory could be read. Without it the host links carry a note saying so. */
  hostAvailable: boolean;
  current: RailCurrent;
  domain: string;
}
