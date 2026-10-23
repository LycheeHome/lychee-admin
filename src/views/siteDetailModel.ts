// Node-free model for the site detail page: the facts both renderers read.
import type { SiteStatus } from "../lib/siteDisplay";
import type { UnitState } from "../lib/unitState";

/**
 * A site attached to a repository: its resource in lychee-resources plus what
 * the reconciler last published about it. `version` is what is installed;
 * `available` the newest tag the registry offers; `target` what the
 * declaration pins. `result` is absent until the reconciler's first tick.
 */
export interface SiteResourceView {
  name: string;
  /** Null when only the inventory knows the site (the declaration was unreadable). */
  repo: string | null;
  available?: string;
  version?: string;
  result?: string;
  target?: string;
  gate?: string;
  /** The reconciler task that failed, with its error, when `result` is failed. */
  failedStep?: string;
  /** A tag the declaration holds that the reconciler has not applied yet (`pendingTag`). It replaces the offer only when it equals the offered tag. */
  requestedTag?: string;
}

export interface SiteDetailOptions {
  sitesRoot: string;
  domain: string;
  tunnelId: string;
  tunnelConfigPath: string;
  caddyfilePath: string;
  status?: SiteStatus;
  /** Live unit states for the tunnel and Caddy hops, keyed by unit name. */
  unitStates?: Record<string, UnitState>;
  scaffold?: { buildCommand: string; runCommand: string };
  /** The files a Next.js site's repository needs, rendered in full. */
  scaffoldFiles?: { name: string; content: string }[];
  /** Absent means not attached. */
  resource?: SiteResourceView;
  /** A declaration exists but is `state: absent`: not attached. Attach stays
   *  offered, with a warning that it is refused until the file is pruned; the
   *  writer's own fresh pull is what decides. */
  detached?: boolean;
  /** Whether a reverse-proxy site's /var/www directory exists. Only legacy Next.js sites have one. */
  filesExist?: boolean;
  /** Set when this page is the redirect target of a successful add (`?created=1`). */
  created?: boolean;
}

export type FailureFacts = { result?: string; target?: string; failedStep?: string };
