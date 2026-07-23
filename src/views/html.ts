import type { Site } from "../lib/caddyfile";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string, variant: "grid" | "result" = "grid"): string {
  return `<!doctype html>
<html lang="en">
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
<body>
  <header>
    <h1>lyly<span class="dot">.</span>admin</h1>
  </header>
  <main${variant === "result" ? ' class="result"' : ""}>${body}</main>
  <script src="/app.js"></script>
</body>
</html>`;
}

function resultPanel(body: string): string {
  return `<section class="panel">${body}</section>`;
}

const ICONS = {
  plus: `<path d="M5 12h14" /><path d="M12 5v14" />`,
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
};

function icon(name: keyof typeof ICONS): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function renderSiteList(sites: Site[], domain: string, error?: string): string {
  const cards = sites
    .map(
      (site) => `
      <article class="site-card">
        <div class="site-card-top">
          <p class="hostname">${escapeHtml(site.hostname)}</p>
          <span class="badge ${site.type === "static" ? "static" : "proxy"}">${site.type === "static" ? "static" : "proxy"}</span>
        </div>
        <p class="target">${
          site.type === "static"
            ? `<span class="target-label">path:</span> ${escapeHtml(site.target)}`
            : `<span class="target-label">localhost:</span>${escapeHtml(site.target)}`
        }</p>
        <form method="post" action="/sites/${encodeURIComponent(site.hostname)}/delete" class="delete-form">
          ${
            site.type === "static"
              ? `<label class="delete-files-option">
                  <input type="checkbox" name="deleteFiles" value="on" />
                  Also delete files at ${escapeHtml(site.target)}
                </label>`
              : ""
          }
          <button type="submit" class="danger">${icon("trash")}Remove</button>
        </form>
      </article>`,
    )
    .join("");

  return layout(
    "Sites",
    `
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <section>
      <div class="section-head">
        <h2>Existing sites</h2>
        <button type="button" class="add-site-trigger" data-open-dialog="add-site-dialog">${icon("plus")}Add site</button>
      </div>
      <div class="site-grid">
        ${cards || `<p class="empty-state">No sites configured yet.</p>`}
      </div>
    </section>

    <dialog id="add-site-dialog" class="modal">
      <h2>Add a site</h2>
      <form method="post" action="/sites">
        <label>
          Hostname
          <input type="text" name="hostname" placeholder="blog.${escapeHtml(domain)}" required />
        </label>

        <fieldset>
          <legend>Type</legend>
          <label><input type="radio" name="type" value="static" checked /> Static site</label>
          <label><input type="radio" name="type" value="reverse-proxy" /> Reverse proxy</label>
        </fieldset>

        <label class="port-input">
          Local port (reverse proxy only)
          <input type="number" name="port" min="1" max="65535" />
        </label>

        <div class="modal-actions">
          <button type="button" class="secondary" data-close-dialog="add-site-dialog">Cancel</button>
          <button type="submit">Add site</button>
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
    <p>Added <strong>${escapeHtml(hostname)}</strong>.</p>
    <p class="reminder">
      Don't forget to add the DNS record:<br />
      <code>cloudflared tunnel route dns ${escapeHtml(tunnelId)} ${escapeHtml(hostname)}</code>
    </p>
    <p><a href="/">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderRemoveResult(hostname: string): string {
  return layout(
    "Site removed",
    resultPanel(`
    <p>Removed <strong>${escapeHtml(hostname)}</strong> from Caddy and the tunnel ingress config.</p>
    <p class="reminder">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p><a href="/">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderConfirmDeleteFiles(hostname: string, sitePath: string): string {
  return layout(
    "Confirm delete site files",
    resultPanel(`
    <p>${escapeHtml(hostname)} has been removed from Caddy and the tunnel ingress config.</p>
    <p class="error">
      This next step will permanently delete <code>${escapeHtml(sitePath)}</code> and everything in it.
      This cannot be undone.
    </p>
    <form method="post" action="/sites/${encodeURIComponent(hostname)}/delete-files">
      <button type="submit" class="danger">Delete permanently</button>
    </form>
    <p><a href="/">Cancel &mdash; leave the files in place</a></p>
    `),
    "result",
  );
}

export function renderFilesDeletedResult(hostname: string, sitePath: string): string {
  return layout(
    "Site files deleted",
    resultPanel(`
    <p>Deleted <code>${escapeHtml(sitePath)}</code>.</p>
    <p class="reminder">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p><a href="/">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderError(title: string, message: string): string {
  return layout(
    title,
    resultPanel(`<p class="error">${escapeHtml(message)}</p><p><a href="/">&larr; Back to sites</a></p>`),
    "result",
  );
}
