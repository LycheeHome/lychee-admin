import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { renderSiteDetail } from "./html";

const OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  caddyfilePath: "/etc/caddy/Caddyfile",
};

const STATIC_SITE: Site = { hostname: "blog.lyly.dev", type: "static", target: "/var/www/blog.lyly.dev" };
const APEX_SITE: Site = { hostname: "lyly.dev", type: "static", target: "/var/www/lyly.dev" };
const PROXY_SITE: Site = { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" };
const NEXT_SITE: Site = {
  hostname: "app.lyly.dev",
  type: "reverse-proxy",
  target: "3000",
  framework: "nextjs",
  healthcheckPath: "/api/health",
};

describe("renderSiteDetail header", () => {
  test("replaces the back link with a breadcrumb to the site list", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /aria-label="Breadcrumb"/);
    assert.match(html, /<a href="\/"[^>]*>sites<\/a>/);
    assert.doesNotMatch(html, /Back to sites/);
  });

  test("dims the managed domain suffix on a subdomain", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /blog<span class="text-stone-500">\.lyly\.dev<\/span>/);
  });

  test("leaves the apex domain undimmed — it has no subdomain", () => {
    const html = renderSiteDetail(APEX_SITE, OPTS);
    assert.match(html, /id="site-hostname"[^>]*>lyly\.dev</);
    assert.doesNotMatch(html, /<span class="text-stone-500"><\/span>/);
  });

  test("offers Visit as the primary action, opening the real hostname safely", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /href="https:\/\/blog\.lyly\.dev"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  test("wires the hostname copy button to the existing generic handler", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /data-copy-target="site-hostname"/);
    assert.match(html, /id="site-hostname"/);
    assert.match(html, /data-copy-icon="idle"/);
    assert.match(html, /data-copy-icon="copied"/);
  });

  test("a static site gets a type pill and no state pill", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, />static</);
    assert.doesNotMatch(html, /data-state-pill/);
  });

  test("a container site's pill uses the canonical state word, not live", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "unhealthy" },
    });
    assert.match(html, /data-state-pill>&#9679; unhealthy<\/span>/);
    assert.doesNotMatch(html, /&#9679; live|>\s*live\s*</);
  });

  test("a plain proxy's pill reports responding", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.match(html, /data-state-pill>&#9679; responding<\/span>/);
  });

  test("widens the column past the old 640px", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /max-w-\[760px\]/);
  });
});

describe("renderSiteDetail request path", () => {
  test("names all four hops", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    for (const label of ["Cloudflare DNS", "Tunnel", "Caddy", "Your app"]) {
      assert.match(html, new RegExp(">" + label + "</p>"));
    }
  });

  test("marks DNS as a permanent manual step rather than a state", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /manual step/);
  });

  test("derives the tunnel hop from config instead of hardcoding a tunnel name", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // The service name leads; the abbreviated id qualifies it. Both anchored to
    // their own <p>, and the title assertion pins the tooltip and the visible
    // abbreviation to the same element so neither can drift from the other.
    assert.match(html, />cloudflared-sites<\/p>/);
    assert.match(html, /title="11111111-2222-3333-4444-555555555555">11111111…<\/p>/);
    assert.doesNotMatch(html, /lychee-sites/);
  });

  test("falls back to the service name when no tunnel id is configured", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.match(html, />cloudflared-sites<\/p>/);
    // No truncation ellipsis and no tooltip, because there was no id at all.
    assert.doesNotMatch(html, /…/);
    assert.doesNotMatch(html, /title="/);
  });

  test("derives the Caddy hop's path from the configured Caddyfile", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, caddyfilePath: "/opt/caddy/Caddyfile" });
    assert.match(html, />\/opt\/caddy<\/p>/);
  });

  test("a static site's last hop is its files, and the path is not repeated as a detail row", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /Your files/);
    assert.match(html, /file_server/);
    // Not a page-wide count: the untouched remove-confirmation modal (Task 7's
    // territory) also names this same path in its "Also delete files at ..."
    // checkbox label, so a page-wide occurrence count of the raw path can
    // never be 1. The actual intent — no redundant "files" detail row below
    // the hairline, alongside the hop 4 value — is what this checks, the same
    // way the plain-proxy test below confirms the absence of that row.
    assert.doesNotMatch(html, /files<\/span>/);
  });

  // Both colour assertions below are anchored to the hop's own sub-line, not
  // matched page-wide. The header pill renders the same tone class for the
  // same status, so a page-wide `assert.match(html, /text-red-300/)` would
  // still pass if the hop lost its subClass entirely and fell back to the
  // default muted stone — which is exactly the regression this card replaced.
  test("a container site's last hop carries the fuller status line", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "restarting" },
    });
    assert.match(html, /text-red-300[^"]*">● restarting · crash-looping/);
  });

  test("a starting health check is not painted red", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "starting" },
    });
    assert.match(html, /text-stone-300[^"]*">● running · health check starting/);
    assert.doesNotMatch(html, /text-red-300[^"]*">● running/);
  });

  test("shows the healthcheck path for a healthy site, not only when it fails", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /healthcheck/);
    assert.match(html, /\/api\/health/);
  });

  test("a legacy site with no healthcheck comment shows no healthcheck row", () => {
    const legacy: Site = { hostname: "legacy.lyly.dev", type: "reverse-proxy", target: "3001", framework: "nextjs" };
    const html = renderSiteDetail(legacy, { ...OPTS, status: { kind: "container", state: "running" } });
    assert.doesNotMatch(html, /healthcheck/);
    assert.match(html, /Next\.js/);
  });

  test("a plain proxy has no framework, healthcheck or files rows", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } });
    assert.doesNotMatch(html, /framework/);
    assert.doesNotMatch(html, /healthcheck/);
    assert.doesNotMatch(html, /files<\/span>/);
  });

  test("stacks the chain vertically on narrow screens", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /flex-col sm:flex-row/);
  });

  test("drops the old prose status card and its inline remediation hints", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "exited" },
    });
    assert.doesNotMatch(html, /Not responding on localhost/);
    assert.doesNotMatch(html, /Exited on localhost/);
    assert.doesNotMatch(html, /&#9679; Running on localhost/);
  });
});

describe("renderSiteDetail manual steps", () => {
  test("gives the DNS command permanently, not only in a post-create banner", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(
      html,
      /cloudflared tunnel route dns 11111111-2222-3333-4444-555555555555 blog\.lyly\.dev/,
    );
    assert.match(html, /id="cmd-dns"/);
    assert.match(html, /data-copy-target="cmd-dns"/);
  });

  test("warns that a missing DNS record still reads as running here", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /only checks localhost/);
  });

  test("never emits a command with an empty tunnel id", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.doesNotMatch(html, /tunnel route dns\s+[a-z]/);
    assert.doesNotMatch(html, /id="cmd-dns"/);
    assert.match(html, /Cloudflare dashboard/);
  });

  test("a static site's only manual step is DNS", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.doesNotMatch(html, /docker compose up/);
    assert.doesNotMatch(html, /docker compose logs/);
  });

  test("a plain proxy gets no docker step — lyly-admin scaffolded nothing", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } });
    assert.doesNotMatch(html, /docker compose/);
  });

  test("a scaffolded site is told to build and start the container itself", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /docker compose up -d --build/);
    assert.match(html, /id="cmd-compose"/);
    assert.match(html, /in \/var\/www\/app\.lyly\.dev\//);
    assert.match(html, /never starts, stops, or rebuilds/);
    // The build cannot succeed until app source is in the directory: add-site
    // writes only the scaffold, so the Dockerfile's first COPY would fail.
    // The step has to state that prerequisite and point at the workflow that
    // satisfies it, or it reads as a command you can run immediately.
    assert.match(html, /Get your app source into this directory, then build/);
    assert.match(html, /workflow in Deploy below/);
  });

  test("a healthy site is not offered the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.doesNotMatch(html, /docker compose logs/);
  });

  test("a broken container adds the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "exited" } });
    assert.match(html, /docker compose logs/);
    assert.match(html, /id="cmd-logs"/);
  });

  test("an unreadable container status is not treated as broken", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "unknown" } });
    assert.doesNotMatch(html, /docker compose logs/);
  });

  test("a never-deployed container gets steps 1 and 2 but not the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "not-created" } });
    assert.match(html, /id="cmd-dns"/);
    assert.match(html, /id="cmd-compose"/);
    assert.doesNotMatch(html, /docker compose logs/);
    assert.doesNotMatch(html, /id="cmd-logs"/);
  });
});

const SCAFFOLD = {
  buildCommand: "npm run build",
  runCommand: "npm start",
  deployWorkflow: "name: Deploy app.lyly.dev\non:\n  push:\n    branches: [main]\n",
};

describe("renderSiteDetail deploy", () => {
  test("nothing is hidden behind a disclosure widget", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    assert.doesNotMatch(html, /<details/);
    assert.doesNotMatch(html, /<summary/);
    // Deploy is a plain card like Request path and Manual steps.
    assert.match(html, />Deploy<\/h3>/);
  });

  test("the workflow block is its natural height, with no nested vertical scroll", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    // No max-height and no vertical overflow anywhere on the page: a scrollbar
    // inside a page you are already scrolling is worse than a tall block, and
    // this is a file you may want to read rather than only copy.
    assert.doesNotMatch(html, /max-h-/);
    assert.doesNotMatch(html, /overflow-y-auto|overflow-auto/);
    // Long lines still scroll sideways, which preformatted content needs.
    assert.match(html, /id="github-workflow-yaml"[^>]*\boverflow-x-auto\b/);
  });

  test("keeps every deploy command copyable", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    assert.match(html, /npm run build/);
    assert.match(html, /npm start/);
    assert.match(html, /data-copy-target="cmd-build"/);
    assert.match(html, /data-copy-target="cmd-run"/);
    assert.match(html, /data-copy-target="github-workflow-yaml"/);
  });

  test("every copy button inside a code block shares one right-hand inset", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    // The single-line boxes and the multi-line workflow block position their
    // buttons differently vertically — centred vs top-pinned — but the
    // horizontal inset has to agree or the buttons visibly step in and out.
    // They drifted once (right-1.5 vs right-2) and 2px was noticeable.
    const insets = [...html.matchAll(/class="[^"]*\babsolute\b[^"]*?(right-[^\s"]+)/g)].map((m) => m[1]);
    assert.ok(insets.length >= 3, `expected 3+ positioned copy buttons, saw ${insets.length}`);
    assert.equal(
      new Set(insets).size,
      1,
      `copy button insets drifted apart: ${[...new Set(insets)].join(", ")}`,
    );
  });

  test("a site with no scaffold gets no Deploy section at all", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.doesNotMatch(html, />Deploy<\/h3>/);
    assert.doesNotMatch(html, /cmd-build|cmd-run|github-workflow-yaml/);
  });
});

describe("renderSiteDetail danger zone", () => {
  test("isolates the destructive action in a titled block with its consequence stated", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /Danger/);
    assert.match(html, /reloads Caddy, then restarts the tunnel/);
  });

  test("the remove action keeps one name from button to modal confirm", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // Scoped to each button's own markup rather than counting the string
    // page-wide: the danger-zone button already read "Remove site" before this
    // task and the modal heading reads it too, so a whole-document count of 2+
    // was satisfied before anything changed. Each regex walks forward from a
    // button's identifying attribute without crossing a </button>, so it can
    // only match that button's own label.
    const labelled = (attr: string) =>
      new RegExp(`${attr}(?:(?!<\\/button>)[\\s\\S])*Remove site<\\/button>`);
    assert.match(html, labelled('data-open-dialog="confirm-remove-dialog"'));
    assert.match(html, labelled('id="confirm-remove-submit"'));
    // The old confirm button said just "Remove".
    assert.doesNotMatch(html, />Remove<\/button>/);
  });

  test("the modal names the sequence, in order", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    for (const step of [
      "Caddyfile block removed",
      "Tunnel route removed",
      "Caddy validated and reloaded",
      "cloudflared-sites restarted",
    ]) {
      assert.match(html, new RegExp(step));
    }
    assert.match(html, /the ones after it don't run/);
  });

  test("the modal's steps carry their own numbers, so no marker can overflow the grid", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // Numbered explicitly rather than with list-decimal. A marker with
    // list-style-position:outside renders in the LIST's padding, so in a
    // two-column grid the right column's marker paints over the left column's
    // text. Asserting the number and its label are adjacent pins the reading
    // order too, which is what a screen reader and a text-only render get.
    assert.match(html, /<ol[^>]*list-none/);
    assert.doesNotMatch(html, /<ol[^>]*list-decimal/);
    for (const [n, label] of [
      [1, "Caddyfile block removed"],
      [4, "cloudflared-sites restarted"],
    ] as const) {
      assert.match(html, new RegExp(`>${n}\\.<\\/span><span>${label}<\\/span>`));
    }
  });

  test("a site with files offers the delete checkbox naming the exact path", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /id="confirm-remove-delete-files"[\s\S]{0,200}?\/var\/www\/blog\.lyly\.dev/);
  });

  test("a plain proxy has no directory, so no delete checkbox", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.doesNotMatch(html, /id="confirm-remove-delete-files"/);
  });

  test("a scaffolded site keeps the running-container warning", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /docker compose down/);
    assert.match(html, /won't stop it/);
  });
});

describe("renderSiteDetail escaping", () => {
  test("escapes a hostile hostname and healthcheckPath everywhere they render", () => {
    // Hostnames are validated on write (POST /sites), but GET /sites/:hostname
    // renders whatever a hand-edited Caddyfile contains, and healthcheckPath is
    // explicitly unvalidated on this read path (see src/routes/sites.ts). This
    // locks in the spec's no-exceptions escaping rule across both fields.
    const hostileSite: Site = {
      hostname: "<script>alert(1)</script>.lyly.dev",
      type: "reverse-proxy",
      target: "3000",
      framework: "nextjs",
      healthcheckPath: '/"><script>alert(2)</script>',
    };
    const html = renderSiteDetail(hostileSite, OPTS);

    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<script>alert\(2\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(2\)/);
  });
});
