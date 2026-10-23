import path from "node:path";
import { computeFilesPath, type Site } from "../lib/caddyfile";
import {
  describeStatus,
  troubleGate,
  splitHostnameForDisplay,
  type StatusTone,
  visitIsForward,
} from "../lib/siteDisplay";
import { ADD_STEPS } from "../lib/stepReport";
import { resourceNameFor } from "../lib/siteResource";
import { IMAGE_PREFIX } from "../lib/platform";
import { layout, type ShellData } from "./shell";
import { offeredTag, rowLabels } from "./boardFacts";
import {
  addedNotice,
  appFix,
  canChangeRepository,
  cardOrder,
  dangerSentences,
  deployStep,
  hopFixKeys,
  manualSteps,
  offerFor,
  removeSteps,
  runbookSteps,
  unitPhrase,
  UNIT_FIX_COMMANDS,
  CODE_FILE,
  COPY_TOP,
  DETAIL_KEY,
  DETAIL_ROW,
  HOP_LABEL,
  HOP_VALUE,
  INLINE_CODE,
  STEP_DONE,
  STEP_NUMBER,
  STEP_TEXT,
  type FailureFacts,
  type Inline,
  type ManualStep,
  type SiteDetailOptions,
  type SiteResourceView,
  type StepCommand,
} from "./siteDetailModel";
export type { SiteDetailOptions, SiteResourceView };
import {
  escapeHtml,
  icon,
  ERROR_BOX,
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY,
  BUTTON_SECONDARY_COMPACT,
  BUTTON_DANGER,
  INPUT,
  FORM_LABEL,
  FOCUS_RING,
  DETAIL_WIDTH,
  FRAME_WIDTH,
  CARD,
  CARD_LABEL,
  CARD_LABEL_BASE,
  TONE_PILL,
  TONE_TEXT,
  BUTTON_OFFER,
  SERVICE_DETAIL,
  BODY,
  CODE_LINE,
  COPY_BUTTON,
  COPY_IN_LINE,
  MONO_FACT,
  PATH_LABEL,
  statePhrase,
} from "./shared";
import { FRAMEWORK_LABELS } from "./siteListModel";

/**
 * The copy affordance app.js already understands: it reads the target
 * element's textContent, and falls back to selecting the text when
 * navigator.clipboard is unavailable — which it is here, since this app is
 * served over plain HTTP on the LAN.
 */
function copyButton(targetId: string, label: string, extraClass = ""): string {
  return `<button type="button" class="${COPY_BUTTON} ${extraClass}" data-copy-target="${targetId}" aria-label="${escapeHtml(label)}">
      <span data-copy-icon="idle">${icon("clipboard")}</span>
      <span data-copy-icon="copied" class="hidden">${icon("check")}</span>
    </button>`;
}

/**
 * The page a site route answers 500 with when it cannot read the Caddyfile.
 * It used to borrow the list's layout, so a failed detail page announced an
 * empty "Sites" heading and an empty state; this carries the message and a
 * way back, and nothing else.
 */
export function renderErrorPage(title: string, message: string, shell: ShellData): string {
  return layout(
    title,
    `
    <div class="${FRAME_WIDTH} flex flex-col gap-4">
      <p class="${ERROR_BOX}">${escapeHtml(message)}</p>
      <p class="m-0"><a href="/" class="text-stone-400 no-underline font-mono text-[0.72rem] hover:text-stone-50 hover:underline ${FOCUS_RING}">← sites</a></p>
    </div>
    `,
    { shell },
  );
}

export function renderAddSite(
  sites: Site[],
  domain: string,
  portOwners: Record<string, string>,
  // Passed in rather than read from config here, matching the detail page: a
  // view that knows these paths by itself is a view that
  // can disagree with the files the app actually edits.
  paths: { caddyfilePath: string; tunnelConfigPath: string },
  shell: ShellData,
): string {
  return layout(
    "Add a site",
    `
    <div class="${FRAME_WIDTH} flex flex-col gap-6">
      <div class="flex flex-col gap-3">
        <nav class="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
          <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
          <span class="text-stone-600 mx-1.5" aria-hidden="true">/</span>
          <span class="text-stone-50">new</span>
        </nav>

        <!--
          The headline is the site being composed, in the same Headline
          treatment its detail page will give it — so the page you are filling
          in already looks like the page you are about to create. app.js
          retypes #composed-hostname as you type; before that it reads "Add a
          site", which is what the page is when it has no subject yet.
        -->
        <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">
          <span id="composed-hostname" data-domain="${escapeHtml(domain)}">Add a site</span>
        </h2>
      </div>

      <div id="add-site-columns" class="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 items-start">
        <form id="add-site-form" method="post" action="/sites" class="flex flex-col gap-6">
          <label class="${FORM_LABEL}">
            Hostname
            <span id="hostname-row" class="flex items-stretch rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2">
              <input type="text" id="hostname-field" name="hostname" required autocomplete="off"
                     aria-describedby="hostname-suffix"
                     class="${INPUT} rounded-r-none flex-1 min-w-0 focus:outline-none!" placeholder="blog" />
              <span id="hostname-suffix" class="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-l-0 border-stone-700 rounded-r-md px-2.5 flex items-center shrink-0">.${escapeHtml(domain)}</span>
            </span>
          </label>

          <fieldset class="border-0 p-0 m-0 flex flex-col gap-3">
            <legend class="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-0 mb-2">Type</legend>

            <label class="flex flex-col gap-1 rounded-md border border-stone-600 bg-stone-700/50 px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-700/80 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500">
              <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
                <input type="radio" name="type" value="static" checked aria-label="Static site" aria-describedby="type-static-description" class="accent-stone-300 ${FOCUS_RING}" />
                Static site
              </span>
              <span id="type-static-description" class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lychee-admin creates for you with a placeholder page — no process to run yourself.</span>
            </label>

            <label class="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
              <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
                <input type="radio" name="type" value="reverse-proxy" aria-label="Reverse proxy" aria-describedby="type-proxy-description" class="accent-rose-400 ${FOCUS_RING}" />
                Reverse proxy
              </span>
              <span id="type-proxy-description" class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lychee-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
              <span id="type-proxy-description-nextjs" class="hidden text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a container the reconciler runs on this port, built from the site's own repository. After you add it, the site's page has the steps to attach and deploy.</span>
            </label>
          </fieldset>

          <div class="port-input hidden flex-col gap-3 border-l-2 border-l-rose-800/70 pl-3 ml-1">
            <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
              Local port (reverse proxy only)
              <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" aria-describedby="port-error" />
              <span id="port-error" class="port-error hidden text-red-300 text-[0.8rem]" role="status" aria-live="polite"></span>
            </label>
            <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
              Framework (optional)
              <select name="framework" class="${INPUT}" id="framework-field">
                <option value="none">None</option>
                <option value="nextjs">Next.js — built from its own repository; the reconciler runs it</option>
              </select>
            </label>
            <label class="hidden flex-col gap-1.5 text-[0.85rem] text-stone-400" id="healthcheck-field-wrapper">
              Healthcheck path (optional)
              <input type="text" name="healthcheckPath" placeholder="/" class="${INPUT}" id="healthcheck-field" />
              <span class="text-[0.75rem] text-stone-400 leading-snug">Path Docker will poll inside the container to decide if it's healthy. Defaults to <code class="font-mono">/</code>.</span>
            </label>
          </div>
          <script type="application/json" id="port-owners-data">${JSON.stringify(portOwners)}</script>

          <p id="add-site-error" role="alert" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

          <div class="flex items-center justify-end gap-2.5">
            <a href="/" class="${BUTTON_SECONDARY} no-underline">Cancel</a>
            <button type="submit" id="add-site-submit" class="${BUTTON_PRIMARY}">Add site</button>
          </div>
        </form>

        <!--
          Deliberately not aria-live: this panel rewrites on every debounced
          keystroke, and announcing a Caddyfile block that often would bury the
          field the user is typing into. The one actionable thing in here — a
          rejection the submit would also make — is announced by #preview-error
          instead.
        -->
        <aside id="write-preview" class="${CARD} flex flex-col gap-3.5">
          <p class="${CARD_LABEL_BASE} text-stone-300 m-0">Will be written</p>

          <p id="preview-error" role="status" tabindex="-1" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

          <div id="preview-body" class="flex flex-col gap-3.5">
            <div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL}">${escapeHtml(paths.caddyfilePath)}</p>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL}">${escapeHtml(paths.tunnelConfigPath)}</p>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
            </div>
            <p class="${BODY}">Name the site and the exact block and route appear here, before anything is written.</p>
          </div>

          <hr class="border-0 border-t border-stone-700 m-0" />

          <div>
            <p class="${CARD_LABEL_BASE} text-stone-300 m-0 mb-3">In this order</p>
            <ol id="add-site-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
              ${ADD_STEPS.map(
                (step, index) =>
                  `<li class="flex gap-2" data-step-id="${step.id}"><span class="text-stone-400 shrink-0">${index + 1}.</span><span>${escapeHtml(step.label)}</span><span class="step-mark ml-auto shrink-0"></span></li>`,
              ).join("")}
            </ol>
            <p class="text-stone-400 text-[0.75rem] leading-snug m-0">If a step fails, the ones after it don't run.</p>
          </div>
        </aside>
      </div>
    </div>
    `,
    { shell },
  );
}

interface Hop {
  label: string;
  value: string;
  sub?: string;
  /** Tailwind text-colour class for the sub-line; defaults to muted stone. */
  subClass?: string;
  /**
   * Prefixes the sub-line with a decorative status dot, hidden from assistive
   * tech — the status word right after it is the real information and stays
   * in the accessible name.
   */
  subDot?: boolean;
  /**
   * Live state, on its own line directly under the value — the row the last
   * hop's status sub-line occupies, so statuses line up across the chain.
   * Same treatment as that sub-line (dot, canonical word, TONE_TEXT) so one
   * vocabulary has one look. Only hops something actually checks may set this.
   */
  status?: { text: string; tone: StatusTone };
}

function renderHop(hop: Hop): string {
  return `<div class="min-w-0">
            <p class="${HOP_LABEL}">${escapeHtml(hop.label)}</p>
            <p class="${HOP_VALUE}">${escapeHtml(hop.value)}</p>
            ${hop.status ? `<p class="font-mono text-[0.72rem] ${TONE_TEXT[hop.status.tone]} m-0" data-hop-status><span aria-hidden="true">●</span> ${escapeHtml(hop.status.text)}</p>` : ""}
            ${hop.sub ? `<p class="font-mono text-[0.72rem] ${hop.subClass ?? "text-stone-400"} m-0 break-all">${hop.subDot ? `<span aria-hidden="true">●</span> ` : ""}${escapeHtml(hop.sub)}</p>` : ""}
          </div>`;
}

interface HopFix {
  hop: "tunnel" | "caddy" | "your app";
  /** Already-escaped HTML. */
  body: string;
}

/**
 * What to check under the chain: one entry for every hop that reads a bad
 * status, in request order, so a red hop is never left without its fix and the
 * failure is stated once here rather than inside a setup step that appears and
 * disappears with state. The tunnel and Caddy entries read their unit's tone
 * (a unit missing from `unitStates` is `unknown`, which is neutral, and with
 * `unitStates` absent there are no unit entries at all). The app entry is the
 * first that applies: a failed deploy (the reason and the reconciler's journal),
 * a broken container (its logs), or a plain proxy nobody answered.
 *
 * "not-created" needs no special case: it is the neutral tone, so
 * `tone === "bad"` already excludes it, since a container that never existed
 * has no logs and Deploy is where you learn how to start one. Only an attached
 * resource has a container to read: the reconciler runs it as a compose
 * project named after the resource, so its logs are reached by project name
 * from anywhere, never from a /var/www directory.
 *
 * Which hops get an entry, and their commands, are siteDetailModel's
 * (`hopFixKeys`, `appFix`); this only writes the markup around them.
 */
function hopFixes(site: Site, opts: SiteDetailOptions): HopFix[] {
  const app = appFix(site, opts);
  return hopFixKeys(site, opts).map((hop): HopFix => {
    if (hop === "tunnel") {
      return {
        hop,
        body: `<p class="${STEP_TEXT} !mb-0">The sites tunnel ${unitPhrase(opts, "cloudflared-sites.service")}, so Cloudflare has nowhere to send this site's requests. Its last 50 log lines usually show why:</p>
          ${commandBlock("cmd-fix-tunnel", UNIT_FIX_COMMANDS.tunnel, "Copy journal command")}`,
      };
    }
    if (hop === "caddy") {
      return {
        hop,
        body: `<p class="${STEP_TEXT} !mb-0">Caddy ${unitPhrase(opts, "caddy.service")}. Every site on lychee goes through it, so all of them are down, not only this one. Its last 50 log lines usually show why:</p>
          ${commandBlock("cmd-fix-caddy", UNIT_FIX_COMMANDS.caddy, "Copy journal command")}`,
      };
    }
    // "your app" is only in the keys when appFix found one.
    if (app?.kind === "failed-first-deploy" && opts.resource) {
      // Forced: the status is the page's verdict, and the resource's own `result`
      // can have moved on (a newer run) while the pill still reads failed.
      return {
        hop,
        body: `${failureLine({ ...opts.resource, result: "failed" })}
          <p class="${STEP_TEXT} !mb-0">To recover, publish a fixed tag; From a repository below offers it to deploy.</p>`,
      };
    }
    if (app?.kind === "container" && opts.status) {
      return {
        hop,
        body: `<p class="${STEP_TEXT} !mb-0">The container ${statePhrase(describeStatus(opts.status).pill)}. Its last 100 log lines usually show why:</p>
          ${commandBlock("cmd-logs", app.command, "Copy logs command")}`,
      };
    }
    return {
      hop,
      body: `<p class="${STEP_TEXT} !mb-0">Nothing answered on ${mono(`localhost:${site.target}`)}. lychee-admin only routes requests to this port; whatever serves it is started outside the app. This shows what is listening there, and prints only its header row if nothing is:</p>
          ${commandBlock("cmd-fix-listen", app?.kind === "port" ? app.command : "", "Copy listen check")}`,
    };
  });
}

/**
 * The chain a request actually travels, which is the whole point of this app:
 * Cloudflare DNS → the sites tunnel → Caddy → whatever serves the site.
 *
 * Every value is derived from config or the parsed site — the human-readable
 * tunnel name ("lychee-sites") lives only in documentation, never in config,
 * so this shows the tunnel ID and the service name instead of asserting it.
 *
 * Hops 2-4 carry live state; hop 1 does not and must not. Hops 2 (the tunnel)
 * and 3 (Caddy) read their systemd unit's state, passed in by the route; hop 4
 * reports the site itself. Hop 1 is Cloudflare DNS, which this app never
 * touches (Tier 1 scope), so nothing here can check it and any indicator would
 * be invented. Its sub-line says "manual step", which stays true forever
 * rather than going stale the moment a DNS record is created.
 *
 * A unit missing from `unitStates` (a failed or empty read) renders `unknown`,
 * which is neutral: a status we failed to read is not evidence of an outage.
 * With `unitStates` absent altogether, no status renders at all.
 */
function renderRequestPath(site: Site, opts: SiteDetailOptions): string {
  const filesPath = computeFilesPath(site, opts.sitesRoot);
  const fixes = hopFixes(site, opts);
  const labels = opts.status ? describeStatus(opts.status) : null;
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
  const lastHop: Hop =
    site.type === "static"
      ? { label: "Your files", value: "file_server", ...(filesPath ? { sub: filesPath } : {}) }
      : {
          label: "Your app",
          value: `localhost:${site.target}`,
          ...(labels ? { sub: labels.hop, subClass: TONE_TEXT[labels.tone], subDot: true } : {}),
        };

  const unitStatus = (unit: string): Hop["status"] | undefined => {
    if (!opts.unitStates) return undefined;
    const labels = rowLabels(opts.unitStates[unit]?.status ?? "unknown");
    // The pill word, not the hop word: a unit has no container health, and the
    // hop wording ("running · health check starting", "can't check") describes
    // containers. The pill word is the canonical vocabulary itself.
    return { text: labels.pill, tone: labels.tone };
  };

  const hops: Hop[] = [
    { label: "Cloudflare DNS", value: site.hostname, sub: "manual step" },
    {
      label: "Tunnel",
      // Service name on top, its config directory beneath — the same shape as
      // the Caddy hop below. The tunnel's id used to sit here, but it is
      // identical on every site's page and, abbreviated, is the one value in
      // this chain you cannot act on: too short to look up, not a path to open.
      // It survives in full in the DNS command, which is where it is needed.
      value: "cloudflared-sites",
      sub: path.posix.dirname(opts.tunnelConfigPath),
      status: unitStatus("cloudflared-sites.service"),
    },
    {
      label: "Caddy",
      value: ":80",
      sub: path.posix.dirname(opts.caddyfilePath),
      status: unitStatus("caddy.service"),
    },
    lastHop,
  ];

  const arrow = `<div class="flex items-center justify-center text-stone-600 text-sm sm:flex-1 sm:min-w-[2rem]" aria-hidden="true"><span class="sm:hidden">&darr;</span><span class="hidden sm:inline">&rarr;</span></div>`;

  // Static sites carry their path in the last hop, so it is not repeated here.
  // A Next.js site has no directory unless one predates site resources, so
  // the row appears only when the route found one on disk.
  const image = opts.resource?.repo ? `${IMAGE_PREFIX}${opts.resource.repo}` : null;
  const rows = [
    ...(frameworkLabel ? [["framework", frameworkLabel]] : []),
    ...(site.healthcheckPath ? [["healthcheck", site.healthcheckPath]] : []),
    ...(site.type !== "static" && filesPath && opts.filesExist ? [["files", filesPath]] : []),
    ...(opts.resource ? [["resource", opts.resource.name]] : []),
    ...(image ? [["image", image]] : []),
  ];

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Request path</h3>
        <div class="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-0">
          ${hops.map((hop) => renderHop(hop)).join(arrow)}
        </div>
        ${
          fixes.length
            ? `<div class="h-px bg-stone-700 my-4"></div>
        <h4 class="${HOP_LABEL} !mb-3">What to check</h4>
        <div class="flex flex-col gap-4">
          ${fixes
            .map(
              (fix) => `<div class="grid grid-cols-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <p class="font-mono text-[0.8rem] text-red-300 m-0"><span aria-hidden="true">&#9679;</span> ${fix.hop}</p>
            <div class="flex flex-col gap-2 min-w-0">${fix.body}</div>
          </div>`,
            )
            .join("\n          ")}
        </div>`
            : ""
        }
        ${
          rows.length
            ? `<div class="h-px bg-stone-700 my-4"></div>
        ${rows
          .map(
            ([key, value]) =>
              `<p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">${escapeHtml(key)}</span><span class="text-stone-50 break-all">${
                // The resource is a row on the services board; the rest are plain facts.
                key === "resource"
                  ? `<a href="/services#service-${escapeHtml(value)}" class="text-stone-50 no-underline hover:underline ${FOCUS_RING}">${escapeHtml(value)}</a>`
                  : escapeHtml(value)
              }</span></p>`,
          )
          .join("\n        ")}`
            : ""
        }
      </section>`;
}

/**
 * A copyable command, optionally captioned with the directory it must run in.
 * Shared by the manual steps, the request path's failure hint, and Deploy's
 * by-hand alternative, so all three look and behave identically.
 */
function commandBlock(id: string, value: string, label: string, cwd?: string): string {
  return `<div class="relative">
              <pre id="${id}" class="${CODE_LINE}">${escapeHtml(value)}</pre>
              ${copyButton(id, label, COPY_IN_LINE)}
            </div>
            ${cwd ? `<p class="font-mono text-[0.72rem] text-stone-400 m-0 mt-1">in ${escapeHtml(cwd)}/</p>` : ""}`;
}

/** A sentence's runs: text escaped, inline machine facts as code. */
function renderInline(runs: Inline[]): string {
  return runs
    .map((run) => (typeof run === "string" ? escapeHtml(run) : `<code class="${INLINE_CODE}">${escapeHtml(run.code)}</code>`))
    .join("");
}

function renderStep(step: ManualStep, index: number): string {
  const block = (c: StepCommand): string => commandBlock(c.id, c.value, c.label ?? "Copy DNS command");
  return `<div class="flex gap-3">
          <span class="${STEP_NUMBER}">${index + 1}</span>
          <div class="flex-1 min-w-0">
            <p class="${STEP_TEXT}">${renderInline(step.text)}</p>
            ${step.command ? block(step.command) : ""}
            ${
              step.then
                ? `<p class="${BODY} mt-3 mb-2">${renderInline(step.then.note)}</p>
            ${block(step.then.command)}`
                : ""
            }
          </div>
        </div>`;
}

/**
 * The steps lychee-admin deliberately does not take. DNS is Tier 1 scope — the
 * app never touches Cloudflare DNS — and it never starts, stops, or rebuilds
 * a container. Both used to be one-shot flash banners that vanished on
 * reload; a missing DNS record is permanent state, so it needs a permanent
 * home. The steps themselves are siteDetailModel's `manualSteps`.
 */
function renderManualSteps(site: Site, opts: SiteDetailOptions): string {
  const steps = manualSteps(site, opts, computeFilesPath(site, opts.sitesRoot));

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Manual steps</h3>
        <p class="${BODY} mb-4">Nothing on this page does these for you.</p>
        <div class="flex flex-col gap-4">
          ${steps.map((step, index) => renderStep(step, index)).join("\n          ")}
        </div>
      </section>`;
}

/**
 * Destructive action, isolated and labelled. The consequence line states what
 * actually happens because the ordering matters: files are a separate second
 * request, so a failed config removal can never cascade into a deletion.
 * It says only what lychee-admin does: the declaration sentence appears when
 * the site is attached (the dialog's fifth step), the files sentence only
 * where the dialog offers its delete-files checkbox, and the DNS record is
 * never touched, so the last sentence always says so.
 */
function renderDangerZone(opts: { attached: boolean; deletableFiles: boolean }): string {
  const sentences = dangerSentences(opts);
  return `
      <section class="border border-red-900/60 bg-red-950/20 rounded-[10px] p-5 mt-4 flex items-center justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <h3 class="${CARD_LABEL_BASE} text-red-300 m-0 mb-1.5">Danger</h3>
          <p class="${BODY}">${sentences.join(" ")}</p>
        </div>
        <button type="button" class="${BUTTON_DANGER} shrink-0" data-open-dialog="confirm-remove-dialog">${icon("trash")}Remove site</button>
      </section>`;
}

function fileBlock(file: { name: string; content: string }, index: number): string {
  const id = `scaffold-file-${index}`;
  const body = file.content.trimEnd();
  const lines = body.split("\n").length;
  return `<div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL} flex justify-between gap-3"><span>${escapeHtml(file.name)}</span><span class="shrink-0">${lines} ${lines === 1 ? "line" : "lines"}</span></p>
              <div class="relative">
                <pre id="${id}" class="${CODE_FILE}">${escapeHtml(body)}</pre>
                ${copyButton(id, `Copy ${file.name}`, COPY_TOP)}
              </div>
            </div>`;
}

/**
 * `title` is markup: machine facts inside it are wrapped with mono() by the
 * caller. `done` and `folds` are siteDetailModel's `runbookSteps`; `extra` is
 * what a folded summary adds after `done`.
 */
function runbookStep(
  step: { n: number; done: boolean; folds: boolean },
  title: string,
  body: string,
  extra?: string,
): string {
  const { n, done } = step;
  if (step.folds) {
    // A finished step collapses to its summary line; the body stays in the page, one click away.
    const more = extra ? ` <span class="font-mono text-[0.72rem] font-normal text-stone-400">· ${escapeHtml(extra)}</span>` : "";
    return `<details class="group">
          <summary class="flex gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-md ${FOCUS_RING}">
            <span class="${STEP_DONE}">${icon("check")}<span class="sr-only">Step ${n}, done</span></span>
            <span class="block text-stone-50 font-semibold text-[0.9rem] leading-snug m-0 flex-1 min-w-0">${title} <span class="font-mono text-[0.72rem] font-normal text-stone-400">done</span>${more}</span>
            <span class="text-stone-500 shrink-0 mt-0.5 group-open:rotate-180 motion-safe:transition-transform">${icon("chevronDown")}</span>
          </summary>
          <div class="pl-[1.95rem] pt-2 flex flex-col gap-2">
            ${body}
          </div>
        </details>`;
  }
  return `<div class="flex gap-3">
          <span class="${done ? STEP_DONE : STEP_NUMBER}">${done ? `${icon("check")}<span class="sr-only">Step ${n}, done</span>` : n}</span>
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <p class="text-stone-50 font-semibold text-[0.9rem] leading-snug m-0">${title}${done ? ` <span class="font-mono text-[0.72rem] font-normal text-stone-400">done</span>` : ""}</p>
            ${body}
          </div>
        </div>`;
}

const mono = (value: string): string => `<span class="${MONO_FACT}">${escapeHtml(value)}</span>`;

/**
 * Prune: deletes a retired site declaration from lychee-resources. One markup
 * for the site page's detached warning and a retired row on the services
 * board; app.js binds every [data-prune] to POST /resources/:name/prune.
 *
 * Never danger, and no modal: it removes a file already `state: absent` for a
 * container the route checks is confirmed down, in a revertible commit. It is
 * Secondary by default, which is what the services board uses (a row there is
 * housekeeping, not the page's step). Under a site page's retired warning the
 * caller passes "primary": there Prune is the way forward, the page's one
 * Ember, and Attach steps back. Callers render it only for an absent
 * declaration; whether the container is down yet is the route's to answer,
 * through the banner.
 */
export function renderPruneControl(name: string, emphasis: "secondary" | "primary" = "secondary"): string {
  const safe = escapeHtml(name);
  const cls = emphasis === "primary" ? BUTTON_PRIMARY_COMPACT : BUTTON_SECONDARY_COMPACT;
  return `<p class="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-prune-line>
            <button type="button" class="${cls}" data-prune="${safe}">Prune old declaration</button>
            <span class="font-mono text-[0.72rem] text-stone-400 break-all">deletes ${safe}.yml from lychee-resources&nbsp;<span class="whitespace-nowrap">· once its container is confirmed down</span></span>
          </p>`;
}

/**
 * The attach control: a repository name composed with the fixed registry
 * prefix, in the same shape as add-site's hostname field (the affix is part of
 * the control, read out through aria-describedby, and the focus ring encloses
 * both pieces). The prefix is fixed because the reconciler accepts no other
 * registry path; the only thing to type is the repository's name.
 *
 * A retired declaration does not disable the control. The page's clone is
 * refreshed on load but may still be stale (the refresh is bounded), so the
 * page warns and the writer decides: it pulls first, and refuses with the
 * same prune reason if the retired file is still there. The warning carries
 * the way out, the Prune control, after the sentence that explains it. While
 * retired, Prune is the page's Primary and Attach steps back to Secondary,
 * still enabled, so the one Ember sits on the step that is actually next.
 */
function attachForm(site: Site, resourceName: string, detached: boolean): string {
  const warning = detached
    ? `<p id="attach-warning" class="${BODY} text-stone-300">${mono(`${resourceName}.yml`)} is retired (${mono("state: absent")}) and was still in lychee-resources when this page loaded. Attaching is refused while it is there. Prune it to re-attach; pressing Attach checks again.</p>
              ${renderPruneControl(resourceName, "primary")}`
    : "";
  return `<form class="flex flex-col gap-1.5" data-attach="${escapeHtml(site.hostname)}" novalidate>
              <label for="attach-repo" class="text-[0.85rem] text-stone-400">Repository in LycheeHome</label>
              <div class="flex flex-wrap items-center gap-2.5">
                ${repoField("attach", "", detached ? "attach-warning" : "")}
                <button type="submit" class="${detached ? BUTTON_SECONDARY : BUTTON_PRIMARY}"${detached ? ` aria-describedby="attach-warning"` : ""}>Attach repository</button>
              </div>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0 break-all">writes ${escapeHtml(resourceName)}.yml to lychee-resources · no tag until the first deploy</p>
              ${warning}
              <p id="attach-error" role="alert" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>
            </form>`;
}

/**
 * The affixed repository field: the fixed registry prefix joined to the input,
 * with the focus ring on the wrapper so it encloses both. Shared by Attach and
 * Change repository, so the two can never present the registry differently.
 * Ids are `<id>-row`, `<id>-prefix`, `<id>-repo`.
 */
function repoField(id: string, value: string, extraDescribedBy: string): string {
  return `<span id="${id}-row" class="flex items-stretch min-w-0 flex-1 basis-[18rem] rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2">
                  <span id="${id}-prefix" class="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-r-0 border-stone-700 rounded-l-md px-2.5 flex items-center shrink-0">${IMAGE_PREFIX}</span>
                  <input type="text" id="${id}-repo" name="repo" required autocomplete="off" autocapitalize="off" spellcheck="false"${value ? ` value="${escapeHtml(value)}"` : ""}
                         aria-describedby="${id}-prefix${extraDescribedBy ? ` ${extraDescribedBy}` : ""}"
                         class="${INPUT} rounded-l-none flex-1 min-w-0 focus:outline-none! disabled:text-stone-500 disabled:cursor-not-allowed" placeholder="repo-name" />
                </span>`;
}

/**
 * Step three's body once the reconciler has found nothing. A typo in the
 * repository and a tag not pushed yet look identical from here (an empty tag
 * list either way), so the copy names both causes and claims neither; the
 * control is the fix for one of them. Secondary, not primary: correcting a
 * request is not the step's forward action, and the page's one Ember button
 * stays where it was.
 */
function changeRepositoryForm(site: Site, resource: SiteResourceView & { repo: string }): string {
  const image = `${IMAGE_PREFIX}${resource.repo}`;
  return `<p class="${BODY}">No image found at ${mono(image)} yet. If ${mono("v0.1.0")} hasn't been pushed, push it (step 2). If the repository name is wrong, change it here; the reconciler looks again on its next run.</p>
            <form class="flex flex-col gap-1.5" data-change-repository="${escapeHtml(site.hostname)}" novalidate>
              <label for="change-repo-repo" class="text-[0.85rem] text-stone-400">Repository in LycheeHome</label>
              <div class="flex flex-wrap items-center gap-2.5">
                ${repoField("change-repo", resource.repo, "")}
                <button type="submit" class="${BUTTON_SECONDARY}">Change repository</button>
              </div>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0 break-all">rewrites the image line in ${escapeHtml(resource.name)}.yml · only while it has no tag</p>
              <p id="change-repo-error" role="alert" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>
            </form>`;
}

/** The gate string, in full, as the services board shows it, and only for a blocked or failed run (`troubleGate`). */
function gateLine(resource: SiteResourceView): string {
  const gate = troubleGate(resource);
  return gate ? `<p class="${SERVICE_DETAIL} text-stone-300" data-gate>${escapeHtml(gate)}</p>` : "";
}

/**
 * A deploy the reconciler attempted and could not complete: which tag, the
 * step that failed as the reconciler recorded it, and where the whole run is
 * logged. Prose stays Smoke; the Scorch belongs to the status pill, and the
 * step is a machine fact, so it is mono like the gate line. Empty unless
 * `result` is failed, so `blocked` keeps showing only its gate.
 *
 * "Retries this tag on every run" is only true when a target tag exists. A
 * failed row with none (lychee-admin's own row, a commit retried at most three
 * times) says only that the log has the latest attempt.
 *
 * One markup for a site's repository card and a services board row, which is
 * why it takes only the three facts both carry. The board passes a per-row
 * `commandId`, since several failed rows can share one page and the copy
 * button finds its command by id.
 */
function failureLine(resource: FailureFacts, extraClass = "", commandId = "cmd-reconcile-log"): string {
  if (resource.result !== "failed") return "";
  const what = resource.target
    ? `Deploying ${mono(resource.target)} failed${resource.failedStep ? " at this step:" : "."}`
    : `The last deploy failed${resource.failedStep ? " at this step:" : "."}`;
  const step = resource.failedStep
    ? `<p class="${SERVICE_DETAIL} text-stone-300" data-failed-step>${escapeHtml(resource.failedStep)}</p>`
    : "";
  const retry = resource.target
    ? "The reconciler retries this tag on every run; its log for the last hour shows each attempt:"
    : "The reconciler's log for the last hour has the latest attempt:";
  return `<div class="flex flex-col gap-2 ${extraClass}" data-deploy-failed>
            <p class="${BODY}">${what}</p>
            ${step}
            <p class="${BODY}">${retry}</p>
            ${commandBlock(commandId, 'journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"', "Copy journal command")}
          </div>`;
}

/**
 * What the Deploy step says while nothing runs yet. A tag already written and
 * not yet applied is stated, not offered again: the board's offer rule only
 * treats a moved pin as in flight once something is installed, and a second
 * request for the same tag would only race the first.
 */
function firstDeploy(opts: SiteDetailOptions): string {
  const resource = opts.resource;
  const step = deployStep(resource);
  if (!resource || step === "unattached") {
    return `<p class="${BODY}">Once the repository is attached and ${mono("v0.1.0")} is built, ${mono("0.1.0")} is offered here. Deploying writes the tag into the declaration; the reconciler starts the container on its next run.</p>`;
  }
  if (step === "unchecked") {
    return `<p class="${BODY}">Attached. The reconciler looks for the image on its next run, usually within two minutes, and offers the newest tag here; reload to see it.</p>`;
  }
  const offer = offerFor(opts);
  // Not "requested": the reconciler already tried, and will not simply pull it
  // next time. Explanation first, then a newer tag if one has been published:
  // offeredTag never re-offers the one that failed.
  if (step === "failed") {
    // The reason lives under the request path, where the red hop is.
    const pointer = resource.target
      ? `Deploying ${mono(resource.target)} failed; the reason is under the request path.`
      : "The last deploy failed; the reason is under the request path.";
    return `<p class="${BODY}">${pointer}</p>${gateLine(resource)}${offer ? renderOffer(offer) : ""}`;
  }
  if (step === "requested" || step === "requested-blocked") {
    const requested = `<p class="font-mono text-[0.8rem] text-stone-50 m-0">${escapeHtml(resource.target ?? "")} requested</p>`;
    // A blocked run will not simply pull it next time; the gate says why.
    if (step === "requested-blocked") return `${requested}${gateLine(resource)}`;
    return `${requested}
            <p class="${BODY}">The reconciler pulls it and starts the container on its next run.</p>${gateLine(resource)}`;
  }
  // Nothing is installed here, so a found tag that is not the pin is on offer.
  if (step === "offer" && offer) return `${gateLine(resource)}${renderOffer(offer)}`;
  // Step three already says no image was found and why that might be.
  if (step === "awaiting-image-change") {
    return `<p class="${BODY}">Nothing to deploy until the image exists; its newest tag is offered here once the reconciler finds it.</p>${gateLine(resource)}`;
  }
  const image = resource.repo ? `${IMAGE_PREFIX}${resource.repo}` : "the image";
  return `<p class="${BODY}">No tag found for ${mono(image)} yet. Push ${mono("v0.1.0")}; once its build finishes, the reconciler's next run offers it here.</p>${gateLine(resource)}`;
}

/**
 * A Next.js site is a container resource built from its own repository. Until
 * something runs, this card is the runbook to get there, in the order it
 * happens: the files to commit, the repository and its first tag (both in
 * GitHub), attaching (the one write this page makes), then the first deploy.
 * Once a version is installed the setup is history, so the card keeps only
 * the facts about the resource and the offer of a newer tag.
 *
 * The offer is the services board's own line (renderOfferLine) and its
 * button the board's own [data-deploy] control, posting to the same
 * /services/:name/deploy; once that tag is requested the line gives way to
 * the requested line (no button). It lives in this card rather than the page header,
 * which keeps the header's Visit free to be Primary only while the site is
 * serving. While a first deploy is the next step (awaiting image, failed with
 * a newer tag) the offer is the page's Primary; beside an installed version it
 * stays the board's quieter offer.
 *
 * The baked-in build and run commands close the card in every state. They are
 * what the Dockerfile runs inside the image, not commands to run yourself.
 */
function renderRepositoryCard(site: Site, opts: SiteDetailOptions, resourceName: string): string {
  const { resource, scaffold } = opts;
  const baked = scaffold
    ? `<div class="h-px bg-stone-700 my-4"></div>
        <p class="${BODY} mb-2">Baked into the Dockerfile. These run inside the image when it builds — not commands to run yourself.</p>
        <p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">build</span><span class="text-stone-50 break-all">${escapeHtml(scaffold.buildCommand)}</span></p>
        <p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">run</span><span class="text-stone-50 break-all">${escapeHtml(scaffold.runCommand)}</span></p>`
    : "";

  if (resource?.version) {
    const repository = resource.repo ? `LycheeHome/${resource.repo}` : null;
    const offer = offerFor(opts);
    const rows: [string, string][] = [
      ["running", resource.version],
      ...(resource.target && resource.target !== resource.version ? ([["requested", resource.target]] as [string, string][]) : []),
      ...(repository ? ([["repository", repository]] as [string, string][]) : []),
    ];
    return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">From a repository</h3>
        <p class="${BODY} mb-3">Push a newer ${mono("vX.Y.Z")} tag to ${repository ? mono(repository) : "the site's repository"}; it is offered here once the reconciler finds it.</p>
        ${rows.map(([key, value]) => `<p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">${escapeHtml(key)}</span><span class="text-stone-50 break-all">${escapeHtml(value)}</span></p>`).join("\n        ")}
        ${failureLine(resource, "mt-3")}
        ${gateLine(resource)}
        ${offer ? renderOffer(offer) : ""}
        ${baked}
      </section>`;
  }

  const [one, two, three, four] = runbookSteps(site, opts);
  const files =(opts.scaffoldFiles ?? []).map(fileBlock).join("\n            ");
  const scaffoldNames = (opts.scaffoldFiles ?? []).map((f) => f.name.split("/").pop()).join(", ");
  const attached = resource
    ? `<p class="font-mono text-[0.8rem] text-stone-50 m-0 break-all">${escapeHtml(resource.repo ? `${IMAGE_PREFIX}${resource.repo}` : resource.name)} <span class="text-stone-400">· ${escapeHtml(resource.name)}.yml</span></p>${
        canChangeRepository(resource) ? `\n            ${changeRepositoryForm(site, resource)}` : ""
      }`
    : attachForm(site, resourceName, opts.detached === true);

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">From a repository</h3>
        <p class="${BODY} mb-4">Steps 1 and 2 happen in GitHub; 3 and 4 happen here. Attaching before the first tag is pushed is fine: nothing is offered to deploy until the image exists.</p>
        <div class="flex flex-col gap-5">
          ${runbookStep(one, "Commit these three files beside your app", `<p class="${BODY}">At the repository's root, next to ${mono("package.json")}.</p>
            ${files}`, scaffoldNames)}
          ${runbookStep(two, `Create the repository in ${mono("LycheeHome")}, then push tag ${mono("v0.1.0")}`, `<p class="${BODY}">It has to live in the ${mono("LycheeHome")} org: the image is published as ${mono(`${IMAGE_PREFIX}<repo>`)}, the only registry path the reconciler accepts. The tag has GitHub's own runners build and push ${mono(`${IMAGE_PREFIX}<repo>:0.1.0`)}. Nothing runs on lychee yet.</p>
            ${commandBlock("cmd-tag", "git tag v0.1.0 && git push origin v0.1.0", "Copy tag command")}`)}
          ${runbookStep(three, "Attach the repository", attached)}
          ${runbookStep(four, "Deploy", firstDeploy(opts))}
        </div>
        ${baked}
      </section>`;
}

/**
 * The breadcrumb is plain location text now: site-to-site movement is the
 * rail's, which lists every site on every page.
 */
function renderDetailHeader(site: Site, opts: SiteDetailOptions): string {
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, opts.domain);
  const labels = opts.status ? describeStatus(opts.status) : null;
  return `
      <nav class="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5" aria-hidden="true">/</span>
        <span class="text-stone-50">${escapeHtml(site.hostname)}</span>
      </nav>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h2 id="site-hostname" class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0 break-all">${escapeHtml(lead)}${dimmed ? `<span class="text-stone-500">${escapeHtml(dimmed)}</span>` : ""}</h2>
            ${copyButton("site-hostname", "Copy hostname", "shrink-0")}
          </div>
          ${labels ? `<div class="flex items-center gap-2 mt-3 flex-wrap">
            <span class="${TONE_PILL[labels.tone]}" data-state-pill><span aria-hidden="true">&#9679;</span> ${escapeHtml(labels.pill)}</span>
          </div>` : ""}
        </div>
        <a href="https://${escapeHtml(site.hostname)}" target="_blank" rel="noopener noreferrer" class="${visitIsForward(opts.status) ? BUTTON_PRIMARY : BUTTON_SECONDARY} no-underline shrink-0">Visit ${icon("externalLink")}</a>
      </div>`;
}

export function renderSiteDetail(site: Site, opts: SiteDetailOptions, shell: ShellData): string {
  const resourceName = site.framework ? resourceNameFor(site.hostname, opts.domain) : null;
  const filesPath = computeFilesPath(site, opts.sitesRoot);

  // Retiring the declaration is a fifth step only when there is one to retire.
  const attachedName = resourceName && opts.resource ? resourceName : null;

  // Offered only for a directory that is actually there: a Next.js site added
  // after scaffolds stopped being written to the host has none to delete.
  const deleteFilesSection = filesPath && opts.filesExist
    ? `
      <div class="flex flex-col gap-2 mb-5">
        <label class="flex flex-row items-center text-[0.8rem] text-stone-400 gap-1.5">
          <input type="checkbox" id="confirm-remove-delete-files" class="accent-rose-400 ${FOCUS_RING}" />
          Also delete files at <span class="font-mono">${escapeHtml(filesPath)}</span>
        </label>
        ${
          site.framework
            ? `<p class="text-[0.75rem] text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2 leading-snug m-0">
          If a Docker container is running from this directory, stop it first with <code class="font-mono">docker compose down</code> — deleting the files won't stop it.
        </p>`
            : ""
        }
      </div>`
    : "";

  const manualSteps = renderManualSteps(site, opts);
  const repositoryCard = resourceName && opts.scaffold ? renderRepositoryCard(site, opts, resourceName) : "";
  // DNS is live setup until a site is attached; after that the repository
  // card is the work in hand (siteDetailModel's cardOrder). The empty card
  // keeps its place in the markup either way, as it always has.
  const repositoryFirst = cardOrder(opts)[1] === "repository";

  return layout(
    site.hostname,
    withRequestedTemplate(`
    <div class="${DETAIL_WIDTH} flex flex-col gap-5">
      ${renderDetailHeader(site, opts)}

      ${renderRequestPath(site, opts)}
      ${repositoryFirst ? `${repositoryCard}
      ${manualSteps}` : `${manualSteps}
      ${repositoryCard}`}

      ${renderDangerZone({ attached: attachedName !== null, deletableFiles: Boolean(filesPath && opts.filesExist) })}
    </div>

    <dialog id="confirm-remove-dialog"${attachedName ? ` data-attached="true"` : ""} aria-labelledby="confirm-remove-title" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 id="confirm-remove-title" class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
      <p class="m-0 mb-3 leading-relaxed">Remove <strong>${escapeHtml(site.hostname)}</strong>? In this order:</p>
      <ol id="confirm-remove-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">${removeSteps(opts)
        .map(
          (step, index) => `
        <li class="flex gap-2" data-step-id="${step.id}"><span class="text-stone-400 shrink-0">${index + 1}.</span><span>${escapeHtml(step.label)}</span><span class="step-mark ml-auto shrink-0"></span></li>`,
        )
        .join("")}
      </ol>
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 ${attachedName ? "mb-2" : "mb-4"}">If a step fails, the ones after it don't run.</p>${
        attachedName
          ? `
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">Step 5 is what stops the container: it writes <span class="font-mono text-stone-50">state: absent</span> to <span class="font-mono text-stone-50">${escapeHtml(attachedName)}.yml</span> in lychee-resources, and the reconciler takes the container down on its next run, usually within two minutes.</p>`
          : ""
      }
      <div id="confirm-remove-outcome" class="hidden font-mono text-[0.72rem] text-stone-400 leading-snug m-0 mb-4 flex items-start gap-2" role="status" aria-live="polite"><span id="confirm-remove-progress" class="hidden shrink-0 mt-[0.4em] h-1.5 w-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse" aria-hidden="true"></span><span id="confirm-remove-outcome-text" class="whitespace-pre-wrap"></span></div>
      ${deleteFilesSection}
      <div class="flex items-center justify-end gap-2.5">
        <button type="button" autofocus class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
        <button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove ${escapeHtml(site.hostname)}</button>
      </div>
    </dialog>
    `),
    {
      shell,
      banner: opts.created ? { message: addedNotice(site) } : undefined,
    },
  );
}

export function renderSiteNotFound(hostname: string, shell: ShellData): string {
  return layout(
    "Site not found",
    `
    <div class="max-w-[640px] mx-auto w-full flex flex-col gap-4">
      <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">Site not found</h2>
      <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">No managed site found for "${escapeHtml(hostname)}".</p>
      <p class="m-0"><a href="/" class="${FOCUS_RING} text-rose-400 no-underline font-mono text-[0.85rem] hover:underline">&larr; Back to sites</a></p>
    </div>
    `,
    { shell },
  );
}

// offeredTag lives in boardFacts.ts, node-free, so the React board shares it;
// re-exported because the site page's callers and tests import it from here.
export { offeredTag };

/**
 * The offer and its Deploy control. One markup for the board and the site
 * page: app.js binds every [data-deploy] to POST /services/:name/deploy, and
 * that route reads the tag from the inventory, never from the button.
 */
function renderOfferLine(name: string, tag: string, emphasis: "offer" | "primary" = "offer"): string {
  const cls = emphasis === "primary" ? BUTTON_PRIMARY_COMPACT : BUTTON_OFFER;
  return `<p class="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-offer>
            <span class="font-mono text-[0.8rem] text-rose-300">${escapeHtml(tag)} available</span>
            <button type="button" class="${cls}" data-deploy="${escapeHtml(name)}" data-deploy-tag="${escapeHtml(tag)}">Deploy ${escapeHtml(tag)}</button>
          </p>`;
}

/**
 * What stands where an offer stood once its tag has been written into the
 * declaration and the reconciler has not applied it yet. It has no button: a
 * second request for the same tag would only race the first. Focusable
 * (tabindex -1) so the client can move focus to it when it swaps it in for
 * the offer after a Deploy.
 */
export function renderRequestedLine(tag: string): string {
  return `<p class="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-requested role="status" tabindex="-1">
            <span class="font-mono text-[0.8rem] text-stone-50"><span data-requested-tag>${escapeHtml(tag)}</span> requested</span> <span class="text-stone-400">· applies on the next run</span>
          </p>`;
}

/**
 * The offer, or the requested line in its place when the declaration already
 * holds that very tag (siteDetailModel's `offerFor`). A pending tag that is
 * not the offered one leaves the offer alone: it is a different request.
 */
function renderOffer(offer: NonNullable<ReturnType<typeof offerFor>>): string {
  return offer.requested ? renderRequestedLine(offer.tag) : renderOfferLine(offer.name, offer.tag, offer.emphasis);
}

/**
 * Appends the inert template app.js clones to swap an offer for the requested
 * line after a Deploy, on pages whose body renders an offer and no others.
 * The tag is a placeholder the client overwrites.
 */
function withRequestedTemplate(body: string): string {
  return body.includes("data-offer") ? `${body}\n    <template data-requested-template>${renderRequestedLine("TAG")}</template>` : body;
}
