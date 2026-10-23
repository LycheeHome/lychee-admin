import type { Site } from "../lib/caddyfile";
import { ADD_STEPS } from "../lib/stepReport";
import { layout, type ShellData } from "./shell";
import {
  escapeHtml,
  ERROR_BOX,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  INPUT,
  FORM_LABEL,
  FOCUS_RING,
  FRAME_WIDTH,
  CARD,
  CARD_LABEL_BASE,
  BODY,
  PATH_LABEL,
} from "./shared";

// The server-rendered page bodies that remain: the add-site page and the
// error page a site route answers 500 with. The sites list, the site page and
// the services board are the client's (src/client/); their retired
// renderers' output is frozen in src/dev/fixtures/ for the parity tests.

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
