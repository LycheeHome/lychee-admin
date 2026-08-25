import path from "node:path";
import { computeFilesPath, type Site } from "../lib/caddyfile";
import {
  describeStatus,
  splitHostnameForDisplay,
  type SiteStatus,
} from "../lib/siteDisplay";
import { ADD_STEPS } from "../lib/stepReport";
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
  TYPE_PILL_STATIC,
  TYPE_PILL_PROXY,
  CARD,
  CARD_LABEL,
  CARD_LABEL_BASE,
  TONE_PILL,
  TONE_TEXT,
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

export function renderSiteList(
  sites: Site[],
  statuses: Record<string, SiteStatus>,
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
  const cards = sites
    .map((site) => {
      const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
      const status = statuses[site.hostname];
      const labels = status ? describeStatus(status) : null;
      const statusPill = labels
        ? `<span class="${TONE_PILL[labels.tone]}"><span aria-hidden="true">&#9679;</span> ${escapeHtml(labels.pill)}</span>`
        : "";

      return `
      <a href="/sites/${encodeURIComponent(site.hostname)}" class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3.5 motion-safe:transition-colors motion-safe:duration-150 hover:border-rose-800/70 no-underline ${FOCUS_RING}">
        <div class="flex items-start justify-between gap-2">
          <p class="font-display text-base leading-relaxed text-stone-50 m-0 break-words">${escapeHtml(site.hostname)}</p>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="inline-block shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
              site.type === "static" ? TYPE_PILL_STATIC : TYPE_PILL_PROXY
            }">${site.type === "static" ? "static" : "proxy"}</span>
            ${statusPill}
          </div>
        </div>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words">${
          site.type === "static"
            ? `<span class="text-stone-400 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}`
            : `<span class="text-stone-400 uppercase text-[0.75rem] tracking-[0.03em]">localhost:</span>${escapeHtml(site.target)}${frameworkLabel ? ` · ${escapeHtml(frameworkLabel)}` : ""}`
        }</p>
      </a>`;
    })
    .join("");

  return layout(
    "Sites",
    `
    ${error ? `<p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3 max-w-[1080px] mx-auto mb-5">${escapeHtml(error)}</p>` : ""}
    <section>
      <div class="flex items-center justify-between gap-4 mb-5">
        <h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">Sites</h2>
        <a href="/sites/new" class="${BUTTON_PRIMARY} no-underline">${icon("plus")}Add site</a>
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        ${cards || `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`}
      </div>
    </section>
    `,
    { nav, banner: notice ? { message: notice } : undefined },
  );
}

export function renderAddSite(
  sites: Site[],
  domain: string,
  portOwners: Record<string, string>,
): string {
  return layout(
    "Add a site",
    `
    <div class="${DETAIL_WIDTH} flex flex-col gap-5">
      <nav class="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5">/</span>
        <span class="text-stone-50">new</span>
      </nav>

      <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">Add a site</h2>

      <form id="add-site-form" method="post" action="/sites" class="flex flex-col gap-5">
        <label class="${FORM_LABEL}">
          Hostname
          <span id="hostname-row" class="flex items-stretch rounded-md focus-within:outline focus-within:outline-2 focus-within:outline-rose-400 focus-within:outline-offset-2">
            <input type="text" id="hostname-field" name="hostname" required autocomplete="off"
                   aria-describedby="hostname-suffix"
                   class="${INPUT} rounded-r-none flex-1 min-w-0 focus:outline-none!" placeholder="blog" />
            <span id="hostname-suffix" class="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-l-0 border-stone-700 rounded-r-md px-2.5 flex items-center shrink-0">.${escapeHtml(domain)}</span>
          </span>
        </label>

        <fieldset class="border-0 p-0 m-0 flex flex-col gap-2.5">
          <legend class="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-0 mb-2">Type</legend>

          <label class="flex flex-col gap-1 rounded-md border border-stone-600 bg-stone-700/50 px-3 py-2.5 cursor-pointer transition-colors hover:bg-stone-700/80 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500">
            <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
              <input type="radio" name="type" value="static" checked class="accent-stone-300" />
              Static site
            </span>
            <span class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lyly-admin creates for you with a placeholder page — no process to run yourself.</span>
          </label>

          <label class="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
            <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
              <input type="radio" name="type" value="reverse-proxy" class="accent-rose-400" />
              Reverse proxy
            </span>
            <span class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lyly-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
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

        <div class="flex justify-end gap-2.5">
          <a href="/" class="${BUTTON_SECONDARY} no-underline">Cancel</a>
          <button type="submit" id="add-site-submit" class="${BUTTON_PRIMARY}">Add site</button>
        </div>

        <div class="mt-5">
          <p class="${CARD_LABEL}">On submit</p>
          <ol id="add-site-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
            ${ADD_STEPS.map(
              (step, index) =>
                `<li class="flex gap-2" data-step-id="${step.id}"><span class="text-stone-400 shrink-0">${index + 1}.</span><span>${escapeHtml(step.label)}</span><span class="step-mark ml-auto shrink-0"></span></li>`,
            ).join("")}
          </ol>
          <p class="text-stone-400 text-[0.75rem] leading-snug m-0">If a step fails, the ones after it don't run.</p>
        </div>
      </form>
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
}

const HOP_LABEL =
  "font-mono text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-stone-400 m-0 mb-1.5";
const HOP_VALUE = "font-mono text-[0.8rem] text-stone-50 m-0 mb-0.5 break-all";
const DETAIL_ROW = "font-mono text-[0.8rem] m-0 mb-1 flex gap-3 last:mb-0";
const DETAIL_KEY = "text-stone-400 min-w-[7.5rem] shrink-0";

function renderHop(hop: Hop): string {
  return `<div class="min-w-0">
            <p class="${HOP_LABEL}">${escapeHtml(hop.label)}</p>
            <p class="${HOP_VALUE}">${escapeHtml(hop.value)}</p>
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
 * Hops 1-3 carry no live state: nothing here verifies them. Hop 1's sub-line
 * says "manual step", which stays true forever rather than going stale the
 * moment a DNS record is created.
 */
function renderRequestPath(site: Site, opts: SiteDetailOptions): string {
  const filesPath = computeFilesPath(site, opts.sitesRoot);
  // Remediation belongs with the hop that reports the failure, not as a
  // numbered setup step that appears and disappears with container state.
  // "not-created" is excluded: a container that never existed has no logs, and
  // Deploy is where you learn how to start one.
  const containerStatus = opts.status?.kind === "container" ? opts.status : null;
  const containerIsBroken =
    containerStatus !== null &&
    describeStatus(containerStatus).tone === "bad" &&
    containerStatus.state !== "not-created";
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
    },
    { label: "Caddy", value: ":80", sub: path.posix.dirname(opts.caddyfilePath) },
    lastHop,
  ];

  const arrow = `<div class="flex items-center justify-center text-stone-600 text-sm sm:flex-1 sm:min-w-[2rem]" aria-hidden="true"><span class="sm:hidden">&darr;</span><span class="hidden sm:inline">&rarr;</span></div>`;

  // Static sites carry their path in the last hop, so it is not repeated here.
  const rows = [
    ...(frameworkLabel ? [["framework", frameworkLabel]] : []),
    ...(site.healthcheckPath ? [["healthcheck", site.healthcheckPath]] : []),
    ...(site.type !== "static" && filesPath ? [["files", filesPath]] : []),
  ];

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Request path</h3>
        <div class="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-0">
          ${hops.map((hop) => renderHop(hop)).join(arrow)}
        </div>
        ${
          containerIsBroken && filesPath
            ? `<div class="mt-4">
          <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-1.5">Check the container's logs to see why:</p>
          ${commandBlock("cmd-logs", "docker compose logs", "Copy logs command", filesPath)}
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

/**
 * Same 6px inset as COPY_IN_LINE, but pinned to the top: a multi-line block has
 * no single vertical centre worth aligning a button to. Kept as a named
 * constant beside it so the inset cannot drift between the two — it did, and
 * the 2px difference was visible.
 */
const COPY_IN_BLOCK = "absolute top-1.5 right-1.5";

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

export interface SiteDetailOptions {
  sitesRoot: string;
  domain: string;
  tunnelId: string;
  tunnelConfigPath: string;
  caddyfilePath: string;
  status?: SiteStatus;
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string };
  /** Every managed site, for the breadcrumb's hostname switcher. */
  sites: Site[];
  /** Set when this page is the redirect target of a successful add (`?created=1`). */
  created?: boolean;
}

/**
 * The workflow first, because it is the only thing here you act on, then what
 * the generated image does, as data.
 *
 * buildCommand and runCommand are NOT instructions: they are what the Dockerfile
 * bakes in (`RUN npm run build`, `CMD ["npm","start"]`), triggered inside the
 * image by the workflow's `docker compose up --build`. They were previously
 * rendered as copyable command boxes identical to the actionable ones in Manual
 * steps, which read as "run these first, then paste the workflow" — the reverse
 * of the truth, and running them on the host would be wrong. They are detail
 * rows now, the same shape the request-path card uses for data.
 *
 * They are surfaced at all because they tell you what the image assumes: an app
 * without an `npm run build` script, or one started another way, will not work
 * with this scaffold. Making them overridable is a later feature; the page
 * deliberately does not promise that yet.
 */
function renderDeploy(scaffold: NonNullable<SiteDetailOptions["scaffold"]>, filesPath: string | null): string {
  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Deploy</h3>
        <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-3">Paste this into <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">.github/workflows/deploy.yml</code> in your app's repo. It syncs your source across and rebuilds the container on every push to <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">main</code>.</p>
        <div class="relative">
          <pre id="github-workflow-yaml" class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 pr-11 text-[0.72rem] text-stone-50 overflow-x-auto whitespace-pre m-0">${escapeHtml(scaffold.deployWorkflow)}</pre>
          ${copyButton("github-workflow-yaml", "Copy workflow", COPY_IN_BLOCK)}
        </div>
        ${
          filesPath
            ? `<p class="text-stone-400 text-[0.8rem] leading-snug m-0 mt-3 mb-1.5">Not using GitHub Actions? Copy your source into the directory yourself, then run:</p>
        ${commandBlock("cmd-compose", "docker compose up -d --build", "Copy docker compose command", filesPath)}`
            : ""
        }
        <div class="h-px bg-stone-700 my-4"></div>
        <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-2">Baked into the generated Dockerfile. These run inside the image when it builds — not commands to run yourself.</p>
        <p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">build</span><span class="text-stone-50 break-all">${escapeHtml(scaffold.buildCommand)}</span></p>
        <p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">run</span><span class="text-stone-50 break-all">${escapeHtml(scaffold.runCommand)}</span></p>
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
        <span class="text-stone-600 mx-1.5">/</span>
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
function addedBanner(site: Site, sitesRoot: string): string {
  if (site.type === "static") {
    return `Added ${site.hostname} — Caddy is serving the placeholder page it created. Manual steps has the DNS record and how to replace it.`;
  }
  if (site.framework) {
    return `Added ${site.hostname} — routing is live and the scaffold is at ${computeFilesPath(site, sitesRoot)}. It shows as not deployed until you add your source and deploy.`;
  }
  return `Added ${site.hostname} — routing is live, but nothing is listening on port ${site.target} yet, so it shows as not responding until you start your process.`;
}

export function renderSiteDetail(site: Site, opts: SiteDetailOptions): string {
  const { scaffold } = opts;
  const filesPath = computeFilesPath(site, opts.sitesRoot);

  const deleteFilesSection = filesPath
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
      ${scaffold ? renderDeploy(scaffold, computeFilesPath(site, opts.sitesRoot)) : ""}

      ${renderDangerZone()}
    </div>

    <dialog id="confirm-remove-dialog" aria-labelledby="confirm-remove-title" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 id="confirm-remove-title" class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
      <p class="m-0 mb-3 leading-relaxed">Remove <strong>${escapeHtml(site.hostname)}</strong>? In this order:</p>
      <ol id="confirm-remove-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
        <li class="flex gap-2" data-step-id="caddyfile"><span class="text-stone-400 shrink-0">1.</span><span>Caddyfile block removed</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="tunnel"><span class="text-stone-400 shrink-0">2.</span><span>Tunnel route removed</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="caddy"><span class="text-stone-400 shrink-0">3.</span><span>Caddy validated and reloaded</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="cloudflared"><span class="text-stone-400 shrink-0">4.</span><span>cloudflared-sites restarted</span><span class="step-mark ml-auto shrink-0"></span></li>
      </ol>
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">If a step fails, the ones after it don't run.</p>
      <div id="confirm-remove-outcome" class="hidden font-mono text-[0.72rem] text-stone-400 leading-snug m-0 mb-4 flex items-start gap-2" role="status" aria-live="polite"><span id="confirm-remove-progress" class="hidden shrink-0 mt-[0.4em] h-1.5 w-1.5 rounded-full bg-stone-400 motion-safe:animate-pulse" aria-hidden="true"></span><span id="confirm-remove-outcome-text" class="whitespace-pre-wrap"></span></div>
      ${deleteFilesSection}
      <div class="flex justify-end gap-2.5">
        <button type="button" autofocus class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
        <button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove ${escapeHtml(site.hostname)}</button>
      </div>
    </dialog>
    `,
    {
      nav: {},
      banner: opts.created ? { message: addedBanner(site, opts.sitesRoot) } : undefined,
    },
  );
}

export function renderSiteNotFound(hostname: string): string {
  return layout(
    "Site not found",
    `
    <div class="max-w-[640px] mx-auto flex flex-col gap-4">
      <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">Site not found</h2>
      <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">No managed site found for "${escapeHtml(hostname)}".</p>
      <p class="m-0"><a href="/" class="text-rose-400 no-underline font-mono text-[0.85rem] hover:underline">&larr; Back to sites</a></p>
    </div>
    `,
    { nav: {} },
  );
}
