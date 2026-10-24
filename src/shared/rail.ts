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
