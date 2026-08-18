import path from "node:path";
import { computeFilesPath, type Site } from "../lib/caddyfile";
import {
  describeStatus,
  splitHostnameForDisplay,
  type SiteStatus,
  type StatusTone,
} from "../lib/siteDisplay";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BUTTON_PRIMARY =
  "font-sans font-semibold text-sm bg-rose-400 text-stone-900 border-none rounded-md px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
const BUTTON_SECONDARY =
  "font-sans font-semibold text-sm bg-transparent text-stone-400 border border-stone-600 rounded-md px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-stone-700 hover:text-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
const BUTTON_DANGER =
  "font-sans font-semibold text-[0.8rem] bg-transparent text-red-300 border border-red-800 rounded-md px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-red-900 hover:text-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
const INPUT =
  "font-mono bg-stone-900 border border-stone-700 rounded-md text-stone-50 px-2.5 py-2 text-sm placeholder:text-stone-400/60 focus:outline focus:outline-2 focus:outline-rose-400 focus:outline-offset-2";
const FORM_LABEL = "flex flex-col gap-1.5 text-[0.85rem] text-stone-400";
const STATUS_PILL_BASE =
  "inline-flex items-center gap-1 shrink-0 font-mono text-[0.65rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-transparent";
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
const DETAIL_WIDTH = "max-w-[760px] mx-auto w-full";
const TYPE_PILL_STATIC = "border-stone-600 text-stone-50 bg-stone-700";
const TYPE_PILL_PROXY = "border-transparent text-rose-300 bg-rose-950";

const TONE_PILL: Record<StatusTone, string> = {
  ok: `${STATUS_PILL_BASE} text-green-300 bg-green-950/60`,
  bad: `${STATUS_PILL_BASE} text-red-300 bg-red-950/60`,
  neutral: `${STATUS_PILL_BASE} text-stone-300 bg-stone-700`,
};

const CARD = "bg-stone-800 border border-stone-700 rounded-[10px] p-5";
const CARD_LABEL =
  "font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-stone-400 m-0 mb-3";

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-green-300",
  bad: "text-red-300",
  neutral: "text-stone-300",
};

function layout(title: string, body: string): string {
  const mainClass = "max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6";

  return `<!doctype html>
<html lang="en" class="[color-scheme:dark]">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Poetsen+One&family=Nunito:ital,wght@0,400;0,500;0,600;0,700;1,500&family=DM+Mono:wght@300;400;500&display=swap"
    rel="stylesheet"
  />
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="min-h-screen bg-stone-900 font-sans text-stone-50 m-0 px-6 pb-16">
  <header class="max-w-[1080px] mx-auto py-10 pb-12">
    <h1 class="font-display text-2xl font-semibold tracking-wide text-stone-50 m-0">lyly<span class="text-rose-400">.</span>admin</h1>
  </header>
  <main class="${mainClass}">
    <div id="flash-banner" class="hidden fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3" role="status" aria-live="polite">
      <span id="flash-banner-message"></span>
      <button type="button" id="flash-banner-close" class="hidden shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none" aria-label="Dismiss">&times;</button>
    </div>
    ${body}
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}

const ICONS = {
  plus: `<path d="M5 12h14" /><path d="M12 5v14" />`,
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />`,
  check: `<path d="M20 6 9 17l-5-5" />`,
  externalLink: `<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />`,
};

function icon(name: keyof typeof ICONS): string {
  return `<svg class="w-[1em] h-[1em] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

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
  domain: string,
  sitesRoot: string,
  error?: string,
  portOwners: Record<string, string> = {},
): string {
  const cards = sites
    .map((site) => {
      const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;

      return `
      <a href="/sites/${encodeURIComponent(site.hostname)}" class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3.5 motion-safe:transition-colors motion-safe:duration-150 hover:border-rose-800/70 no-underline">
        <div class="flex items-start justify-between gap-2">
          <p class="font-display text-base leading-relaxed text-stone-50 m-0 break-words">${escapeHtml(site.hostname)}</p>
          <span class="inline-block shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
            site.type === "static"
              ? "border-stone-600 text-stone-50 bg-stone-700"
              : "border-transparent text-rose-300 bg-rose-950"
          }">${site.type === "static" ? "static" : "proxy"}</span>
        </div>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words">${
          site.type === "static"
            ? `<span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}`
            : `<span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">localhost:</span>${escapeHtml(site.target)}${frameworkLabel ? ` · ${escapeHtml(frameworkLabel)}` : ""}`
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
        <h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">Existing sites</h2>
        <button type="button" class="${BUTTON_PRIMARY}" data-open-dialog="add-site-dialog">${icon("plus")}Add site</button>
      </div>
      <div class="sites-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        ${cards || `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`}
      </div>
    </section>

    <dialog id="add-site-dialog" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(460px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Add a site</h2>
      <form id="add-site-form" method="post" action="/sites" class="flex flex-col gap-4">
        <label class="${FORM_LABEL}">
          Hostname
          <input type="text" name="hostname" placeholder="blog.${escapeHtml(domain)}" required class="${INPUT}" />
        </label>

        <fieldset class="border-0 p-0 m-0 flex flex-col gap-2.5">
          <legend class="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-0 mb-2">Type</legend>

          <label class="flex flex-col gap-1 rounded-md border border-stone-600 bg-stone-700/50 px-3 py-2.5 cursor-pointer transition-colors hover:bg-stone-700/80 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500">
            <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
              <input type="radio" name="type" value="static" checked class="accent-stone-300" />
              Static site
            </span>
            <span class="text-stone-400 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lyly-admin creates for you with a placeholder page — no process to run yourself.</span>
          </label>

          <label class="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
            <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
              <input type="radio" name="type" value="reverse-proxy" class="accent-rose-400" />
              Reverse proxy
            </span>
            <span class="text-stone-400 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lyly-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
          </label>
        </fieldset>

        <div class="port-input hidden flex-col gap-3 border-l-2 border-l-rose-800/70 pl-3 ml-1">
          <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
            Local port (reverse proxy only)
            <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" />
            <span class="port-error hidden text-red-300 text-[0.8rem]"></span>
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

        <p id="add-site-error" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

        <div class="flex justify-end gap-2.5">
          <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="add-site-dialog">Cancel</button>
          <button type="submit" id="add-site-submit" class="${BUTTON_PRIMARY}">Add site</button>
        </div>
      </form>
    </dialog>
    `,
  );
}

interface Hop {
  label: string;
  value: string;
  sub?: string;
  /** Tailwind text-colour class for the sub-line; defaults to muted stone. */
  subClass?: string;
  /**
   * Full value behind an abbreviated sub-line, surfaced as a tooltip. A title
   * is mouse-only — it never appears on keyboard focus or touch — so it is an
   * inspection convenience, never the only route to a value the user needs.
   */
  subTitle?: string;
}

const HOP_LABEL =
  "font-mono text-[0.6rem] font-medium uppercase tracking-[0.09em] text-stone-500 m-0 mb-1.5";
const HOP_VALUE = "font-mono text-[0.8rem] text-stone-50 m-0 mb-0.5 break-all";
const DETAIL_ROW = "font-mono text-[0.8rem] m-0 mb-1 flex gap-3 last:mb-0";
const DETAIL_KEY = "text-stone-500 min-w-[7.5rem] shrink-0";

function renderHop(hop: Hop): string {
  return `<div class="min-w-0">
            <p class="${HOP_LABEL}">${escapeHtml(hop.label)}</p>
            <p class="${HOP_VALUE}">${escapeHtml(hop.value)}</p>
            ${hop.sub ? `<p class="font-mono text-[0.65rem] ${hop.subClass ?? "text-stone-500"} m-0 break-all"${hop.subTitle ? ` title="${escapeHtml(hop.subTitle)}"` : ""}>${escapeHtml(hop.sub)}</p>` : ""}
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
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
  const labels = opts.status ? describeStatus(opts.status) : null;

  const lastHop: Hop =
    site.type === "static"
      ? { label: "Your files", value: "file_server", ...(filesPath ? { sub: filesPath } : {}) }
      : {
          label: "Your app",
          value: `localhost:${site.target}`,
          ...(labels ? { sub: `● ${labels.hop}`, subClass: TONE_TEXT[labels.tone] } : {}),
        };

  const hops: Hop[] = [
    { label: "Cloudflare DNS", value: site.hostname, sub: "manual step" },
    {
      label: "Tunnel",
      // The service name leads because it is what an operator recognises and
      // what restartCloudflared() acts on. The tunnel's own ID qualifies it,
      // abbreviated to keep this hop from swamping the row — the full value
      // lives in the DNS command below, where it is copyable.
      value: "cloudflared-sites",
      ...(opts.tunnelId ? { sub: `${opts.tunnelId.slice(0, 8)}…`, subTitle: opts.tunnelId } : {}),
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
  "font-mono text-[0.625rem] text-rose-400 border border-rose-400/40 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
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

interface ManualStep {
  /** Plain sentence. Escaped at render time — never carries markup. */
  text: string;
  command?: {
    id: string;
    value: string;
    /** Directory the command must run in, shown as a caption beneath it. */
    cwd?: string;
  };
}

function renderStep(step: ManualStep, index: number): string {
  return `<div class="flex gap-3">
          <span class="${STEP_NUMBER}">${index + 1}</span>
          <div class="flex-1 min-w-0">
            <p class="${STEP_TEXT}">${escapeHtml(step.text)}</p>
            ${
              step.command
                ? `<div class="relative">
              <pre id="${step.command.id}" class="${CODE_LINE}">${escapeHtml(step.command.value)}</pre>
              ${copyButton(step.command.id, "Copy command", COPY_IN_LINE)}
            </div>
            ${step.command.cwd ? `<p class="font-mono text-[0.65rem] text-stone-500 m-0 mt-1">in ${escapeHtml(step.command.cwd)}/</p>` : ""}`
                : ""
            }
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
  const labels = opts.status ? describeStatus(opts.status) : null;
  const containerStatus = opts.status?.kind === "container" ? opts.status : null;
  const containerIsBroken =
    containerStatus !== null &&
    labels?.tone === "bad" &&
    // A container that was never created has no logs to read, and step 2
    // already says how to start it — "find out why it stopped" is nonsense
    // for a site that has never been deployed.
    containerStatus.state !== "not-created";

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

  if (site.framework && filesPath) {
    steps.push({
      // The prerequisite matters: add-site writes only the Dockerfile, compose
      // file and .dockerignore, so at this point the directory has no app
      // source and the Dockerfile's first COPY would fail. The generated
      // workflow rsyncs source in and then builds, which is why it is named
      // here rather than left for the reader to connect.
      text:
        "Get your app source into this directory, then build and start it. The workflow in Deploy below does both on every push to main — lyly-admin itself never starts, stops, or rebuilds the container.",
      command: { id: "cmd-compose", value: "docker compose up -d --build", cwd: filesPath },
    });
  }

  if (site.framework && filesPath && containerIsBroken) {
    steps.push({
      text: "Find out why it stopped.",
      command: { id: "cmd-logs", value: "docker compose logs", cwd: filesPath },
    });
  }

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Manual steps</h3>
        <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-4">lyly-admin wires up routing only. These are yours.</p>
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
          <h3 class="font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-red-300 m-0 mb-1.5">Danger</h3>
          <p class="text-stone-400 text-[0.8rem] leading-snug m-0">Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the tunnel. Your DNS record and files stay unless you ask otherwise.</p>
        </div>
        <button type="button" class="${BUTTON_DANGER} shrink-0" data-open-dialog="confirm-remove-dialog">${icon("trash")}Remove site</button>
      </section>`;
}

export interface SiteDetailOptions {
  sitesRoot: string;
  domain: string;
  tunnelId: string;
  caddyfilePath: string;
  status?: SiteStatus;
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string };
}

function renderDeployCommand(label: string, id: string, value: string): string {
  return `<div class="flex flex-col gap-1">
            <span class="text-stone-500 uppercase text-[0.65rem] tracking-[0.09em] font-mono">${escapeHtml(label)}</span>
            <div class="relative">
              <pre id="${id}" class="${CODE_LINE}">${escapeHtml(value)}</pre>
              ${copyButton(id, `Copy ${label}`, COPY_IN_LINE)}
            </div>
          </div>`;
}

/**
 * Commands and CI config for a scaffolded site. Deliberately a plain card: it
 * was a collapsed <details>, then a height-capped scroll box, and both hid
 * content to solve a problem that was not real. The generated workflow renders
 * ~485px, but this section sits above only Danger, so its length costs little,
 * and it is a file you may want to read — the branch filter, the rsync
 * excludes — not only copy. Nesting a vertical scrollbar inside a page you are
 * already scrolling is worse than a tall block.
 *
 * Horizontal scroll stays: the longest generated line is 85 characters, wider
 * than the column, and that is conventional for preformatted content.
 *
 * A cap would only earn its place if this content could be arbitrarily long.
 * It cannot — getFrameworkScaffold generates it, so its length changes only
 * when the template does.
 */
function renderDeploy(scaffold: NonNullable<SiteDetailOptions["scaffold"]>): string {
  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Deploy</h3>
        <div class="flex flex-col gap-3">
          ${renderDeployCommand("build command", "cmd-build", scaffold.buildCommand)}
          ${renderDeployCommand("run command", "cmd-run", scaffold.runCommand)}
          <div class="flex flex-col gap-1">
            <span class="text-stone-500 uppercase text-[0.65rem] tracking-[0.09em] font-mono">github actions workflow</span>
            <div class="relative">
              <pre id="github-workflow-yaml" class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 pr-11 text-[0.72rem] text-stone-50 overflow-x-auto whitespace-pre m-0">${escapeHtml(scaffold.deployWorkflow)}</pre>
              ${copyButton("github-workflow-yaml", "Copy workflow", COPY_IN_BLOCK)}
            </div>
            <p class="text-stone-400 text-[0.72rem] leading-snug m-0">Paste this into <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">.github/workflows/deploy.yml</code> in your app's repo.</p>
          </div>
        </div>
      </section>`;
}

function renderDetailHeader(site: Site, opts: SiteDetailOptions): string {
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, opts.domain);
  const labels = opts.status ? describeStatus(opts.status) : null;

  return `
      <nav class="font-mono text-[0.72rem] text-stone-500 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5">/</span>
        <span class="text-stone-50">${escapeHtml(site.hostname)}</span>
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
            ${labels ? `<span class="${TONE_PILL[labels.tone]}" data-state-pill>&#9679; ${escapeHtml(labels.pill)}</span>` : ""}
          </div>
        </div>
        <a href="https://${escapeHtml(site.hostname)}" target="_blank" rel="noopener noreferrer" class="${BUTTON_PRIMARY} no-underline shrink-0">Visit ${icon("externalLink")}</a>
      </div>`;
}

export function renderSiteDetail(site: Site, opts: SiteDetailOptions): string {
  const { scaffold } = opts;
  const filesPath = computeFilesPath(site, opts.sitesRoot);

  const deleteFilesSection = filesPath
    ? `
      <div class="flex flex-col gap-2 mb-5">
        <label class="flex flex-row items-center text-[0.8rem] text-stone-400 gap-1.5">
          <input type="checkbox" id="confirm-remove-delete-files" />
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
      ${scaffold ? renderDeploy(scaffold) : ""}

      ${renderDangerZone()}
    </div>

    <dialog id="confirm-remove-dialog" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
      <p class="m-0 mb-3 leading-relaxed">Remove <strong>${escapeHtml(site.hostname)}</strong>? In this order:</p>
      <ol class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <li class="flex gap-2"><span class="text-stone-500 shrink-0">1.</span><span>Caddyfile block removed</span></li>
        <li class="flex gap-2"><span class="text-stone-500 shrink-0">2.</span><span>Tunnel route removed</span></li>
        <li class="flex gap-2"><span class="text-stone-500 shrink-0">3.</span><span>Caddy validated and reloaded</span></li>
        <li class="flex gap-2"><span class="text-stone-500 shrink-0">4.</span><span>cloudflared-sites restarted</span></li>
      </ol>
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">If a step fails, the ones after it don't run.</p>
      ${deleteFilesSection}
      <div class="flex justify-end gap-2.5">
        <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
        <button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove site</button>
      </div>
    </dialog>
    `,
  );
}

export function renderSiteNotFound(hostname: string): string {
  return layout(
    "Site not found",
    `
    <div class="max-w-[640px] mx-auto flex flex-col gap-4">
      <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">No managed site found for "${escapeHtml(hostname)}".</p>
      <p class="m-0"><a href="/" class="text-rose-400 no-underline font-mono text-[0.85rem] hover:underline">&larr; Back to sites</a></p>
    </div>
    `,
  );
}
