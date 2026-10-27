// Types only: nothing here may carry runtime code, because the server build
// (CommonJS) and the client build (Vite) both read this file.
import type { ServiceGroup } from "./board";

/** The canonical three tones, plus `none` for a static site: nothing to poll. */
export type Tone = "ok" | "bad" | "neutral" | "none";

export interface SiteHealth {
  hostname: string;
  tone: Tone;
  /** The canonical status phrase, e.g. `failed` or `not responding`; empty for a static site. */
  label: string;
  attention: boolean;
}

export interface UnitHealth {
  name: string;
  group: ServiceGroup;
  tone: Exclude<Tone, "none">;
  label: string;
  /** Set only when the last run is classified as trouble the operator must act on. */
  trouble: "blocked" | "failed" | null;
  href: string;
  attention: boolean;
  /**
   * The managed site this unit's container serves, or null. Such a unit counts
   * on its board page and under sites, and once in the overall count.
   */
  site: string | null;
}

/** GET /api/health. `units` is null when the inventory is unavailable. */
export interface HealthPayload {
  sites: SiteHealth[];
  units: UnitHealth[] | null;
  now: string;
}
