import type { Site } from "../lib/caddyfile";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header><h1>lyly-admin</h1></header>
  <main>${body}</main>
  <script src="/app.js"></script>
</body>
</html>`;
}

export function renderSiteList(sites: Site[], domain: string, error?: string): string {
  const rows = sites
    .map(
      (site) => `
      <tr>
        <td>${escapeHtml(site.hostname)}</td>
        <td>${site.type === "static" ? "Static" : "Reverse proxy"}</td>
        <td>${escapeHtml(site.target)}</td>
        <td>
          <form method="post" action="/sites/${encodeURIComponent(site.hostname)}/delete" class="delete-form">
            ${
              site.type === "static"
                ? `<label class="delete-files-option">
                    <input type="checkbox" name="deleteFiles" value="on" />
                    Also delete site files at ${escapeHtml(site.target)}
                  </label>`
                : ""
            }
            <button type="submit" class="danger">Remove</button>
          </form>
        </td>
      </tr>`,
    )
    .join("");

  return layout(
    "Sites",
    `
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <section>
      <h2>Existing sites</h2>
      <table>
        <thead><tr><th>Hostname</th><th>Type</th><th>Target</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No sites configured yet.</td></tr>`}</tbody>
      </table>
    </section>

    <section>
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

        <button type="submit">Add site</button>
      </form>
    </section>
    `,
  );
}

export function renderAddResult(hostname: string, tunnelId: string): string {
  return layout(
    "Site added",
    `
    <p>Added <strong>${escapeHtml(hostname)}</strong>.</p>
    <p class="reminder">
      Don't forget to add the DNS record:<br />
      <code>cloudflared tunnel route dns ${escapeHtml(tunnelId)} ${escapeHtml(hostname)}</code>
    </p>
    <p><a href="/">Back to sites</a></p>
    `,
  );
}

export function renderRemoveResult(hostname: string): string {
  return layout(
    "Site removed",
    `
    <p>Removed <strong>${escapeHtml(hostname)}</strong> from Caddy and the tunnel ingress config.</p>
    <p class="reminder">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p><a href="/">Back to sites</a></p>
    `,
  );
}

export function renderConfirmDeleteFiles(hostname: string, sitePath: string): string {
  return layout(
    "Confirm delete site files",
    `
    <p>${escapeHtml(hostname)} has been removed from Caddy and the tunnel ingress config.</p>
    <p class="error">
      This next step will permanently delete <code>${escapeHtml(sitePath)}</code> and everything in it.
      This cannot be undone.
    </p>
    <form method="post" action="/sites/${encodeURIComponent(hostname)}/delete-files">
      <button type="submit" class="danger">Delete permanently</button>
    </form>
    <p><a href="/">Cancel — leave the files in place</a></p>
    `,
  );
}

export function renderFilesDeletedResult(hostname: string, sitePath: string): string {
  return layout(
    "Site files deleted",
    `
    <p>Deleted <code>${escapeHtml(sitePath)}</code>.</p>
    <p class="reminder">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p><a href="/">Back to sites</a></p>
    `,
  );
}

export function renderError(title: string, message: string): string {
  return layout(title, `<p class="error">${escapeHtml(message)}</p><p><a href="/">Back to sites</a></p>`);
}
