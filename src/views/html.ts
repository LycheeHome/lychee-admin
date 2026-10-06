import path from "node:path";
import { computeFilesPath, type Site } from "../lib/caddyfile";
import {
  describeStatus,
  splitHostnameForDisplay,
  type SiteStatus,
  type StatusTone,
} from "../lib/siteDisplay";
import type { UnitState } from "../lib/unitState";
import { ADD_STEPS } from "../lib/stepReport";
import { resourceNameFor } from "../lib/siteResource";
import type { BoardRow, ServiceBoard } from "../lib/serviceBoard";
import type { ServiceGroup } from "../lib/serviceInventory";
import { layout, type Nav } from "./shell";
import {
  escapeHtml,
  icon,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  BUTTON_DANGER,
  INPUT,
  FORM_LABEL,
  FOCUS_RING,
  DETAIL_WIDTH,
  FRAME_WIDTH,
  TYPE_PILL_STATIC,
  TYPE_PILL_PROXY,
  CARD,
  CARD_LABEL,
  CARD_LABEL_BASE,
  GROUP_LABEL,
  TONE_PILL,
  TONE_TEXT,
  BUTTON_OFFER,
  SERVICE_ROW,
  SERVICE_NAME,
  SERVICE_DETAIL,
  formatAge,
} from "./shared";

/**
 * The copy affordance app.js already understands: it reads the target
 * element's textContent, and falls back to selecting the text when
 * navigator.clipboard is unavailable — which it is here, since this app is
 * served over plain HTTP on the LAN.
 */
function copyButton(targetId: string, label: string, extraClass = ""): string {
  return `<button type="button" class="p-1 rounded-md bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-50 hover:bg-stone-700 cursor-pointer ${FOCUS_RING} ${extraClass}" data-copy-target="${targetId}" aria-label="${escapeHtml(label)}">
      <span data-copy-icon="idle">${icon("clipboard")}</span>
      <span data-copy-icon="copied" class="hidden">${icon("check")}</span>
    </button>`;
}

const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js",
};

/**
 * One site's row. Full-bleed hover (`-mx-3` against the row's own `px-3`) so
 * the highlight reaches the content column's edges rather than stopping at
 * the text, and a hairline under every row but the last.
 */
const SITE_ROW =
  `flex items-center justify-between gap-5 py-4 px-3 -mx-3 rounded-md no-underline ` +
  `border-b border-stone-700 last:border-b-0 ` +
  `motion-safe:transition-colors motion-safe:duration-150 hover:bg-stone-800 ${FOCUS_RING}`;

/** The size, casing and shape both pills share; only the colours differ. */
const TYPE_PILL_BASE =
  "inline-block shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border";

/**
 * The status column reserves its width whether or not the row has a status to
 * put in it. Without this, a static row's type pill slides right into the
 * position a proxy row's status pill occupies, and the two pill columns stop
 * lining up — which is the entire reason the list is rows rather than cards.
 * Sized to the longest word in the vocabulary, "not responding", plus its dot.
 *
 * Only from `sm` up, though. Alignment is worth having where there is width to
 * align across; below the floor the reservation just starves the hostname —
 * measured at 380px, the pills held 215px and the address wrapped to a third
 * line. Below `sm` the slot sizes to its content instead, and the row that
 * has no status gives its width back to the name of the site.
 */
const STATUS_SLOT = "flex justify-end sm:min-w-[9rem]";

/**
 * A comma only a screen reader hears. A row's accessible name is computed from
 * its contents, so without these the four facts run together as
 * "api.lyly.dev localhost:4000 proxy not responding". Separators rather than an
 * aria-label, deliberately: the name keeps deriving from the visible text, so
 * it cannot drift from what is on screen the way a hand-written label does.
 * `sr-only` is absolutely positioned, so it contributes nothing to the flex
 * layout it sits inside — no phantom gap.
 */
const SPOKEN_COMMA = `<span class="sr-only">, </span>`;

export function renderSiteList(
  sites: Site[],
  statuses: Record<string, SiteStatus>,
  // Supplied by the route from config.domain rather than read here, matching
  // renderAddSite and the detail page: a view that knows the domain by itself
  // is a view that can disagree with the one the app actually manages.
  domain: string,
  error?: string,
  // Every real caller of this page is GET /, where "sites" is genuinely
  // current. The one exception is the detail route's 500 fallback, which
  // renders this same body at /sites/<hostname> and must not claim "sites"
  // is where the URL points — see its call site in src/routes/sites.ts.
  nav: Nav = { page: "sites" },
  // A removal's DNS reminder is a page-load notice carrying an unfinished
  // manual action, so it belongs in flow with a close button — not in the
  // transient toast, which times out after four seconds.
  notice?: string,
): string {
  const rows = sites
    .map((site) => {
      const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
      const status = statuses[site.hostname];
      const labels = status ? describeStatus(status) : null;
      const { lead, dimmed } = splitHostnameForDisplay(site.hostname, domain);
      // The type is stated by the pill, so the sub-line carries only the
      // address: a path needs no "path:" label in front of it, and a port is
      // meaningless without the host it is on.
      const target =
        site.type === "static"
          ? site.target
          : `localhost:${site.target}${frameworkLabel ? ` · ${frameworkLabel}` : ""}`;

      return `
      <a href="/sites/${encodeURIComponent(site.hostname)}" class="${SITE_ROW}">
        <span class="flex flex-col gap-1.5 min-w-0">
          <span class="font-display text-base leading-relaxed text-stone-50 break-words" data-hostname>${escapeHtml(lead)}${
            dimmed ? `<span class="text-stone-400">${escapeHtml(dimmed)}</span>` : ""
          }</span>${SPOKEN_COMMA}
          <span class="font-mono text-stone-400 text-[0.8rem] leading-relaxed break-all">${escapeHtml(target)}</span>
        </span>
        <span class="flex items-center gap-3 shrink-0" data-row-side>${SPOKEN_COMMA}
          <span class="${TYPE_PILL_BASE} ${
            site.type === "static" ? TYPE_PILL_STATIC : TYPE_PILL_PROXY
          }">${site.type === "static" ? "static" : "proxy"}</span>
          <span class="${STATUS_SLOT}" data-status-slot>${
            labels
              ? `${SPOKEN_COMMA}<span class="${TONE_PILL[labels.tone]}"><span aria-hidden="true">&#9679;</span> ${escapeHtml(labels.pill)}</span>`
              : ""
          }</span>
        </span>
      </a>`;
    })
    .join("");

  // With no sites, the Add-site button in the section header is the only call
  // to action on the page — too quiet for the one thing there is to do. The
  // empty state states what a site is and carries its own button.
  const empty = `
      <div id="empty-state" class="flex flex-col items-center text-center gap-4 border border-stone-700 rounded-[10px] bg-stone-800 px-6 py-6">
        <h3 class="font-sans font-semibold text-base text-stone-50 m-0">No sites yet</h3>
        <p class="text-stone-400 text-[0.8rem] m-0 max-w-[46ch]">A site is one <code class="font-mono text-[0.72rem] text-stone-300 bg-stone-900 rounded-[4px] px-1">*.${escapeHtml(domain)}</code> subdomain wired through Caddy and the sites tunnel — either a folder of static files, or a reverse proxy to a local port.</p>
        <a id="empty-state-cta" href="/sites/new" class="${BUTTON_PRIMARY} no-underline">${icon("plus")}Add your first site</a>
      </div>`;

  return layout(
    "Sites",
    `
    ${error ? `<p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3 mb-5">${escapeHtml(error)}</p>` : ""}
    <section>
      <div class="flex items-center justify-between gap-4 mb-5">
        <h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">Sites</h2>
        ${
          // With no sites the empty state carries this same action, and Ember
          // spent twice on one destination makes neither the obvious one.
          sites.length === 0 ? "" : `<a href="/sites/new" class="${BUTTON_PRIMARY} no-underline">${icon("plus")}Add site</a>`
        }
      </div>
      ${sites.length === 0 ? empty : `<div class="flex flex-col">${rows}\n      </div>`}
    </section>
    `,
    { nav, banner: notice ? { message: notice } : undefined },
  );
}

export function renderAddSite(
  sites: Site[],
  domain: string,
  portOwners: Record<string, string>,
  // Passed in rather than read from config here, matching renderSiteList and
  // the detail page: a view that knows these paths by itself is a view that
  // can disagree with the files the app actually edits.
  paths: { caddyfilePath: string; tunnelConfigPath: string },
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
              <span id="type-static-description" class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lyly-admin creates for you with a placeholder page — no process to run yourself.</span>
            </label>

            <label class="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
              <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
                <input type="radio" name="type" value="reverse-proxy" aria-label="Reverse proxy" aria-describedby="type-proxy-description" class="accent-rose-400 ${FOCUS_RING}" />
                Reverse proxy
              </span>
              <span id="type-proxy-description" class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lyly-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
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
                <option value="nextjs">Next.js — generates a Dockerfile + docker-compose.yml</option>
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

          <p id="preview-error" role="status" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

          <div id="preview-body" class="flex flex-col gap-3.5">
            <div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL}">${escapeHtml(paths.caddyfilePath)}</p>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
            </div>
            <div class="flex flex-col gap-1.5">
              <p class="${PATH_LABEL}">${escapeHtml(paths.tunnelConfigPath)}</p>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0">—</p>
            </div>
            <p class="text-stone-400 text-[0.8rem] leading-snug m-0">Name the site and the exact block and route appear here, before anything is written.</p>
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
    { nav: { page: "new" } },
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

const HOP_LABEL =
  "font-mono text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-stone-400 m-0 mb-1.5";
/**
 * A path is a machine fact and is case-sensitive, so it takes the Micro-label
 * size and weight but never its uppercase — the one place in the system where
 * that transform is dropped.
 */
const PATH_LABEL = "font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-stone-400 m-0 break-all";
const HOP_VALUE = "font-mono text-[0.8rem] text-stone-50 m-0 mb-0.5 break-all";
const DETAIL_ROW = "font-mono text-[0.8rem] m-0 mb-1 flex gap-3 last:mb-0";
const DETAIL_KEY = "text-stone-400 min-w-[7.5rem] shrink-0";

function renderHop(hop: Hop): string {
  return `<div class="min-w-0">
            <p class="${HOP_LABEL}">${escapeHtml(hop.label)}</p>
            <p class="${HOP_VALUE}">${escapeHtml(hop.value)}</p>
            ${hop.status ? `<p class="font-mono text-[0.72rem] ${TONE_TEXT[hop.status.tone]} m-0" data-hop-status><span aria-hidden="true">●</span> ${escapeHtml(hop.status.text)}</p>` : ""}
            ${hop.sub ? `<p class="font-mono text-[0.72rem] ${hop.subClass ?? "text-stone-400"} m-0 break-all">${hop.subDot ? `<span aria-hidden="true">●</span> ` : ""}${escapeHtml(hop.sub)}</p>` : ""}
          </div>`;
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
  // Remediation belongs with the hop that reports the failure, not as a
  // numbered setup step that appears and disappears with container state.
  // "not-created" is excluded: a container that never existed has no logs, and
  // Deploy is where you learn how to start one.
  const containerStatus = opts.status?.kind === "container" ? opts.status : null;
  // `not-created` needs no special case here: it is the neutral tone, so
  // `tone === "bad"` already excludes it. A guard naming it would imply it is
  // still considered a failure. Pinned by "a never-deployed container is not
  // asked to read logs it has none of".
  //
  // Only an attached resource has a container to read: the reconciler runs it
  // as a compose project named after the resource, so its logs are reached by
  // project name from anywhere, never from a /var/www directory.
  const containerIsBroken =
    opts.resource !== undefined && containerStatus !== null && describeStatus(containerStatus).tone === "bad";
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
          containerIsBroken && opts.resource
            ? `<div class="mt-4">
          <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-1.5">Check the container's logs to see why:</p>
          ${commandBlock("cmd-logs", `docker compose -p ${opts.resource.name} logs`, "Copy logs command")}
        </div>`
            : ""
        }
        ${
          rows.length
            ? `<div class="h-px bg-stone-700 my-4"></div>
        ${rows
          .map(
            ([key, value]) =>
              `<p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">${escapeHtml(key)}</span><span class="text-stone-50 break-all">${escapeHtml(value)}</span></p>`,
          )
          .join("\n        ")}`
            : ""
        }
      </section>`;
}

const STEP_NUMBER =
  "font-mono text-[0.6875rem] text-rose-400 border border-rose-400/40 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
const STEP_TEXT = "text-stone-400 text-[0.8rem] leading-snug m-0 mb-1.5";
/**
 * Position for a copy button sitting in a single-line command box: vertically
 * centred, so it does not depend on the box's exact height.
 *
 * No font-size override here deliberately — the icon inherits 16px, matching
 * the multi-line workflow block's button, so all six copy buttons are one size.
 * That makes the button 26px, which CODE_LINE's py-2.5 is chosen to clear with
 * an even gap (6.6px above and below against 6px to the right), and pr-11 keeps
 * it off the command text. Those three values are coupled: changing the padding
 * on either the button or the box unbalances the gap.
 */
const COPY_IN_LINE = "absolute top-1/2 -translate-y-1/2 right-1.5";

const CODE_LINE =
  "font-mono text-[0.72rem] bg-stone-900 border border-stone-700 rounded-md pl-2.5 pr-11 py-2.5 text-stone-50 overflow-x-auto whitespace-nowrap m-0";

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

interface ManualStep {
  /** Plain sentence. Escaped at render time — never carries markup. */
  text: string;
  command?: { id: string; value: string };
}

function renderStep(step: ManualStep, index: number): string {
  return `<div class="flex gap-3">
          <span class="${STEP_NUMBER}">${index + 1}</span>
          <div class="flex-1 min-w-0">
            <p class="${STEP_TEXT}">${escapeHtml(step.text)}</p>
            ${step.command ? commandBlock(step.command.id, step.command.value, "Copy DNS command") : ""}
          </div>
        </div>`;
}

/**
 * The steps lyly-admin deliberately does not take. DNS is Tier 1 scope — the
 * app never touches Cloudflare DNS — and it never starts, stops, or rebuilds
 * a container. Both used to be one-shot flash banners that vanished on
 * reload; a missing DNS record is permanent state, so it needs a permanent
 * home.
 */
function renderManualSteps(site: Site, opts: SiteDetailOptions): string {
  const filesPath = computeFilesPath(site, opts.sitesRoot);

  const steps: ManualStep[] = [
    {
      text: opts.tunnelId
        ? "Create the DNS record, once per hostname. Until it exists this page still reports the site running, because lyly-admin only checks localhost."
        : "Create the DNS record, once per hostname — add a CNAME for this hostname to your tunnel from the Cloudflare dashboard. Until it exists this page still reports the site running, because lyly-admin only checks localhost.",
      ...(opts.tunnelId
        ? {
            command: {
              id: "cmd-dns",
              value: `cloudflared tunnel route dns ${opts.tunnelId} ${site.hostname}`,
            },
          }
        : {}),
    },
  ];

  // A static site is already serving — add-site created the directory and wrote
  // a placeholder index.html into it — so nothing prompts the user to notice
  // that what is live is a placeholder. This is the same category as the other
  // steps: something lyly-admin deliberately does not do for you.
  if (site.type === "static" && filesPath) {
    steps.push({
      text: `Put your site's files in ${filesPath}/. lyly-admin created a placeholder index.html there, which Caddy serves until you replace it.`,
    });
  }

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Manual steps</h3>
        <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-4">Nothing on this page does these for you.</p>
        <div class="flex flex-col gap-4">
          ${steps.map((step, index) => renderStep(step, index)).join("\n          ")}
        </div>
      </section>`;
}

/**
 * Destructive action, isolated and labelled. The consequence line states what
 * actually happens because the ordering matters: files are a separate second
 * request, so a failed config removal can never cascade into a deletion.
 */
function renderDangerZone(): string {
  return `
      <section class="border border-red-900/60 bg-red-950/20 rounded-[10px] p-5 mt-4 flex items-center justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <h3 class="${CARD_LABEL_BASE} text-red-300 m-0 mb-1.5">Danger</h3>
          <p class="text-stone-400 text-[0.8rem] leading-snug m-0">Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the sites tunnel. Your DNS record and files stay unless you ask otherwise.</p>
        </div>
        <button type="button" class="${BUTTON_DANGER} shrink-0" data-open-dialog="confirm-remove-dialog">${icon("trash")}Remove site</button>
      </section>`;
}

/** The only registry path the reconciler accepts for a site's image. */
const IMAGE_PREFIX = "ghcr.io/lycheehome/";

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
  /** Every managed site, for the breadcrumb's hostname switcher. */
  sites: Site[];
  /** Set when this page is the redirect target of a successful add (`?created=1`). */
  created?: boolean;
}

const BODY = "text-stone-400 text-[0.8rem] leading-snug m-0";
const STEP_DONE =
  "font-mono text-[0.6875rem] text-stone-300 border border-stone-600 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
/**
 * A whole file, at full height. It wraps rather than scrolling sideways: the
 * Show-It Rule allows horizontal overflow only on a one-line command, and the
 * release workflow's build line is wider than the reading column. The copy
 * button reads textContent, so wrapping changes nothing that is copied.
 */
const CODE_FILE =
  "font-mono text-[0.72rem] leading-[1.6] bg-stone-900 border border-stone-700 rounded-md pl-2.5 pr-11 py-2.5 text-stone-50 whitespace-pre-wrap [overflow-wrap:anywhere] m-0";
/** Multi-line blocks pin their copy button top-right, at the single-line inset. */
const COPY_TOP = "absolute top-1.5 right-1.5";

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

/** `title` is markup: machine facts inside it are wrapped with mono() by the caller. */
function runbookStep(n: number, done: boolean, title: string, body: string): string {
  return `<div class="flex gap-3">
          <span class="${done ? STEP_DONE : STEP_NUMBER}">${done ? `${icon("check")}<span class="sr-only">Step ${n}, done</span>` : n}</span>
          <div class="flex-1 min-w-0 flex flex-col gap-2">
            <p class="text-stone-50 font-semibold text-[0.9rem] leading-snug m-0">${title}${done ? ` <span class="font-mono text-[0.72rem] font-normal text-stone-400">done</span>` : ""}</p>
            ${body}
          </div>
        </div>`;
}

const mono = (value: string): string => `<span class="font-mono text-stone-50 break-all">${escapeHtml(value)}</span>`;

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
 * same prune reason if the retired file is still there.
 */
function attachForm(site: Site, resourceName: string, detached: boolean): string {
  const warning = detached
    ? `<p id="attach-warning" class="${BODY} text-stone-300">${mono(`${resourceName}.yml`)} is retired (${mono("state: absent")}) and was still in lychee-resources when this page loaded. Attaching is refused until it is pruned there; pressing Attach checks again.</p>`
    : "";
  return `<form class="flex flex-col gap-1.5" data-attach="${escapeHtml(site.hostname)}" novalidate>
              <label for="attach-repo" class="text-[0.85rem] text-stone-400">Repository in LycheeHome</label>
              <div class="flex flex-wrap items-center gap-2.5">
                <span id="attach-row" class="flex items-stretch min-w-0 flex-1 basis-[18rem] rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2">
                  <span id="attach-prefix" class="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-r-0 border-stone-700 rounded-l-md px-2.5 flex items-center shrink-0">${IMAGE_PREFIX}</span>
                  <input type="text" id="attach-repo" name="repo" required autocomplete="off" autocapitalize="off" spellcheck="false"
                         aria-describedby="attach-prefix${detached ? " attach-warning" : ""}"
                         class="${INPUT} rounded-l-none flex-1 min-w-0 focus:outline-none! disabled:text-stone-500 disabled:cursor-not-allowed" placeholder="repo-name" />
                </span>
                <button type="submit" class="${BUTTON_PRIMARY}"${detached ? ` aria-describedby="attach-warning"` : ""}>Attach repository</button>
              </div>
              <p class="font-mono text-[0.72rem] text-stone-400 m-0 break-all">writes ${escapeHtml(resourceName)}.yml to lychee-resources · no tag until the first deploy</p>
              ${warning}
              <p id="attach-error" role="alert" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>
            </form>`;
}

/** The gate string, in full, as the services board shows it. */
function gateLine(resource: SiteResourceView): string {
  return resource.gate ? `<p class="${SERVICE_DETAIL} text-stone-300" data-gate>${escapeHtml(resource.gate)}</p>` : "";
}

/**
 * A deploy the reconciler attempted and could not complete: which tag, the
 * step that failed as the reconciler recorded it, and where the whole run is
 * logged. Prose stays Smoke; the Scorch belongs to the status pill, and the
 * step is a machine fact, so it is mono like the gate line. Empty unless
 * `result` is failed, so `blocked` keeps showing only its gate.
 */
function failureLine(resource: SiteResourceView, extraClass = ""): string {
  if (resource.result !== "failed") return "";
  const what = resource.target
    ? `Deploying ${mono(resource.target)} failed${resource.failedStep ? " at this step:" : "."}`
    : `The last deploy failed${resource.failedStep ? " at this step:" : "."}`;
  const step = resource.failedStep
    ? `<p class="${SERVICE_DETAIL} text-stone-300" data-failed-step>${escapeHtml(resource.failedStep)}</p>`
    : "";
  return `<div class="flex flex-col gap-2 ${extraClass}" data-deploy-failed>
            <p class="${BODY}">${what}</p>
            ${step}
            <p class="${BODY}">The reconciler's journal has the whole run:</p>
            ${commandBlock("cmd-reconcile-log", "journalctl -u lyly-reconcile", "Copy journal command")}
          </div>`;
}

/**
 * What the Deploy step says while nothing runs yet. A tag already written and
 * not yet applied is stated, not offered again: the board's offer rule only
 * treats a moved pin as in flight once something is installed, and a second
 * request for the same tag would only race the first.
 */
function firstDeploy(resource: SiteResourceView | undefined): string {
  if (!resource) {
    return `<p class="${BODY}">Once the repository is attached and ${mono("v0.1.0")} is built, ${mono("0.1.0")} is offered here. Deploying writes the tag into the declaration; the reconciler starts the container on its next run.</p>`;
  }
  if (resource.result === undefined) {
    return `<p class="${BODY}">Attached. The reconciler looks for the image on its next run, within five minutes, and offers the newest tag here; reload to see it.</p>`;
  }
  // Not "requested": the reconciler already tried, and will not simply pull it
  // next time. Nothing is offered on a failed run (offeredTag), so this is all.
  if (resource.result === "failed") return `${failureLine(resource)}${gateLine(resource)}`;
  if (resource.target && resource.target === resource.available) {
    const requested = `<p class="font-mono text-[0.8rem] text-stone-50 m-0">${escapeHtml(resource.target)} requested</p>`;
    // A blocked run will not simply pull it next time; the gate says why.
    if (resource.result === "blocked") return `${requested}${gateLine(resource)}`;
    return `${requested}
            <p class="${BODY}">The reconciler pulls it and starts the container on its next run.</p>${gateLine(resource)}`;
  }
  const tag = offeredTag(resource);
  if (tag) return `${gateLine(resource)}${renderOfferLine(resource.name, tag)}`;
  // A tag exists but is not on offer (the last run failed): the gate is the whole story.
  if (resource.available) {
    return gateLine(resource) || `<p class="${BODY}">${mono(resource.available)} is built; nothing is offered until the last run's failure is resolved.</p>`;
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
 * /services/:name/deploy. It lives in this card rather than the page header,
 * which keeps Visit as the header's one ember action.
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
    const tag = offeredTag(resource);
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
        ${tag ? renderOfferLine(resource.name, tag) : ""}
        ${baked}
      </section>`;
  }

  const imageFound = Boolean(resource?.available);
  const files = (opts.scaffoldFiles ?? []).map(fileBlock).join("\n            ");
  const attached = resource
    ? `<p class="font-mono text-[0.8rem] text-stone-50 m-0 break-all">${escapeHtml(resource.repo ? `${IMAGE_PREFIX}${resource.repo}` : resource.name)} <span class="text-stone-400">· ${escapeHtml(resource.name)}.yml</span></p>`
    : attachForm(site, resourceName, opts.detached === true);

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">From a repository</h3>
        <p class="${BODY} mb-4">Steps 1 and 2 happen in GitHub; 3 and 4 happen here. Attaching before the first tag is pushed is fine: nothing is offered to deploy until the image exists.</p>
        <div class="flex flex-col gap-5">
          ${runbookStep(1, imageFound, "Commit these three files beside your app", `<p class="${BODY}">At the repository's root, next to ${mono("package.json")}.</p>
            ${files}`)}
          ${runbookStep(2, imageFound, `Create the repository in ${mono("LycheeHome")}, then push tag ${mono("v0.1.0")}`, `<p class="${BODY}">It has to live in the ${mono("LycheeHome")} org: the image is published as ${mono(`${IMAGE_PREFIX}<repo>`)}, the only registry path the reconciler accepts. The tag has GitHub's own runners build and push ${mono(`${IMAGE_PREFIX}<repo>:0.1.0`)}. Nothing runs on lychee yet.</p>
            ${commandBlock("cmd-tag", "git tag v0.1.0 && git push origin v0.1.0", "Copy tag command")}`)}
          ${runbookStep(3, resource !== undefined, "Attach the repository", attached)}
          ${runbookStep(4, false, "Deploy", firstDeploy(resource))}
        </div>
        ${baked}
      </section>`;
}

const SWITCHER_TRIGGER =
  `list-none cursor-pointer inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 ` +
  `text-stone-50 hover:bg-stone-800 [&::-webkit-details-marker]:hidden ${FOCUS_RING}`;

const SWITCHER_ROW =
  `flex items-center justify-between gap-3 px-2.5 py-1.5 no-underline font-mono text-[0.75rem] ` +
  `text-stone-50 border-b border-stone-700 last:border-b-0 hover:bg-stone-800 ` +
  `aria-[current=page]:bg-stone-700 aria-[current=page]:border-l-2 aria-[current=page]:border-l-rose-800 ${FOCUS_RING}`;

/** `static`, or the port a proxy site forwards to. Never status. */
function typeHint(site: Site): string {
  return site.type === "static" ? "static" : `:${site.target}`;
}

/**
 * Site-to-site movement, on the one line that already says which site you are
 * looking at. The rows are hostnames and a type hint — no status, because the
 * dropdown renders on every detail page and status pills there would cost one
 * check per site per page view. The list page answers that question instead.
 *
 * No `truncate` anywhere: this is the control whose whole job is picking a
 * hostname, and two sites called staging-dashboard-preview and
 * staging-dashboard-prod must not render identically. Splitting the shared
 * domain suffix off buys about nine characters per row for free.
 */
function renderHostnameSwitcher(site: Site, opts: SiteDetailOptions): string {
  const rows = opts.sites
    .map((entry) => {
      const { lead, dimmed } = splitHostnameForDisplay(entry.hostname, opts.domain);
      const current = entry.hostname === site.hostname;
      return `<li><a href="/sites/${encodeURIComponent(entry.hostname)}" class="${SWITCHER_ROW}"${
        current ? ` aria-current="page"` : ""
      }><span>${escapeHtml(lead)}${dimmed ? `<span class="text-stone-400">${escapeHtml(dimmed)}</span>` : ""}</span><span class="text-[0.72rem] text-stone-300 shrink-0">${escapeHtml(typeHint(entry))}</span></a></li>`;
    })
    .join("");

  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, opts.domain);

  return `<details id="hostname-switcher" class="relative inline-block">
        <summary class="${SWITCHER_TRIGGER}" aria-label="Switch site — currently ${escapeHtml(site.hostname)}">${escapeHtml(lead)}${
          dimmed ? `<span class="text-stone-400">${escapeHtml(dimmed)}</span>` : ""
        }${icon("chevronDown")}</summary>
        <ul class="absolute z-30 left-0 mt-1 min-w-[16rem] list-none m-0 p-0 bg-stone-900 border border-stone-700 rounded-[10px] shadow-lg shadow-black/40 overflow-hidden max-h-[70vh] overflow-y-auto">${rows}</ul>
      </details>`;
}

function renderDetailHeader(site: Site, opts: SiteDetailOptions): string {
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, opts.domain);
  const labels = opts.status ? describeStatus(opts.status) : null;
  return `
      <nav class="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5" aria-hidden="true">/</span>
        ${renderHostnameSwitcher(site, opts)}
      </nav>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h2 id="site-hostname" class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0 break-all">${escapeHtml(lead)}${dimmed ? `<span class="text-stone-500">${escapeHtml(dimmed)}</span>` : ""}</h2>
            ${copyButton("site-hostname", "Copy hostname", "shrink-0")}
          </div>
          <div class="flex items-center gap-2 mt-3 flex-wrap">
            <span class="inline-block font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
              site.type === "static" ? TYPE_PILL_STATIC : TYPE_PILL_PROXY
            }">${site.type === "static" ? "static" : "proxy"}</span>
            ${labels ? `<span class="${TONE_PILL[labels.tone]}" data-state-pill><span aria-hidden="true">&#9679;</span> ${escapeHtml(labels.pill)}</span>` : ""}
          </div>
        </div>
        <a href="https://${escapeHtml(site.hostname)}" target="_blank" rel="noopener noreferrer" class="${BUTTON_PRIMARY} no-underline shrink-0">Visit ${icon("externalLink")}</a>
      </div>`;
}

/**
 * The banner a site lands on after being created. Its job is to explain the
 * status pill beside it: two of the three types arrive not-yet-working, so
 * leading with what did succeed keeps the two from contradicting each other.
 */
function addedBanner(site: Site): string {
  if (site.type === "static") {
    return `Added ${site.hostname} — Caddy is serving the placeholder page it created. Manual steps has the DNS record and how to replace it.`;
  }
  if (site.framework) {
    return `Added ${site.hostname} — routing is live. It shows as not deployed until a repository is attached and its first image deployed; From a repository has the steps.`;
  }
  return `Added ${site.hostname} — routing is live, but nothing is listening on port ${site.target} yet, so it shows as not responding until you start your process.`;
}

export function renderSiteDetail(site: Site, opts: SiteDetailOptions): string {
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

  return layout(
    site.hostname,
    `
    <div class="${DETAIL_WIDTH} flex flex-col gap-5">
      ${renderDetailHeader(site, opts)}

      ${renderRequestPath(site, opts)}
      ${renderManualSteps(site, opts)}
      ${resourceName && opts.scaffold ? renderRepositoryCard(site, opts, resourceName) : ""}

      ${renderDangerZone()}
    </div>

    <dialog id="confirm-remove-dialog"${attachedName ? ` data-attached="true"` : ""} aria-labelledby="confirm-remove-title" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 id="confirm-remove-title" class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
      <p class="m-0 mb-3 leading-relaxed">Remove <strong>${escapeHtml(site.hostname)}</strong>? In this order:</p>
      <ol id="confirm-remove-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
        <li class="flex gap-2" data-step-id="caddyfile"><span class="text-stone-400 shrink-0">1.</span><span>Caddyfile block removed</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="tunnel"><span class="text-stone-400 shrink-0">2.</span><span>Tunnel route removed</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="caddy"><span class="text-stone-400 shrink-0">3.</span><span>Caddy validated and reloaded</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="cloudflared"><span class="text-stone-400 shrink-0">4.</span><span>cloudflared-sites restarted</span><span class="step-mark ml-auto shrink-0"></span></li>${
          attachedName
            ? `
        <li class="flex gap-2" data-step-id="declaration"><span class="text-stone-400 shrink-0">5.</span><span>${escapeHtml(attachedName)}.yml set to state: absent</span><span class="step-mark ml-auto shrink-0"></span></li>`
            : ""
        }
      </ol>
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 ${attachedName ? "mb-2" : "mb-4"}">If a step fails, the ones after it don't run.</p>${
        attachedName
          ? `
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">Step 5 is what stops the container: it writes <span class="font-mono text-stone-50">state: absent</span> to <span class="font-mono text-stone-50">${escapeHtml(attachedName)}.yml</span> in lychee-resources, and the reconciler takes the container down on its next run, within five minutes.</p>`
          : ""
      }
      <div id="confirm-remove-outcome" class="hidden font-mono text-[0.72rem] text-stone-400 leading-snug m-0 mb-4 flex items-start gap-2" role="status" aria-live="polite"><span id="confirm-remove-progress" class="hidden shrink-0 mt-[0.4em] h-1.5 w-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse" aria-hidden="true"></span><span id="confirm-remove-outcome-text" class="whitespace-pre-wrap"></span></div>
      ${deleteFilesSection}
      <div class="flex items-center justify-end gap-2.5">
        <button type="button" autofocus class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
        <button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove ${escapeHtml(site.hostname)}</button>
      </div>
    </dialog>
    `,
    {
      nav: {},
      banner: opts.created ? { message: addedBanner(site) } : undefined,
    },
  );
}

export function renderSiteNotFound(hostname: string): string {
  return layout(
    "Site not found",
    `
    <div class="max-w-[640px] mx-auto w-full flex flex-col gap-4">
      <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">Site not found</h2>
      <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">No managed site found for "${escapeHtml(hostname)}".</p>
      <p class="m-0"><a href="/" class="${FOCUS_RING} text-rose-400 no-underline font-mono text-[0.85rem] hover:underline">&larr; Back to sites</a></p>
    </div>
    `,
    { nav: {} },
  );
}

const GROUP_LABELS: Record<ServiceGroup, string> = {
  reconciler: "Reconciler",
  service: "Services",
  infrastructure: "Infrastructure",
};

/**
 * A board row's status through the same describeStatus() the site pages use,
 * so the services board cannot grow a second vocabulary. Rows are units and
 * containers alike, which is why this takes ServiceStatus rather than
 * UnitStatus: the two words a unit can never produce, `unhealthy` and
 * `paused`, are exactly the ones a container row needs. `starting` and
 * `unhealthy` are the pair that have to be mapped back onto a container's
 * state/health shape, since describeStatus() reads them from there.
 */
function rowLabels(status: BoardRow["status"]) {
  if (status === "starting") return describeStatus({ kind: "container", state: "running", health: "starting" });
  if (status === "unhealthy") return describeStatus({ kind: "container", state: "running", health: "unhealthy" });
  return describeStatus({ kind: "container", state: status });
}

type DeployFacts = Pick<BoardRow, "available" | "version" | "target" | "result">;

function isApplying(row: DeployFacts): boolean {
  const settled = row.result === "deployed" || row.result === "skipped";
  return settled && Boolean(row.version && row.target && row.target !== row.version);
}

/**
 * The tag a row offers, or null. An offer only when nothing is in flight or
 * broken: a second request on top of an unapplied one would race the first,
 * and a failed deploy needs its gate read before anything is pushed after it.
 * `blocked` still offers: the gate line above it says why, and the offer is
 * the way out — unless the tag on offer is already the pin, which a second
 * request would only race. Shared by the services board and a site's own page, so the two
 * can never disagree about whether a tag is on offer.
 */
function offeredTag(row: DeployFacts): string | null {
  return row.available &&
    row.available !== row.version &&
    row.available !== row.target &&
    !isApplying(row) &&
    row.result !== "failed"
    ? row.available
    : null;
}

/**
 * The offer and its Deploy control. One markup for the board and the site
 * page: app.js binds every [data-deploy] to POST /services/:name/deploy, and
 * that route reads the tag from the inventory, never from the button.
 */
function renderOfferLine(name: string, tag: string): string {
  return `<p class="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" data-offer>
            <span class="font-mono text-[0.8rem] text-rose-300">${escapeHtml(tag)} available</span>
            <button type="button" class="${BUTTON_OFFER}" data-deploy="${escapeHtml(name)}" data-deploy-tag="${escapeHtml(tag)}">Deploy ${escapeHtml(tag)}</button>
          </p>`;
}

function renderServiceRow(row: BoardRow, board: ServiceBoard, now: Date): string {
  // `target` is what the reconciler has been asked to run; `version` is what
  // it last confirmed running. "Applying" means the reconciler last ran
  // cleanly (`deployed` or `skipped`) and the pin has since moved, so the next
  // tick will install it. A moved pin on a `blocked` or `failed` row is NOT
  // applying: the retry cap, an unresolvable pin and a red CI gate all leave
  // target != version indefinitely while the old build keeps running, and
  // calling that "applying" would promise progress that is never coming.
  // An allowlist, not a denylist, because `result` can also be absent or
  // `unknown`, and those must not read as applying either. Neutral, and only
  // while the live state is not already red: "applying" must never hide a
  // container that is actually failing.
  const applying = isApplying(row);
  const live = rowLabels(row.status);
  const labels = applying && live.tone !== "bad" ? { ...live, pill: "applying", tone: "neutral" as const } : live;
  const offer = offeredTag(row);

  const facts: string[] = [];
  // One fact with an arrow, not two: version and target are a single change.
  if (applying) facts.push(`${row.version} \u2192 ${row.target}`);
  else if (row.version) facts.push(row.version);
  if (row.result) facts.push(row.result);
  if (row.failedAttempts) facts.push(`${row.failedAttempts} ${row.failedAttempts === 1 ? "attempt" : "attempts"}`);
  const changed = formatAge(row.since, now);
  if (changed) facts.push(`changed ${changed}`);

  // The reconciler's one timer carries the schedule, as the board does.
  if (row.kind === "unit" && row.unit === board.timerUnit) {
    // Only a future time is a "next run". A timer that has just fired or not
    // yet computed its next elapse is normal, and a past "next" would render
    // as a negative interval, so it says nothing.
    const upcoming = board.schedule.next && new Date(board.schedule.next).getTime() > now.getTime();
    const next = upcoming ? formatAge(board.schedule.next, now) : null;
    const last = formatAge(board.schedule.last, now);
    if (next) facts.push(`next run ${next}`);
    if (last) facts.push(`last run ${last}`);
  }

  return `
      <li class="${SERVICE_ROW}" data-service="${escapeHtml(row.name)}">
        <div class="pt-px"><span class="${TONE_PILL[labels.tone]}"><span aria-hidden="true">&#9679;</span> ${escapeHtml(labels.pill)}</span></div>
        <div class="flex flex-col gap-0.5 min-w-0">
          <p class="${SERVICE_NAME}">${escapeHtml(row.name)}</p>
          ${facts.length > 0 ? `<p class="${SERVICE_DETAIL}">${facts.map(escapeHtml).join(" · ")}</p>` : ""}
          ${
            // In full, on its own row: the retry-cap string carries the recovery
            // command, and a clamped string would hide the one thing to do.
            row.gate ? `<p class="${SERVICE_DETAIL} text-stone-300" data-gate>${escapeHtml(row.gate)}</p>` : ""
          }
          ${
            // Last, after the gate: a blocked service's gate string carries the
            // recovery instruction, so explanation comes first and the thing to
            // do about it second. Its own line so a row with nothing to offer
            // is exactly the row it was before this existed.
            offer ? renderOfferLine(row.name, offer) : ""
          }
        </div>
      </li>`;
}

/**
 * What else runs on the host. Read-only except for one control: a row with a
 * newer tag on offer carries a Deploy button. `now` is a parameter so ages are testable.
 */
export function renderServicesPage(board: ServiceBoard, now: Date = new Date()): string {
  const written = formatAge(board.generated, now);
  const freshness = board.inventoryAvailable
    ? written
      ? `Inventory written ${written}`
      : "Inventory write time unknown"
    : "";

  const groups = board.groups
    .map(
      (g) => `
    <section aria-labelledby="group-${g.group}">
      <h3 id="group-${g.group}" class="${GROUP_LABEL}">${GROUP_LABELS[g.group]}</h3>
      <ul class="list-none m-0 p-0 flex flex-col">${g.rows.map((r) => renderServiceRow(r, board, now)).join("")}
      </ul>
    </section>`,
    )
    .join("");

  const unavailable = `
    <p id="inventory-unavailable" class="m-0 max-w-[62ch] text-[0.9rem] leading-relaxed text-stone-300 border border-stone-700 rounded-md px-4 py-3">
      There are no services to show: the inventory could not be read, or it declares none this page recognises. Without it there is no list of what should be running and nothing to check live state against. It is published by the reconciler on each tick; if it has never run, or the file was removed, this page stays empty.
    </p>`;

  return layout(
    "Services",
    `
    <div class="${FRAME_WIDTH} flex flex-col gap-8">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">Services</h2>
        ${freshness ? `<p class="m-0 text-[0.8rem] text-stone-400" data-inventory-age>${escapeHtml(freshness)}</p>` : ""}
      </div>
      ${board.inventoryAvailable && board.groups.length > 0 ? groups : unavailable}
    </div>
    `,
    { nav: { page: "services" } },
  );
}
