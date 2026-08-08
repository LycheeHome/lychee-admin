import type { Site } from "../lib/caddyfile";

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
const RESULT_LINK = "text-rose-400 no-underline font-mono text-[0.85rem] hover:underline";

function layout(title: string, body: string, variant: "grid" | "result" = "grid"): string {
  const mainClass =
    variant === "result"
      ? "max-w-[640px] mx-auto py-6 pb-8 block"
      : "max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6";

  return `<!doctype html>
<html lang="en" class="[color-scheme:dark]">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Poetsen+One&family=Nunito:ital,wght@0,400;0,500;0,600;0,700;1,500&display=swap"
    rel="stylesheet"
  />
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="min-h-screen bg-stone-900 font-sans text-stone-50 m-0 px-6 pb-16">
  <header class="max-w-[1080px] mx-auto py-10 pb-12">
    <h1 class="font-display text-2xl font-semibold tracking-wide text-stone-50 m-0">lyly<span class="text-rose-400">.</span>admin</h1>
  </header>
  <main class="${mainClass}">${body}</main>
  <script src="/app.js"></script>
</body>
</html>`;
}

function resultPanel(body: string): string {
  return `<section class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-4">${body}</section>`;
}

const ICONS = {
  plus: `<path d="M5 12h14" /><path d="M12 5v14" />`,
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
};

function icon(name: keyof typeof ICONS): string {
  return `<svg class="w-[1em] h-[1em] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function renderSiteList(
  sites: Site[],
  domain: string,
  error?: string,
  portOwners: Record<string, string> = {},
): string {
  const cards = sites
    .map(
      (site) => `
      <article class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3.5 motion-safe:transition-colors motion-safe:duration-150 hover:border-rose-800/70">
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
            : `<span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">localhost:</span>${escapeHtml(site.target)}`
        }</p>
        <form method="post" action="/sites/${encodeURIComponent(site.hostname)}/delete" class="delete-form mt-auto pt-2.5 flex items-center gap-2.5 flex-wrap">
          ${
            site.type === "static"
              ? `<label class="flex-row items-center text-[0.75rem] text-stone-400 gap-1.5 flex">
                  <input type="checkbox" name="deleteFiles" value="on" />
                  Also delete files at ${escapeHtml(site.target)}
                </label>`
              : ""
          }
          <button type="submit" class="${BUTTON_DANGER}">${icon("trash")}Remove</button>
        </form>
      </article>`,
    )
    .join("");

  return layout(
    "Sites",
    `
    ${error ? `<p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3 max-w-[1080px] mx-auto mb-5">${escapeHtml(error)}</p>` : ""}
    <section>
      <div class="flex items-center justify-between gap-4 mb-5">
        <h2 class="font-mono text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0">Existing sites</h2>
        <button type="button" class="${BUTTON_PRIMARY} font-mono" data-open-dialog="add-site-dialog">${icon("plus")}Add site</button>
      </div>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        ${cards || `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`}
      </div>
    </section>

    <dialog id="add-site-dialog" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 class="font-mono text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Add a site</h2>
      <form method="post" action="/sites" class="flex flex-col gap-4">
        <label class="${FORM_LABEL}">
          Hostname
          <input type="text" name="hostname" placeholder="blog.${escapeHtml(domain)}" required class="${INPUT}" />
        </label>

        <fieldset class="border border-stone-700 rounded-md px-3 py-2.5 flex flex-col gap-2">
          <legend class="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-1">Type</legend>
          <label class="flex flex-row items-center text-stone-50 text-[0.9rem] gap-2"><input type="radio" name="type" value="static" checked /> Static site</label>
          <label class="flex flex-row items-center text-stone-50 text-[0.9rem] gap-2"><input type="radio" name="type" value="reverse-proxy" /> Reverse proxy</label>
        </fieldset>

        <label class="port-input hidden ${FORM_LABEL}">
          Local port (reverse proxy only)
          <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" />
          <span class="port-error hidden text-red-300 text-[0.8rem]"></span>
        </label>
        <script type="application/json" id="port-owners-data">${JSON.stringify(portOwners)}</script>

        <div class="flex justify-end gap-2.5">
          <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="add-site-dialog">Cancel</button>
          <button type="submit" class="${BUTTON_PRIMARY}">Add site</button>
        </div>
      </form>
    </dialog>
    `,
  );
}

export function renderAddResult(hostname: string, tunnelId: string): string {
  return layout(
    "Site added",
    resultPanel(`
    <p class="m-0 leading-relaxed">Added <strong>${escapeHtml(hostname)}</strong>.</p>
    <p class="font-mono text-[0.85rem] bg-stone-700/60 border border-stone-700 border-l-[3px] border-l-rose-400 px-4 py-3.5 rounded-md leading-relaxed">
      Don't forget to add the DNS record:<br />
      <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">cloudflared tunnel route dns ${escapeHtml(tunnelId)} ${escapeHtml(hostname)}</code>
    </p>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderRemoveResult(hostname: string): string {
  return layout(
    "Site removed",
    resultPanel(`
    <p class="m-0 leading-relaxed">Removed <strong>${escapeHtml(hostname)}</strong> from Caddy and the tunnel ingress config.</p>
    <p class="font-mono text-[0.85rem] bg-stone-700/60 border border-stone-700 border-l-[3px] border-l-rose-400 px-4 py-3.5 rounded-md leading-relaxed">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderConfirmDeleteFiles(hostname: string, sitePath: string): string {
  return layout(
    "Confirm delete site files",
    resultPanel(`
    <p class="m-0 leading-relaxed">${escapeHtml(hostname)} has been removed from Caddy and the tunnel ingress config.</p>
    <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">
      This next step will permanently delete <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(sitePath)}</code> and everything in it.
      This cannot be undone.
    </p>
    <form method="post" action="/sites/${encodeURIComponent(hostname)}/delete-files">
      <button type="submit" class="${BUTTON_DANGER}">Delete permanently</button>
    </form>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">Cancel &mdash; leave the files in place</a></p>
    `),
    "result",
  );
}

export function renderFilesDeletedResult(hostname: string, sitePath: string): string {
  return layout(
    "Site files deleted",
    resultPanel(`
    <p class="m-0 leading-relaxed">Deleted <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(sitePath)}</code>.</p>
    <p class="font-mono text-[0.85rem] bg-stone-700/60 border border-stone-700 border-l-[3px] border-l-rose-400 px-4 py-3.5 rounded-md leading-relaxed">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderError(title: string, message: string): string {
  return layout(
    title,
    resultPanel(`<p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">${escapeHtml(message)}</p><p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">&larr; Back to sites</a></p>`),
    "result",
  );
}
