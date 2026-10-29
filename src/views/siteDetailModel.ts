// Node-free model for the site detail page: the facts the page reads, and the
// decisions it makes from them — which hop needs a fix, which runbook step is
// done, what is on offer, what Remove will do. Every function returns data,
// never markup. The React page (src/client/components/SiteDetail.tsx and its
// cards) renders it; the server renderer that shared it was retired, and the
// route uses addedNotice for the ?created=1 banner. No node imports: Vite
// bundles this file for the client.
import type { Site } from "../lib/caddyfile";
import { describeStatus, splitHostnameForDisplay, type SiteStatus } from "../lib/siteDisplay";
import type { UnitState } from "../lib/unitState";
import type { SiteDetailFacts } from "../shared/siteDetail";
import { offeredTag, rowLabels } from "./boardFacts";
import { PROSE_MEASURE, statePhrase } from "./shared";

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

// ---------------------------------------------------------------------------
// Class strings only the detail page uses. Shared ones live in shared.ts.

export const HOP_LABEL =
  "font-mono text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-stone-400 m-0 mb-1.5";
export const HOP_VALUE = "font-mono text-[0.8rem] text-stone-50 m-0 mb-0.5 break-all";
export const DETAIL_ROW = "font-mono text-[0.8rem] m-0 mb-1 flex gap-3 last:mb-0";
/** The header's action slot: the Activity button and Visit, side by side. */
export const SITE_HEADER_ACTIONS = "flex items-center gap-2.5 shrink-0";
export const DETAIL_KEY = "text-stone-400 min-w-[7.5rem] shrink-0";
export const STEP_NUMBER =
  "font-mono text-[0.6875rem] text-rose-400 border border-rose-400/40 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
export const STEP_TEXT = `text-stone-400 text-[0.8rem] leading-snug m-0 mb-1.5 ${PROSE_MEASURE}`;
export const INLINE_CODE = "font-mono text-[0.72rem] text-stone-300 bg-stone-900 rounded-[4px] px-1";
export const STEP_DONE =
  "font-mono text-[0.6875rem] text-stone-300 border border-stone-600 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
/**
 * A whole file, at full height. It wraps rather than scrolling sideways: the
 * Show-It Rule allows horizontal overflow only on a one-line command, and the
 * release workflow's build line is wider than the reading column. The copy
 * button reads textContent, so wrapping changes nothing that is copied.
 */
export const CODE_FILE =
  "font-mono text-[0.72rem] leading-[1.6] bg-stone-900 border border-stone-700 rounded-md pl-2.5 pr-11 py-2.5 text-stone-50 whitespace-pre-wrap [overflow-wrap:anywhere] m-0";
/** Multi-line blocks pin their copy button top-right, at the single-line inset. */
export const COPY_TOP = "absolute top-1.5 right-1.5";

// ---------------------------------------------------------------------------
// What to check, under the request path.

export type HopFixKey = "tunnel" | "caddy" | "your app";

export type AppFix =
  | { kind: "failed-first-deploy" }
  | { kind: "port"; command: string }
  | { kind: "container"; command: string };

/** The tunnel and Caddy entries' commands, copied as they are written. */
export const UNIT_FIX_COMMANDS = {
  tunnel: "journalctl -u cloudflared-sites -n 50",
  caddy: "journalctl -u caddy -n 50",
} as const;

const TUNNEL_UNIT = "cloudflared-sites.service";
const CADDY_UNIT = "caddy.service";

/** A unit missing from `unitStates` is `unknown`, which is neutral; with `unitStates` absent, no unit is bad. */
function unitIsBad(f: SiteDetailFacts, unit: string): boolean {
  return f.unitStates !== undefined && rowLabels(f.unitStates[unit]?.status ?? "unknown").tone === "bad";
}

/** "has stopped", "keeps restarting": the unit's pill word as the end of a sentence. */
export function unitPhrase(f: SiteDetailFacts, unit: string): string {
  return statePhrase(rowLabels(f.unitStates?.[unit]?.status ?? "unknown").pill);
}

/**
 * The last hop's entry, the first that applies: a failed first deploy (the
 * reason and the reconciler's journal), a broken installed container (its
 * logs, by compose project name, since the reconciler runs it and there is no
 * site directory), or a plain proxy nobody answered. A never-created container
 * is the neutral tone, so it has no entry.
 */
export function appFix(site: Site, f: SiteDetailFacts): AppFix | null {
  const status = f.status;
  if (status?.kind === "failed" && f.resource && !f.resource.version) return { kind: "failed-first-deploy" };
  if (f.resource && status?.kind === "container" && describeStatus(status).tone === "bad") {
    return { kind: "container", command: `docker compose -p ${f.resource.name} logs --tail 100` };
  }
  if (status?.kind === "tcp" && !status.responding) {
    return { kind: "port", command: `ss -ltn 'sport = :${site.target}'` };
  }
  return null;
}

/** One key per hop in a bad tone, in request order. Hop 1 (DNS) never gets one. */
export function hopFixKeys(site: Site, f: SiteDetailFacts): HopFixKey[] {
  return [
    ...(unitIsBad(f, TUNNEL_UNIT) ? (["tunnel"] as const) : []),
    ...(unitIsBad(f, CADDY_UNIT) ? (["caddy"] as const) : []),
    ...(appFix(site, f) ? (["your app"] as const) : []),
  ];
}

// ---------------------------------------------------------------------------
// The repository card.

/**
 * Each runbook step's state, from evidence the page has: 1 and 2 once the
 * reconciler has found a tag, 3 once a declaration or inventory entry exists,
 * 4 never (it is the step that is always next until a version is installed).
 * Only 1 and 2 fold, and only once done.
 */
export function runbookSteps(_site: Site, f: SiteDetailFacts): { n: 1 | 2 | 3 | 4; done: boolean; folds: boolean }[] {
  const imageFound = Boolean(f.resource?.available);
  const attached = f.resource !== undefined;
  return [
    { n: 1, done: imageFound, folds: imageFound },
    { n: 2, done: imageFound, folds: imageFound },
    { n: 3, done: attached, folds: false },
    { n: 4, done: false, folds: false },
  ];
}

/**
 * Attached, and the reconciler has looked and found no tag. Only then: before
 * its first run nothing has been checked, and once a tag is found or written
 * the declaration is no longer tagless, which the writer refuses to repoint.
 * A null repo means the declaration itself could not be read, so there is no
 * current value to show or correct.
 */
export function canChangeRepository(resource: SiteResourceView | undefined): resource is SiteResourceView & { repo: string } {
  return (
    resource !== undefined &&
    resource.repo !== null &&
    !resource.version &&
    resource.result !== undefined &&
    resource.result !== "failed" &&
    !resource.available &&
    !resource.target
  );
}

/**
 * Which branch the Deploy step (4) is in while nothing is installed:
 * - `unattached`: no resource yet;
 * - `unchecked`: attached, the reconciler has not looked;
 * - `failed`: the first deploy failed (a newer tag may be on offer);
 * - `requested` / `requested-blocked`: the found tag is already pinned;
 * - `offer`: a found tag is on offer;
 * - `awaiting-image-change`: nothing found, and step 3 offers Change repository;
 * - `awaiting-image`: nothing found otherwise.
 */
export type DeployStep =
  | "unattached"
  | "unchecked"
  | "failed"
  | "requested"
  | "requested-blocked"
  | "offer"
  | "awaiting-image-change"
  | "awaiting-image";

export function deployStep(resource: SiteResourceView | undefined): DeployStep {
  if (!resource) return "unattached";
  if (resource.result === undefined) return "unchecked";
  if (resource.result === "failed") return "failed";
  if (resource.target && resource.target === resource.available) {
    return resource.result === "blocked" ? "requested-blocked" : "requested";
  }
  if (offeredTag(resource)) return "offer";
  return canChangeRepository(resource) ? "awaiting-image-change" : "awaiting-image";
}

/**
 * The tag on offer, and whether the declaration already requests it (then the
 * requested line stands in its place). Beside an installed version it is the
 * board's quiet offer; while a first deploy is the next step, the page's
 * Primary. `offeredTag` never re-offers a tag that failed.
 */
export function offerFor(
  f: SiteDetailFacts,
): { name: string; tag: string; requested: boolean; emphasis: "offer" | "primary" } | null {
  const resource = f.resource;
  if (!resource) return null;
  let emphasis: "offer" | "primary";
  if (resource.version) emphasis = "offer";
  else {
    const step = deployStep(resource);
    if (step !== "failed" && step !== "offer") return null;
    emphasis = "primary";
  }
  const tag = offeredTag(resource);
  if (!tag) return null;
  return { name: resource.name, tag, requested: resource.requestedTag === tag, emphasis };
}

// ---------------------------------------------------------------------------
// The page as a whole.

export type DetailCard = "path" | "repository" | "manual" | "danger";

/**
 * DNS is live setup until a site is attached; after that the repository card
 * is the work in hand, so it moves above Manual steps. Only a site with a
 * scaffold (a Next.js site) has a repository card.
 */
export function cardOrder(f: SiteDetailFacts): DetailCard[] {
  if (!f.scaffold) return ["path", "manual", "danger"];
  return f.resource !== undefined
    ? ["path", "repository", "manual", "danger"]
    : ["path", "manual", "repository", "danger"];
}

/**
 * The declaration Remove retires, or null: a framework site that has a
 * resource. The one predicate behind the dialog's fifth step, its step-5 note,
 * its data-attached and the client chain's /detach, so the dialog can never
 * list a step the chain does not run, or run one it does not list.
 */
export function removeDeclaration(site: Site, f: SiteDetailFacts): string | null {
  return site.framework && f.resource ? f.resource.name : null;
}

/** The remove dialog's steps, in the order they run; retiring the declaration is a fifth only when there is one to retire. */
export function removeSteps(site: Site, f: SiteDetailFacts): { id: string; label: string }[] {
  const declaration = removeDeclaration(site, f);
  return [
    { id: "caddyfile", label: "Caddyfile block removed" },
    { id: "tunnel", label: "Tunnel route removed" },
    { id: "caddy", label: "Caddy validated and reloaded" },
    { id: "cloudflared", label: "cloudflared-sites restarted" },
    ...(declaration ? [{ id: "declaration", label: `${declaration}.yml set to state: absent` }] : []),
  ];
}

/**
 * The Danger card's consequence line. It says only what lychee-admin does: the
 * declaration sentence when the site is attached, the files sentence only
 * where the dialog offers its delete-files checkbox, and the DNS record is
 * never touched, so the last sentence always says so.
 */
export function dangerSentences(opts: { attached: boolean; deletableFiles: boolean }): string[] {
  return [
    "Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the sites tunnel.",
    ...(opts.attached ? ["It then retires the site's declaration, which stops its container."] : []),
    ...(opts.deletableFiles ? ["The site's files stay unless you tick the box when you confirm."] : []),
    "lychee-admin never touches the DNS record; delete it in Cloudflare afterwards.",
  ];
}

/**
 * The notice a site lands on after being created. Its job is to explain the
 * status pill beside it: two of the three types arrive not-yet-working, so
 * leading with what did succeed keeps the two from contradicting each other.
 * A site re-added before its old declaration was pruned reads `retired`, so
 * its sentence says that and points at the notice holding Prune.
 */
export function addedNotice(site: Site, opts: { retired?: boolean } = {}): string {
  if (site.type === "static") {
    return `Added ${site.hostname} — Caddy is serving the placeholder page it created. Manual steps has the DNS record and how to replace it.`;
  }
  if (site.framework && opts.retired) {
    return `Added ${site.hostname} — routing is live. It shows as retired until its old declaration is pruned; Prune is just below.`;
  }
  if (site.framework) {
    return `Added ${site.hostname} — routing is live. It shows as not deployed until a repository is attached and its first image deployed; From a repository has the steps.`;
  }
  return `Added ${site.hostname} — routing is live, but nothing is listening on port ${site.target} yet, so it shows as not responding until you start your process.`;
}

// ---------------------------------------------------------------------------
// Manual steps.

/** A run of a sentence: plain text, or an inline machine fact set as code. */
export type Inline = string | { code: string };

export interface StepCommand {
  id: string;
  value: string;
  label?: string;
}

export interface ManualStep {
  /** The sentence, as runs; each renderer escapes the text and wraps the code. */
  text: Inline[];
  command?: StepCommand;
  /** A secondary line and command after the first, for a step with a fallback. */
  then?: { note: Inline[]; command: StepCommand };
}

/**
 * The steps lychee-admin deliberately does not take. DNS is Tier 1 scope (the
 * app never touches Cloudflare DNS), and a static site's placeholder is live
 * until replaced. `filesPath` is passed in because computing it needs Node's
 * path module (`computeFilesPath`).
 *
 * `cloudflared tunnel route dns` needs an account certificate (cert.pem) that
 * exists on the host only during `cloudflared tunnel login`, so the dashboard
 * CNAME leads and the command is a fallback for a machine that has a login.
 */
export function manualSteps(site: Site, f: SiteDetailFacts, filesPath: string | null): ManualStep[] {
  const { lead: label } = splitHostnameForDisplay(site.hostname, f.domain);
  // The apex has no subdomain label; a CNAME for it is named "@".
  const recordName = label === site.hostname ? "@" : label;

  const dnsStep: ManualStep = f.tunnelId
    ? {
        text: [
          "Create the DNS record, once per hostname: in the Cloudflare dashboard, add a proxied CNAME named ",
          { code: recordName },
          " pointing at the target below. Until it exists, the site can't be reached from the internet even while every check on this page passes: lychee-admin checks lychee itself, never Cloudflare.",
        ],
        command: { id: "cmd-dns-target", value: `${f.tunnelId}.cfargotunnel.com`, label: "Copy CNAME target" },
        then: {
          note: [
            "Or, from a machine with a Cloudflare login — the host keeps no account certificate, so run ",
            { code: "cloudflared tunnel login" },
            " first:",
          ],
          command: {
            id: "cmd-dns",
            value: `cloudflared tunnel route dns ${f.tunnelId} ${site.hostname}`,
            label: "Copy route dns command",
          },
        },
      }
    : {
        text: [
          "Create the DNS record, once per hostname — add a CNAME for this hostname to your tunnel from the Cloudflare dashboard. Until it exists, the site can't be reached from the internet even while every check on this page passes: lychee-admin checks lychee itself, never Cloudflare.",
        ],
      };
  const steps: ManualStep[] = [dnsStep];

  // A static site is already serving — add-site created the directory and wrote
  // a placeholder index.html into it — so nothing prompts the user to notice
  // that what is live is a placeholder.
  if (site.type === "static" && filesPath) {
    steps.push({
      // The path and the file are facts, so code (the Mono-Carries-Facts rule).
      text: [
        "Put your site's files in ",
        { code: `${filesPath}/` },
        ". lychee-admin created a placeholder ",
        { code: "index.html" },
        " there, which Caddy serves until you replace it.",
      ],
    });
  }
  return steps;
}
