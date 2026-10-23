// Types only: nothing here may carry runtime code, because the server build
// (CommonJS) and the client build (Vite) both read this file.
import type { HostProblem, SiteStatus } from "../lib/siteDisplay";
export type { HostProblem, SiteStatus } from "../lib/siteDisplay";

/** One managed site as the list shows it. */
export type SiteSummary = {
  hostname: string;
  type: "static" | "reverse-proxy";
  target: string;
  framework?: string;
};

/**
 * GET /api/sites: the managed sites in Caddyfile order, the status of each
 * reverse-proxy one, the host units that are down, the managed domain, and
 * the Caddyfile read error (the request still answers 200 with it set).
 */
export type SitesPayload = {
  sites: SiteSummary[];
  statuses: Record<string, SiteStatus>;
  problems: HostProblem[];
  domain: string;
  caddyfileError: string | null;
};
