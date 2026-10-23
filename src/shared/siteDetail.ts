// Type-only: imported by both the server and the client.
import type { Site } from "../lib/caddyfile";
import type { SiteDetailOptions } from "../views/siteDetailModel";

export type SiteDetailFacts = Omit<SiteDetailOptions, "created">;
export type SiteDetailPayload =
  | ({ site: Site; filesPath: string | null; caddyfileError: null } & SiteDetailFacts)
  | { caddyfileError: string; domain: string };
