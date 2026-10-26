import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { computeFilesPath, type Site } from "../../lib/caddyfile";
import type { SiteDetailOptions } from "../../views/siteDetailModel";
import { RETIRED_SWITCHER } from "../../dev/testHelpers";
import {
  TONE_PILL,
  TONE_TEXT,
  BUTTON_OFFER,
  BUTTON_PRIMARY,
  BUTTON_PRIMARY_COMPACT,
  BUTTON_SECONDARY,
  BUTTON_SECONDARY_COMPACT,
  ERROR_BOX,
} from "../../views/shared";
import { CaddyfileError, SiteDetail, SiteNotFound } from "./SiteDetail";
import { PruneLine, RequestedLine } from "./DeployLines";

/*
 * The site page's markup rules, against the React SiteDetail. These were
 * src/views/html.test.ts's tests of the server's site page renderer, carried
 * over when that renderer was retired: same names, same options, same
 * assertions. Only the renderer behind `renderSiteDetail` below changed.
 *
 * What did not come here, and where it went:
 * - the ?created=1 notice: AppFrame renders it, above the page, so its rules
 *   (when it shows, and that an unknown site or an unreadable Caddyfile gets
 *   none) are in src/client/AppFrame.test.tsx's page-notice tests, and its
 *   sentences model tests of addedNotice in siteDetailModel.test.ts;
 * - the copy-status live region and the rail's current row: AppFrame's, held
 *   to the retired server shell's frozen output in
 *   src/client/AppFrameParity.test.tsx (the site-* cases), with the current
 *   row's port contrast in src/client/components/Rail.test.tsx;
 * - offeredTag's rules: src/views/boardFacts.test.ts, beside the function;
 * - statePhrase's: src/views/shared.test.ts, with the other shared.ts helpers.
 *
 * Assertions that matched `&#9679;` now match `●`: the server wrote the
 * header pill's dot as an entity and the hops' as the character, React writes
 * the character in both, and the two parse to the same text.
 */

/**
 * The retired renderer's signature, now building the payload the way
 * GET /api/sites/:hostname does (the site, its files path, the facts; never
 * `created`, whose notice AppFrame renders) and rendering it with the React
 * SiteDetail, without writes: the page's first paint.
 *
 * The markup is respelled where React and the server wrote the same DOM
 * differently, so the assertions read as they did: U+00A0 as `&nbsp;`,
 * `&#x27;` as `'` (the server never escaped an apostrophe), and an empty
 * attribute (`data-state-pill=""`) in its bare form. Those spellings parse to
 * identical nodes; the frozen parity fixtures (SiteDetailParity.test.tsx) hold
 * the rest of the markup to what the server rendered.
 */
function respell(html: string): string {
  return html
    .replace(new RegExp(String.fromCharCode(0xa0), "g"), "&nbsp;")
    .replace(/&#x27;/g, "'")
    .replace(/ ([a-z][a-z-]*)=""/g, " $1");
}

function renderSiteDetail(site: Site, opts: SiteDetailOptions): string {
  const facts: Omit<SiteDetailOptions, "created"> = { ...opts };
  delete (facts as SiteDetailOptions).created;
  return respell(
    renderToStaticMarkup(
      <SiteDetail
        payload={{ site, filesPath: computeFilesPath(site, opts.sitesRoot), caddyfileError: null, ...facts }}
      />,
    ),
  );
}

function renderSiteNotFound(hostname: string): string {
  return respell(renderToStaticMarkup(<SiteNotFound hostname={hostname} />));
}

/** html.ts's renderPruneControl, now DeployLines' PruneLine, which the repository card renders. */
function renderPruneControl(name: string, emphasis: "secondary" | "primary" = "secondary"): string {
  return respell(renderToStaticMarkup(<PruneLine name={name} emphasis={emphasis} />));
}

/** html.ts's renderRequestedLine, now DeployLines' RequestedLine. */
function renderRequestedLine(tag: string): string {
  return respell(renderToStaticMarkup(<RequestedLine tag={tag} />));
}

const STATIC_SITE: Site = { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" };
const APEX_SITE: Site = { hostname: "lychee.land", type: "static", target: "/var/www/lychee.land" };
const PROXY_SITE: Site = { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" };
const NEXT_SITE: Site = {
  hostname: "app.lychee.land",
  type: "reverse-proxy",
  target: "3000",
  framework: "nextjs",
  healthcheckPath: "/api/health",
};

const OPTS = {
  sitesRoot: "/var/www",
  domain: "lychee.land",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  caddyfilePath: "/etc/caddy/Caddyfile",
};

/**
 * Returns the opening tag of the element with `id`, so an assertion is made
 * against that element rather than the whole document. A document-wide regex
 * would pass on any page that happens to mention the attribute somewhere else.
 */
function tagById(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]* id="${id}"[^>]*>`));
  assert.ok(match, `no element with id="${id}" was rendered`);
  return match[0];
}

/**
 * Like tagById, but returns the whole <ol id="${id}">...</ol> — opening tag
 * through its children — rather than just the opening tag, so an assertion
 * about a `data-step-id` on a child <li> is anchored to this specific list
 * rather than the whole document.
 */
function listById(html: string, id: string): string {
  const match = html.match(new RegExp(`<ol[^>]* id="${id}"[^>]*>[\\s\\S]*?<\\/ol>`));
  assert.ok(match, `no <ol id="${id}"> was rendered`);
  return match[0];
}

describe("renderSiteDetail header", () => {
  test("replaces the back link with a breadcrumb to the site list", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /aria-label="Breadcrumb"/);
    assert.match(html, /<a href="\/"[^>]*>sites<\/a>/);
    assert.doesNotMatch(html, /Back to sites/);
  });

  test("dims the managed domain suffix on a subdomain", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /blog<span class="text-stone-500">\.lychee\.land<\/span>/);
  });

  test("leaves the apex domain undimmed — it has no subdomain", () => {
    const html = renderSiteDetail(APEX_SITE, OPTS);
    assert.match(html, /id="site-hostname"[^>]*>lychee\.land</);
    assert.doesNotMatch(html, /<span class="text-stone-500"><\/span>/);
  });

  test("offers Visit as the primary action, opening the real hostname safely", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /href="https:\/\/blog\.lychee\.land"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  const visitTag = (html: string): string => {
    const m = html.match(/<a [^>]*>Visit /);
    assert.ok(m, "no Visit link rendered");
    return m[0];
  };
  const PRIMARY_VISIT = `class="${BUTTON_PRIMARY} no-underline shrink-0"`;
  const SECONDARY_VISIT = `class="${BUTTON_SECONDARY} no-underline shrink-0"`;

  test("Visit leads for a static site, an unchecked proxy and a responding one", () => {
    assert.ok(visitTag(renderSiteDetail(STATIC_SITE, OPTS)).includes(PRIMARY_VISIT));
    assert.ok(visitTag(renderSiteDetail(PROXY_SITE, OPTS)).includes(PRIMARY_VISIT));
    const up = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.ok(visitTag(up).includes(PRIMARY_VISIT));
  });

  test("Visit leads for a running container", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      resource: RUNNING_RESOURCE,
      status: { kind: "container", state: "running" },
    });
    assert.ok(visitTag(html).includes(PRIMARY_VISIT));
  });

  test("Visit steps back to Secondary while the site is not serving, never disabled", () => {
    const statuses = [
      { kind: "tcp", responding: false },
      { kind: "awaiting-image" },
      { kind: "container", state: "not-created" },
      { kind: "container", state: "running", health: "starting" },
      { kind: "container", state: "unknown" },
      { kind: "failed" },
    ] as const;
    for (const status of statuses) {
      const site = status.kind === "tcp" ? PROXY_SITE : NEXT_SITE;
      const tag = visitTag(renderSiteDetail(site, { ...OPTS, resource: RUNNING_RESOURCE, status }));
      assert.ok(tag.includes(SECONDARY_VISIT), `secondary for ${JSON.stringify(status)}`);
      assert.ok(tag.includes(`href="https://${site.hostname}"`));
      assert.ok(tag.includes('target="_blank"'));
      assert.doesNotMatch(tag, /\s(aria-)?disabled[=\s>]/);
    }
  });

  test("wires the hostname copy button to the existing generic handler", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /data-copy-target="site-hostname"/);
    assert.match(html, /id="site-hostname"/);
    assert.match(html, /data-copy-icon="idle"/);
    assert.match(html, /data-copy-icon="copied"/);
  });

  test("a static site's header has no pills", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // The type-word check looks at the header alone, up to the Visit button.
    const headerStart = html.indexOf('id="site-hostname"');
    const header = html.slice(headerStart, html.indexOf("Visit", headerStart));
    assert.ok(headerStart >= 0 && header.length > 0, "the header slice is empty");
    assert.doesNotMatch(header, />static</);
    assert.doesNotMatch(html, /data-state-pill/);
    assert.doesNotMatch(html, /<div class="flex items-center gap-2 mt-3/);
  });

  test("a proxy site's header shows its status pill and no type pill", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } });
    assert.match(html, /data-state-pill>[\s\S]*not responding/);
    const headerStart = html.indexOf('id="site-hostname"');
    const header = html.slice(headerStart, html.indexOf("Visit", headerStart));
    assert.ok(headerStart >= 0 && header.length > 0, "the header slice is empty");
    assert.doesNotMatch(header, />proxy</);
  });

  test("a proxy site with no status has no pill row", () => {
    const html = renderSiteDetail(PROXY_SITE, OPTS);
    assert.doesNotMatch(html, /data-state-pill/);
    assert.doesNotMatch(html, /<div class="flex items-center gap-2 mt-3/);
  });

  // Its notice half ("a created static site's notice still renders") is
  // AppFrame's now: the ?created=1 tests in AppFrame.test.tsx. The payload
  // never carries `created`, so the page is the same either way.
  test("a created static site's notice still renders with no pill row", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, created: true });
    assert.equal(html, renderSiteDetail(STATIC_SITE, OPTS));
    assert.doesNotMatch(html, /<div class="flex items-center gap-2 mt-3/);
  });

  test("a container site's pill uses the canonical state word, not live", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "unhealthy" },
    });
    assert.match(html, /data-state-pill><span aria-hidden="true">●<\/span> unhealthy<\/span>/);
    assert.doesNotMatch(html, /<span aria-hidden="true">●<\/span> live|>\s*live\s*</);
  });

  test("a plain proxy's pill reports responding", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.match(html, /data-state-pill><span aria-hidden="true">●<\/span> responding<\/span>/);
  });

  test("widens the column past the old 640px", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /max-w-\[760px\]/);
  });
});

// The breadcrumb's hostname dropdown is gone: site-to-site movement is the
// rail's, and what the dropdown's tests pinned about its rows (no truncation,
// Smoke suffix, type hint and no status, no ember fill on the current row) is
// pinned on the rail's rows in rail.test.ts.
describe("the site detail breadcrumb", () => {
  const breadcrumb = (html: string) => {
    const match = html.match(/<nav [^>]*aria-label="Breadcrumb">[\s\S]*?<\/nav>/);
    assert.ok(match, "expected a breadcrumb");
    return match[0];
  };

  test("is plain location text: sites / <hostname>", () => {
    const block = breadcrumb(renderSiteDetail(STATIC_SITE, OPTS));
    assert.match(block, /<a href="\/"[^>]*>sites<\/a>\s*<span[^>]*aria-hidden="true">\/<\/span>\s*<span class="text-stone-50">blog\.lychee\.land<\/span>/);
  });

  test("carries no dropdown and lists no other site", () => {
    const block = breadcrumb(renderSiteDetail(STATIC_SITE, OPTS));
    assert.doesNotMatch(block, /<details|<summary/);
    assert.doesNotMatch(block, RETIRED_SWITCHER);
    for (const site of [PROXY_SITE, NEXT_SITE]) assert.ok(!block.includes(site.hostname), site.hostname);
  });
});

/** An attached site with a version installed: the only state with a container to read logs from. */
const RUNNING_RESOURCE = { name: "app-lychee-land", repo: "app-site", version: "0.2.0", result: "deployed" };

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
    // Service name and its config directory, mirroring the Caddy hop. The id
    // is deliberately absent here — identical on every page and unusable
    // abbreviated — but must still reach the DNS command in full.
    assert.match(html, />cloudflared-sites<\/p>/);
    assert.match(html, />\/etc\/cloudflared<\/p>/);
    assert.doesNotMatch(html, /11111111…/);
    assert.doesNotMatch(html, /lychee-sites/);
  });

  test("falls back to the service name when no tunnel id is configured", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.match(html, />cloudflared-sites<\/p>/);
    // The hop never showed the id, so an empty one changes only the DNS step.
    assert.doesNotMatch(html, /tunnel route dns/);
    assert.match(html, /Cloudflare dashboard/);
  });

  test("derives the Caddy hop's path from the configured Caddyfile", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, caddyfilePath: "/opt/caddy/Caddyfile" });
    assert.match(html, />\/opt\/caddy<\/p>/);
  });

  test("a static site's last hop is its files, and the path is not repeated as a detail row", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /Your files/);
    assert.match(html, /file_server/);
    // Not a page-wide count: the remove-confirmation modal also names this
    // same path in its "Also delete files at ..." checkbox label, so a
    // page-wide occurrence count of the raw path can never be 1. The actual
    // intent — no redundant "files" detail row below the hairline, alongside
    // the hop 4 value — is what this checks, the same way the plain-proxy
    // test below confirms the absence of that row.
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
    assert.match(html, /text-red-300[^"]*"><span aria-hidden="true">●<\/span> restarting · crash-looping/);
  });

  test("a starting health check is not painted red", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "starting" },
    });
    assert.match(html, /text-stone-300[^"]*"><span aria-hidden="true">●<\/span> running · health check starting/);
    assert.doesNotMatch(html, /text-red-300[^"]*"><span aria-hidden="true">●<\/span> running/);
  });

  test("a never-deployed container is not painted red", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "not-created" },
    });
    // Both surfaces that carry the tone: the header pill and the last hop's sub-line.
    assert.match(html, /data-state-pill><span aria-hidden="true">●<\/span> not deployed<\/span>/);
    assert.match(html, /text-stone-300[^"]*"><span aria-hidden="true">●<\/span> not deployed/);
    assert.doesNotMatch(html, /text-red-300[^"]*"><span aria-hidden="true">●<\/span> not deployed/);
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
    const legacy: Site = { hostname: "legacy.lychee.land", type: "reverse-proxy", target: "3001", framework: "nextjs" };
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

  test("a failing container gets its logs hint beside the hop that reports it", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "exited" } });
    const card = html.split("Request path</h3>")[1].split("</section>")[0];
    // Remediation sits with the failure, not as a numbered setup step that
    // appears and disappears with container state.
    assert.match(card, /id="cmd-logs"/);
    assert.match(card, /docker compose -p app-lychee-land logs/);
    const steps = html.split("Manual steps</h3>")[1].split("</section>")[0];
    assert.doesNotMatch(steps, /cmd-logs/);
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
    assert.doesNotMatch(html, /● Running on localhost/);
  });
});

describe("renderSiteDetail manual steps", () => {
  test("gives the DNS command permanently, not only in a post-create banner", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(
      html,
      /cloudflared tunnel route dns 11111111-2222-3333-4444-555555555555 blog\.lychee\.land/,
    );
    assert.match(html, /id="cmd-dns"/);
    assert.match(html, /data-copy-target="cmd-dns"/);
  });

  test("leads with the dashboard CNAME and its copyable target", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const card = html.split("Manual steps</h3>")[1].split("</section>")[0];
    assert.match(
      card,
      /<pre id="cmd-dns-target"[^>]*>11111111-2222-3333-4444-555555555555\.cfargotunnel\.com<\/pre>/,
    );
    assert.match(card, /data-copy-target="cmd-dns-target"/);
    assert.match(card, /Copy CNAME target/);
    assert.match(card, /proxied/);
    assert.match(card, /<code[^>]*>blog<\/code>/);
  });

  test("puts the dashboard instruction before the route dns command", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const card = html.split("Manual steps</h3>")[1].split("</section>")[0];
    const dashboard = card.indexOf("Cloudflare dashboard");
    const target = card.indexOf('id="cmd-dns-target"');
    const command = card.indexOf('id="cmd-dns"');
    assert.ok(dashboard >= 0 && dashboard < target && target < command);
  });

  test("explains the host keeps no account certificate for route dns", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /cloudflared tunnel login/);
    assert.match(html, /keeps no account certificate/);
  });

  test("without a tunnel id there is no concrete target", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.doesNotMatch(html, /cfargotunnel/);
    assert.doesNotMatch(html, /cmd-dns-target/);
    assert.match(
      html,
      /Create the DNS record, once per hostname — add a CNAME for this hostname to your tunnel from the Cloudflare dashboard\. Until it exists/,
    );
  });

  test("warns that a missing DNS record leaves the site unreachable despite passing checks", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /checks lychee itself, never Cloudflare/);
  });

  test("never emits a command with an empty tunnel id", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.doesNotMatch(html, /tunnel route dns\s+[a-z]/);
    assert.doesNotMatch(html, /id="cmd-dns"/);
    assert.match(html, /Cloudflare dashboard/);
  });

  test("a static site is told to replace the placeholder it is serving", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // add-site writes a placeholder index.html, so the site works immediately
    // and nothing otherwise prompts the user to notice what is actually live.
    assert.match(html, /Put your site's files in \/var\/www\/blog\.lychee\.land\//);
    assert.match(html, /placeholder index\.html/);
  });

  test("a reverse-proxy site is not told about a placeholder it never got", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    // add-site only writes the placeholder for static sites.
    assert.doesNotMatch(html, /placeholder/);
  });

  test("a static site gets no container steps", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.doesNotMatch(html, /docker compose up/);
    assert.doesNotMatch(html, /cmd-logs|compose -p/);
  });

  test("a plain proxy gets no docker step — lychee-admin scaffolded nothing", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } });
    assert.doesNotMatch(html, /docker compose/);
  });

  test("manual steps carries nothing the page automates", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    const card = html.split("Manual steps</h3>")[1].split("</section>")[0];
    // Deploying lives in From a repository; only DNS is manual
    // in the strong sense for a scaffolded proxy site.
    assert.match(card, /cmd-dns/);
    assert.doesNotMatch(card, /docker compose/);
    assert.doesNotMatch(card, /cmd-compose|cmd-logs/);
  });

  test("a healthy site is not offered the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      resource: RUNNING_RESOURCE,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.doesNotMatch(html, /cmd-logs|compose -p/);
  });

  test("a broken container adds the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "exited" } });
    assert.match(html, /docker compose -p app-lychee-land logs/);
    assert.match(html, /id="cmd-logs"/);
  });

  test("an unreadable container status is not treated as broken", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "unknown" } });
    assert.doesNotMatch(html, /cmd-logs|compose -p/);
  });

  test("a never-deployed container is not asked to read logs it has none of", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "not-created" } });
    assert.doesNotMatch(html, /cmd-logs/);
  });
});

const SCAFFOLD = {
  buildCommand: "npm run build",
  runCommand: "npm start",
};

describe("renderSiteDetail deploy", () => {
  test("nothing is hidden behind a disclosure widget", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "not-created" },
      scaffold: SCAFFOLD,
    });
    // Split in two steps with an assert between, because the negative
    // assertions below pass trivially on an empty string.
    const [, afterHeading] = html.split("From a repository</h3>");
    assert.ok(afterHeading, "expected a From a repository card to anchor to");
    const card = afterHeading.split("</section>")[0];
    assert.doesNotMatch(card, /<details/);
    assert.doesNotMatch(card, /<summary/);
  });

  test("build and run are data, not instructions", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "not-created" },
      scaffold: SCAFFOLD,
    });
    // buildCommand and runCommand describe what the Dockerfile bakes in. A
    // copy button on them reads as "run these", which is wrong.
    assert.match(html, /npm run build/);
    assert.match(html, /npm start/);
    assert.doesNotMatch(html, /cmd-build|cmd-run/);
    assert.match(html, /not commands to run yourself/);
  });

  test("no state offers a docker compose command to run by hand", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "not-created" },
      scaffold: SCAFFOLD,
    });
    // The reconciler runs the container now; the operator never does.
    assert.doesNotMatch(html, /cmd-compose/);
    assert.doesNotMatch(html, /docker compose up/);
    assert.doesNotMatch(html, />Deploy<\/h3>/);
  });

  test("the runbook comes before what the image does, not after", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "not-created" },
      scaffold: SCAFFOLD,
    });
    const tag = html.indexOf("cmd-tag");
    assert.notEqual(tag, -1, "expected the tag command");
    assert.ok(tag < html.indexOf("npm run build"), "the steps must precede the baked-in commands");
  });

  test("every copy button inside a code block shares one right-hand inset", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "not-created" },
      scaffold: SCAFFOLD,
      scaffoldFiles: [{ name: "Dockerfile", content: "FROM node:20-alpine\n" }],
    });
    // The DNS command, the tag command and each file carry one. They drifted
    // once (right-1.5 vs right-2) and 2px was noticeable. Files pin top-right
    // and commands centre-right; the inset is the same either way.
    const insets = [...html.matchAll(/class="[^"]*\babsolute\b[^"]*?(right-[^\s"]+)/g)].map((m) => m[1]);
    assert.ok(insets.length >= 3, `expected 3+ positioned copy buttons, saw ${insets.length}`);
    assert.equal(
      new Set(insets).size,
      1,
      `copy button insets drifted apart: ${[...new Set(insets)].join(", ")}`,
    );
  });

  test("a site with no scaffold gets no repository card at all", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.doesNotMatch(html, />From a repository<\/h3>/);
    assert.doesNotMatch(html, /cmd-build|cmd-run|cmd-compose|cmd-tag/);
  });

  test("copy buttons are distinguishable by name", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      scaffold: SCAFFOLD,
      scaffoldFiles: [
        { name: "Dockerfile", content: "FROM x\n" },
        { name: ".dockerignore", content: "node_modules\n" },
      ],
    });
    const labels = [...html.matchAll(/aria-label="(Copy [^"]*)"/g)].map((match) => match[1]);
    assert.ok(labels.length >= 4, "expected at least four copy buttons");
    assert.equal(new Set(labels).size, labels.length, `duplicate copy labels: ${labels.join(", ")}`);
  });
});

describe("renderSiteDetail danger zone", () => {
  test("isolates the destructive action in a titled block with its consequence stated", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /Danger/);
    assert.match(html, /reloads Caddy, then restarts the sites tunnel/);
  });

  test("the Danger card names the sites tunnel, not the tunnel", () => {
    const body = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(body, /restarts the sites tunnel/);
    assert.doesNotMatch(body, /then restarts the tunnel\b/);
  });

  test("the trigger keeps the generic label; the confirm names the hostname", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // Scoped to each button's own markup rather than counting the string
    // page-wide. Each regex walks forward from a button's identifying
    // attribute without crossing a </button>, so it can only match that
    // button's own label.
    const labelled = (attr: string, label: string) =>
      new RegExp(`${attr}(?:(?!<\\/button>)[\\s\\S])*${label}<\\/button>`);
    assert.match(html, labelled('data-open-dialog="confirm-remove-dialog"', "Remove site"));
    assert.match(html, labelled('id="confirm-remove-submit"', "Remove blog\\.lychee\\.land"));
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

  test("the step list is addressable per step and reads as an ordered column", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const list = listById(html, "confirm-remove-steps");
    // An ordered sequence is a column; the 2x2 grid was the layout for peers.
    assert.doesNotMatch(list, /sm:grid-cols-2/);
    for (const id of ["caddyfile", "tunnel", "caddy", "cloudflared"]) {
      assert.match(list, new RegExp(`data-step-id="${id}"`));
    }
    assert.ok(tagById(html, "confirm-remove-outcome"));
  });

  test("the outcome region starts neutral — it is a progress surface before it is ever a failure surface", () => {
    // Red styling is added only once a failure actually lands; a successful
    // removal must never flash a red panel on its way through.
    const outcome = tagById(renderSiteDetail(STATIC_SITE, OPTS), "confirm-remove-outcome");
    assert.doesNotMatch(outcome, /text-red-300/);
    assert.doesNotMatch(outcome, /bg-red-950/);
  });

  test("a site with files offers the delete checkbox naming the exact path", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, filesExist: true });
    assert.match(html, /id="confirm-remove-delete-files"[\s\S]{0,200}?\/var\/www\/blog\.lychee\.land/);
  });

  test("a plain proxy has no directory, so no delete checkbox", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.doesNotMatch(html, /id="confirm-remove-delete-files"/);
  });

  test("a static site whose directory is gone offers nothing to delete", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, filesExist: false });
    assert.doesNotMatch(html, /id="confirm-remove-delete-files"/);
  });

  test("a legacy Next.js directory keeps the checkbox and its running-container warning", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      filesExist: true,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /id="confirm-remove-delete-files"[\s\S]{0,200}?\/var\/www\/app\.lychee\.land/);
    assert.match(html, /docker compose down/);
    assert.match(html, /won't stop it/);
  });

  test("a Next.js site with no directory has no checkbox and no docker compose instruction", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "not-created" } });
    const dialog = html.match(/<dialog id="confirm-remove-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
    assert.ok(dialog, "no dialog to check");
    assert.doesNotMatch(dialog, /id="confirm-remove-delete-files"/);
    assert.doesNotMatch(dialog, /docker compose/);
  });

  test("an attached site lists retiring its declaration fifth, and says what that does", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      resource: { name: "app-lychee-land", repo: "app-site", version: "0.2.0", result: "deployed" },
      status: { kind: "container", state: "running", health: "healthy" },
    });
    const dialog = html.match(/<dialog id="confirm-remove-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
    assert.match(dialog, /<dialog[^>]*data-attached="true"/);
    const list = listById(html, "confirm-remove-steps");
    assert.deepEqual([...list.matchAll(/data-step-id="([a-z]+)"/g)].map((m) => m[1]), ["caddyfile", "tunnel", "caddy", "cloudflared", "declaration"]);
    assert.match(list, />5\.<\/span><span>app-lychee-land\.yml set to state: absent<\/span>/);
    assert.match(dialog, /reconciler takes the container down on its next run/);
    assert.doesNotMatch(dialog, /docker compose/);
  });

  test("an unattached site keeps four steps and no attached marker", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "not-created" } });
    const dialog = html.match(/<dialog id="confirm-remove-dialog"[^>]*>/)?.[0] ?? "";
    assert.ok(dialog, "no dialog to check");
    assert.doesNotMatch(dialog, /data-attached/);
    assert.doesNotMatch(listById(html, "confirm-remove-steps"), /data-step-id="declaration"/);
  });
});

describe("remove dialog accessibility", () => {
  test("the dialog names itself with its own heading", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const dialog = tagById(html, "confirm-remove-dialog");
    assert.match(dialog, /aria-labelledby="confirm-remove-title"/);
    // The id must actually exist, or the reference dangles and the dialog
    // still announces as bare "dialog".
    assert.ok(tagById(html, "confirm-remove-title"));
  });

  test("focus opens on Cancel, never on the delete-files checkbox", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const cancel = html.match(/<button[^>]*data-close-dialog="confirm-remove-dialog"[^>]*>/);
    assert.ok(cancel, "no Cancel button was rendered");
    assert.match(cancel[0], /\bautofocus\b/);
    assert.doesNotMatch(tagById(renderSiteDetail(STATIC_SITE, { ...OPTS, filesExist: true }), "confirm-remove-delete-files"), /\bautofocus\b/);
  });

  test("the delete-files checkbox uses the system accent and focus ring", () => {
    const checkbox = tagById(renderSiteDetail(STATIC_SITE, { ...OPTS, filesExist: true }), "confirm-remove-delete-files");
    assert.match(checkbox, /accent-rose-400/);
    assert.match(checkbox, /focus-visible:outline-rose-400/);
  });

  test("the confirm button names the site, not the category", () => {
    const html = renderSiteDetail(PROXY_SITE, OPTS);
    const button = html.match(/<button[^>]*id="confirm-remove-submit"[\s\S]*?<\/button>/);
    assert.ok(button, "no confirm button was rendered");
    assert.match(button[0], /Remove api\.lychee\.land/);
    // The trigger keeps the generic label; only the confirm is specific. A
    // fixed-length window here would be brittle: the trash icon's inline SVG
    // sits between the attribute and the text and alone runs past 200 chars,
    // so bound the scan at the button's own closing tag instead.
    assert.match(
      html,
      /data-open-dialog="confirm-remove-dialog"(?:(?!<\/button>)[\s\S])*Remove site/,
    );
  });
});

describe("renderSiteDetail escaping", () => {
  test("escapes a hostile hostname and healthcheckPath everywhere they render", () => {
    // Hostnames are validated on write (POST /sites), but GET
    // /api/sites/:hostname answers with whatever a hand-edited Caddyfile
    // contains, and healthcheckPath is explicitly unvalidated on this read
    // path (see src/routes/sites.ts). This locks in the spec's no-exceptions
    // escaping rule across both fields.
    const hostileSite: Site = {
      hostname: "<script>alert(1)</script>.lychee.land",
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

describe("the not-found page", () => {
  // Same bug the site list's error banner had (SiteListMarkup.test.tsx):
  // mx-auto on a child of the shell's flex-column <main> shrink-wraps instead
  // of centring a block.
  test("the not-found wrapper spans its column instead of shrink-wrapping", () => {
    const html = renderSiteNotFound("nope.lychee.land");
    const wrapper = html.match(/<div class="[^"]*max-w-\[640px\][^"]*"/);
    assert.ok(wrapper, "no width-capped wrapper rendered");
    assert.match(wrapper[0], /\bw-full\b/);
  });
});

describe("hardening: browser defaults never carry the design", () => {
  // The add page's half of this test is in AddSiteMarkup.test.tsx.
  test("every interactive element the design draws gets the project focus ring", () => {
    const notFound = renderSiteNotFound("nope.lychee.land");
    const back = notFound.match(/<a href="\/"[^>]*>/);
    assert.ok(back, "no back link rendered");
    assert.match(back[0], /focus-visible:outline-rose-400/);
  });

  test("the breadcrumb separator is decoration, not content", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const seps = [...html.matchAll(/<span[^>]*>\/<\/span>/g)];
    assert.ok(seps.length > 0, "no breadcrumb separator rendered");
    for (const sep of seps) assert.match(sep[0], /aria-hidden="true"/);
  });
});

describe("small-text ramp", () => {
  test("card labels sit at the 12px step in Chalk-adjacent stone", () => {
    const html = renderSiteDetail(NEXT_SITE, OPTS);
    assert.match(html, /class="font-mono text-\[0\.75rem\] font-medium uppercase tracking-\[0\.1em\] text-stone-300/);
    // Anchored to <h3> (the card-label element) rather than the whole
    // document, where a regex here would be vacuous.
    const headings = html.match(/<h3[^>]*>/g) ?? [];
    assert.ok(headings.length > 0, "no card-label headings were rendered");
    for (const heading of headings) assert.doesNotMatch(heading, /text-\[0\.625rem\]/);
  });

  test("the Danger heading reuses the card-label constant instead of restating it", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const danger = html.match(/<h3[^>]*>Danger<\/h3>/);
    assert.ok(danger, "no Danger heading was rendered");
    // Same size and tracking as every other card label; only the colour differs.
    assert.match(danger[0], /text-\[0\.75rem\]/);
    assert.match(danger[0], /text-red-300/);
  });

  test("hop labels and step badges clear the 11px floor", () => {
    const html = renderSiteDetail(NEXT_SITE, OPTS);
    assert.match(html, /text-\[0\.6875rem\][^"]*uppercase tracking-\[0\.09em\]/);
    assert.doesNotMatch(html, /text-\[0\.6rem\]/);
    assert.doesNotMatch(html, /text-\[0\.625rem\]/);
  });

  test("small mono values sit on the code step, not the pill step", () => {
    const html = renderSiteDetail(NEXT_SITE, OPTS);
    assert.doesNotMatch(html, /text-\[0\.65rem\]/);
  });
});

describe("the Prune control", () => {
  test("the prune button is the compact secondary by default; primary only when asked", () => {
    assert.ok(renderPruneControl("gone-lychee-land", "primary").includes(`class="${BUTTON_PRIMARY_COMPACT}"`));
    const markup = renderPruneControl("gone-lychee-land");
    assert.ok(markup.includes(`class="${BUTTON_SECONDARY_COMPACT}"`));
    assert.doesNotMatch(markup, /min-h-10/);
    for (const sizing of ["min-h-8", "px-3", "py-1.5", "text-[0.8rem]"]) {
      assert.ok(BUTTON_SECONDARY_COMPACT.split(" ").includes(sizing), sizing);
      assert.ok(BUTTON_OFFER.split(" ").includes(sizing), sizing);
    }
    for (const gone of ["min-h-10", "px-4", "py-2.5", "text-sm"]) assert.ok(!BUTTON_SECONDARY_COMPACT.split(" ").includes(gone), gone);
    for (const quiet of ["bg-stone-600", "text-stone-50", "hover:bg-stone-700", "border-none", "disabled:text-stone-500", "focus-visible:outline-rose-400"]) {
      assert.ok(BUTTON_SECONDARY_COMPACT.split(" ").includes(quiet), quiet);
    }
  });

  test("the caption joins with a non-breaking space and keeps the separator with what it introduces", () => {
    const html = renderPruneControl("gone-lychee-land");
    assert.match(html, /lychee-resources&nbsp;<span class="whitespace-nowrap">· once its container is confirmed down<\/span>/);
    assert.doesNotMatch(html, / · /);
  });
});

describe("renderSiteDetail request path: live unit state", () => {
  /** The markup of one hop, found by its label, up to the next hop's label. */
  function hop(html: string, label: string): string {
    const labels = ["Cloudflare DNS", "Tunnel", "Caddy", "Your files", "Your app"];
    const start = html.indexOf(`>${label}</p>`);
    assert.ok(start >= 0, `hop ${label} present`);
    const ends = labels.map((l) => html.indexOf(`>${l}</p>`, start + 1)).filter((i) => i > start);
    return html.slice(start, ends.length ? Math.min(...ends) : undefined);
  }
  const dot = '<span aria-hidden="true">●</span>';

  test("hops 2 and 3 carry live status in the shared vocabulary and tones; hop 1 stays static", () => {
    const html = renderSiteDetail(STATIC_SITE, {
      ...OPTS,
      unitStates: {
        "cloudflared-sites.service": { status: "running", since: null },
        "caddy.service": { status: "exited", since: null },
      },
    });
    const tunnel = hop(html, "Tunnel");
    const caddy = hop(html, "Caddy");
    assert.ok(tunnel.includes(`${TONE_TEXT.ok} m-0" data-hop-status>${dot} running`));
    assert.ok(caddy.includes(`${TONE_TEXT.bad} m-0" data-hop-status>${dot} exited`));

    const dns = hop(html, "Cloudflare DNS");
    assert.ok(!dns.includes("data-hop-status"));
    assert.ok(!dns.includes(dot));
    for (const tone of Object.values(TONE_TEXT)) assert.ok(!dns.includes(tone), "no tone class on hop 1");
    assert.ok(!/running|exited|unknown|starting|responding/.test(dns));
    assert.ok(dns.includes("manual step"));
  });

  test("a failed or empty read renders both hops unknown and neutral, and the page renders", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, unitStates: {} });
    for (const label of ["Tunnel", "Caddy"]) {
      const h = hop(html, label);
      assert.ok(h.includes(`${TONE_TEXT.neutral} m-0" data-hop-status>${dot} unknown`), label);
      assert.ok(!h.includes(TONE_TEXT.bad), label);
    }
    assert.ok(!hop(html, "Cloudflare DNS").includes("data-hop-status"));
  });

  test("starting is neutral, never bad", () => {
    const html = renderSiteDetail(STATIC_SITE, {
      ...OPTS,
      unitStates: { "caddy.service": { status: "starting", since: null } },
    });
    const caddy = hop(html, "Caddy");
    assert.ok(caddy.includes(`${TONE_TEXT.neutral} m-0" data-hop-status>${dot} starting`));
  });

  test("no unitStates at all renders no hop status", () => {
    assert.ok(!renderSiteDetail(STATIC_SITE, OPTS).includes("data-hop-status"));
  });
});

const FILES = [
  { name: "Dockerfile", content: "FROM node:20-alpine AS deps\nWORKDIR /app\n" },
  { name: ".dockerignore", content: "node_modules\n.next\n" },
  { name: ".github/workflows/release.yml", content: "on:\n  push:\n    tags: ['v*.*.*']\n" },
];
const BASE = { ...OPTS, scaffold: { buildCommand: "npm run build", runCommand: "npm start" }, scaffoldFiles: FILES };
const RESOURCE = { name: "app-lychee-land", repo: "app-site" };

function requestPath(html: string): string {
  const [, after] = html.split(">Request path</h3>");
  assert.ok(after, "expected a Request path card");
  return after.split("</section>")[0];
}
function whatToCheck(html: string): string {
  const [, after] = requestPath(html).split(">What to check<");
  assert.ok(after, "expected a What to check block");
  return after;
}

describe("what to check under the chain", () => {
  const EXITED = { status: "exited", since: null } as const;
  const RUNNING = { status: "running", since: null } as const;

  test("a failed first deploy: the reason and the journal sit under the chain", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" },
      status: { kind: "failed" },
    });
    const w = whatToCheck(html);
    assert.match(w, /your app/);
    assert.match(w, /Deploying <span[^>]*>0\.1\.0<\/span> failed at this step:/);
    assert.match(w, /Start the container: exit 1/);
    assert.match(w, /id="cmd-reconcile-log"/);
    assert.match(w, /journalctl -u lychee-reconcile/);
  });

  test("the tunnel and Caddy entries use the phrase", () => {
    const w = whatToCheck(
      renderSiteDetail(PROXY_SITE, {
        ...OPTS,
        status: { kind: "tcp", responding: true },
        unitStates: {
          "cloudflared-sites.service": { status: "restarting", since: null },
          "caddy.service": EXITED,
        },
      }),
    );
    assert.ok(w.includes("The sites tunnel keeps restarting, so Cloudflare has nowhere to send this site's requests."));
    assert.ok(w.includes("Caddy has stopped. Every site on lychee goes through it, so all of them are down, not only this one."));
    assert.equal(w.split("Its last 50 log lines usually show why:").length - 1, 2);
  });

  test("the container entry uses the phrase and a bounded log command", () => {
    const w = whatToCheck(
      renderSiteDetail(NEXT_SITE, {
        ...OPTS,
        resource: RUNNING_RESOURCE,
        status: { kind: "container", state: "running", health: "unhealthy" },
      }),
    );
    assert.ok(w.includes("The container is running but failing its health check. Its last 100 log lines usually show why:"));
    assert.ok(w.includes("docker compose -p app-lychee-land logs --tail 100"));
  });

  const TWO_UNIT = "journalctl -u lychee-reconcile -u lychee-reconcile-app --since &quot;1 hour ago&quot;";
  const RECOVER = "To recover, publish a fixed tag; From a repository below offers it to deploy.";

  test("a failed first deploy points at both reconciler units for the last hour, then recovery", () => {
    const w = whatToCheck(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" },
        status: { kind: "failed" },
      }),
    );
    assert.ok(w.includes("The reconciler retries this tag on every run; its log for the last hour shows each attempt:"));
    const pre = w.slice(w.indexOf('id="cmd-reconcile-log"'));
    assert.ok(pre.includes(TWO_UNIT));
    assert.ok(w.indexOf(RECOVER) > w.indexOf(TWO_UNIT));
  });

  test("a failed deploy with no target still offers recovery", () => {
    const w = whatToCheck(
      renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RESOURCE, result: "failed" }, status: { kind: "failed" } }),
    );
    assert.ok(w.includes("The last deploy failed"));
    assert.ok(w.includes("The reconciler's log for the last hour has the latest attempt:"));
    assert.ok(!w.includes("retries this tag"));
    assert.ok(w.includes(RECOVER));
    assert.ok(w.includes(TWO_UNIT));
    assert.ok(w.includes(RECOVER));
  });

  test("the plain-proxy entry says how to read the listen check", () => {
    const w = whatToCheck(renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } }));
    assert.ok(
      w.includes(
        "lychee-admin only routes requests to this port; whatever serves it is started outside the app. This shows what is listening there, and prints only its header row if nothing is:",
      ),
    );
  });

  test("no entry overpromises", () => {
    const pages = [
      renderSiteDetail(PROXY_SITE, {
        ...OPTS,
        status: { kind: "tcp", responding: false },
        unitStates: { "caddy.service": EXITED, "cloudflared-sites.service": { status: "restarting", since: null } },
      }),
      renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "paused" } }),
      renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RESOURCE, result: "failed" }, status: { kind: "failed" } }),
    ];
    for (const html of pages) {
      const w = whatToCheck(html);
      assert.ok(!w.includes("says why"));
      assert.ok(!w.includes("isn't running"));
    }
  });

  test("a plain proxy not responding gets a listen check", () => {
    const w = whatToCheck(renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } }));
    assert.match(w, /id="cmd-fix-listen"/);
    assert.match(w, /ss -ltn 'sport = :4000'/);
    assert.match(w, /localhost:4000/);
  });

  test("a stopped Caddy gets its journal", () => {
    const w = whatToCheck(
      renderSiteDetail(PROXY_SITE, {
        ...OPTS,
        status: { kind: "tcp", responding: true },
        unitStates: { "caddy.service": EXITED, "cloudflared-sites.service": RUNNING },
      }),
    );
    assert.match(w, /id="cmd-fix-caddy"/);
    assert.match(w, /journalctl -u caddy -n 50/);
    assert.doesNotMatch(w, /cmd-fix-tunnel/);
  });

  test("entries run in request order", () => {
    const w = whatToCheck(
      renderSiteDetail(PROXY_SITE, {
        ...OPTS,
        status: { kind: "tcp", responding: false },
        unitStates: { "caddy.service": EXITED, "cloudflared-sites.service": EXITED },
      }),
    );
    assert.ok(w.indexOf("cmd-fix-tunnel") < w.indexOf("cmd-fix-caddy"));
    assert.ok(w.indexOf("cmd-fix-caddy") < w.indexOf("cmd-fix-listen"));
    assert.match(w, /journalctl -u cloudflared-sites -n 50/);
    assert.ok(w.includes("The sites tunnel has stopped"));
    assert.ok(w.includes("Caddy has stopped"));
  });

  test("an exited container keeps its logs command, now in the list", () => {
    const w = whatToCheck(renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "exited" } }));
    assert.match(w, /id="cmd-logs"/);
    assert.match(w, /docker compose -p app-lychee-land logs/);
  });

  test("a healthy site and neutral units render no block", () => {
    const proxy = renderSiteDetail(PROXY_SITE, {
      ...OPTS,
      status: { kind: "tcp", responding: true },
      unitStates: { "caddy.service": RUNNING, "cloudflared-sites.service": { status: "unknown", since: null } as const },
    });
    assert.doesNotMatch(requestPath(proxy), /What to check/);
    const next = renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } });
    assert.doesNotMatch(requestPath(next), /What to check/);
  });

  test("a failed status renders the journal even when the resource's result has moved on", () => {
    const w = whatToCheck(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "awaiting-image", target: "0.1.0" },
        status: { kind: "failed" },
      }),
    );
    assert.match(w, /journalctl -u lychee-reconcile/);
    assert.match(w, /failed/);
  });

  test("the failed step stays escaped under the chain", () => {
    const w = whatToCheck(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "failed", target: "0.1.0", failedStep: "Pull the image: <manifest> unknown" },
        status: { kind: "failed" },
      }),
    );
    assert.ok(w.includes("Pull the image: &lt;manifest&gt; unknown"));
    assert.ok(!w.includes("<manifest>"));
  });

  test("no unit states means no unit entries", () => {
    const w = whatToCheck(renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } }));
    assert.match(w, /cmd-fix-listen/);
    assert.doesNotMatch(w, /cmd-fix-caddy/);
    assert.doesNotMatch(w, /cmd-fix-tunnel/);
  });

  test("a hairline separates the fixes from the detail rows that follow", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, result: "failed", target: "0.1.0" },
      status: { kind: "failed" },
    });
    const rp = requestPath(html);
    const fixesAt = rp.indexOf(">What to check<");
    const rowAt = rp.indexOf(">framework<");
    assert.ok(fixesAt > -1 && rowAt > fixesAt, "expected detail rows after the fixes");
    assert.ok(rp.slice(fixesAt, rowAt).includes("h-px bg-stone-700"));
  });

  test("a static site gets the Caddy entry", () => {
    const w = whatToCheck(
      renderSiteDetail(STATIC_SITE, { ...OPTS, unitStates: { "caddy.service": EXITED, "cloudflared-sites.service": RUNNING } }),
    );
    assert.match(w, /journalctl -u caddy -n 50/);
  });
});

describe("renderSiteDetail from a repository", () => {
  function card(html: string): string {
    const [, after] = html.split(">From a repository</h3>");
    assert.ok(after, "expected a From a repository card");
    return after.split("</section>")[0];
  }

  test("not attached: every scaffold file in full, with nothing folded or scrolled", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } });
    const c = card(html);
    for (const file of FILES) {
      assert.ok(c.includes(`>${file.name}<`), `missing ${file.name}`);
      assert.ok(c.includes(file.content.trimEnd().replace(/'/g, "'")), `${file.name} not in full`);
    }
    assert.doesNotMatch(c, /<details|role="tab"|max-h-|overflow-y/);
    assert.match(c, /git tag v0\.1\.0 &amp;&amp; git push origin v0\.1\.0/);
  });

  test("done steps 1 and 2 fold at rest, with the file names in step 1's summary", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, available: "0.1.0", result: "awaiting-image" },
      status: { kind: "awaiting-image" },
    });
    const c = card(html);
    assert.equal((c.match(/<details/g) ?? []).length, 2);
    assert.doesNotMatch(c, /<details[^>]*\sopen/);
    const summary = c.match(/<summary[\s\S]*?<\/summary>/)![0];
    assert.ok(summary.includes("Dockerfile, .dockerignore, release.yml"));
    for (const file of FILES) assert.ok(c.includes(file.content.trimEnd().replace(/'/g, "'")), `${file.name} not in full`);
    const outside = c.replace(/<details[\s\S]*?<\/details>/g, "");
    assert.ok(outside.includes("app-lychee-land.yml"), "step 3's attached line stays visible");
  });

  test("steps not yet done never fold", () => {
    const notAttached = card(renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } }));
    assert.doesNotMatch(notAttached, /<details/);
    const attached = card(renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } }));
    assert.doesNotMatch(attached, /<details/);
  });

  test("not attached: the attach control fixes the ghcr prefix beside the input and is the page's ember action", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } });
    const c = card(html);
    assert.match(c, /data-attach="app\.lychee\.land"/);
    assert.match(c, />ghcr\.io\/lycheehome\/</);
    assert.match(c, /name="repo"/);
    assert.ok(c.includes(BUTTON_PRIMARY), "Attach should be the primary button");
    assert.match(c, /LycheeHome/);
  });

  test("no Next.js state tells the operator to run docker compose up", () => {
    for (const opts of [
      { ...BASE, status: { kind: "container", state: "not-created" } as const },
      { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } as const },
      { ...BASE, resource: { ...RESOURCE, version: "0.2.0", result: "deployed" }, status: { kind: "container", state: "exited" } as const },
    ]) {
      assert.doesNotMatch(renderSiteDetail(NEXT_SITE, opts), /docker compose up/);
    }
  });

  test("a Next.js site with no directory has no files row", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } });
    assert.doesNotMatch(html, /files<\/span>/);
  });

  test("awaiting image is neutral in the pill and on the last hop", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } });
    assert.ok(html.includes(`<span class="${TONE_PILL.neutral}" data-state-pill><span aria-hidden="true">●</span> awaiting image</span>`));
    assert.match(html, new RegExp(`${TONE_TEXT.neutral}[^"]*"><span aria-hidden="true">●</span> awaiting first image`));
    assert.doesNotMatch(html, /text-red-300[^"]*"><span aria-hidden="true">●<\/span> awaiting/);
  });

  test("attached: resource and image join the request path's detail rows", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } });
    const path = html.split("Request path</h3>")[1].split("</section>")[0];
    assert.match(path, /resource<\/span><span[^>]*><a [^>]*>app-lychee-land</);
    assert.match(path, /image<\/span><span[^>]*>ghcr\.io\/lycheehome\/app-site</);
  });

  test("attached before the first tick: no Attach, no Deploy, and the reason nothing is offered yet", () => {
    const c = card(renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } }));
    assert.doesNotMatch(c, /data-attach/);
    assert.doesNotMatch(c, /data-deploy=/);
    assert.match(c, /next run/);
  });

  test("awaiting image with a tag on offer: the board's offer line ends the runbook", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, result: "awaiting-image", available: "0.1.0" },
      status: { kind: "awaiting-image" },
    });
    const c = card(html);
    const offer = c.match(/<p[^>]*data-offer>[\s\S]*?<\/p>/);
    assert.ok(offer, "expected the offer line");
    assert.match(offer[0], /0\.1\.0 available/);
    assert.ok(offer[0].includes(`class="${BUTTON_PRIMARY_COMPACT}" data-deploy="app-lychee-land" data-deploy-tag="0.1.0">Deploy 0.1.0</button>`));
    assert.ok(c.lastIndexOf("data-offer") > c.indexOf("ghcr.io/lycheehome/app-site"), "the offer comes after the attach step");
    // Not in the page header, and the header holds no Ember: the offer has it.
    const header = html.split("Request path</h3>")[0];
    assert.doesNotMatch(header, /data-deploy/);
    assert.ok(!header.split(/[\s"]+/).includes("bg-rose-400"));
  });

  test("a failed first deploy offers the newer tag as the page's Primary", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1" },
      status: { kind: "failed" },
    });
    assert.ok(card(html).includes(`class="${BUTTON_PRIMARY_COMPACT}" data-deploy="app-lychee-land" data-deploy-tag="0.1.1">Deploy 0.1.1</button>`));
  });

  test("an installed version with a newer tag keeps the board's offer emphasis", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RUNNING_RESOURCE, available: "0.3.0" },
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.ok(card(html).includes(`class="${BUTTON_OFFER}" data-deploy="app-lychee-land" data-deploy-tag="0.3.0">Deploy 0.3.0</button>`));
  });

  test("running: the scaffold and setup steps are gone; the resource facts stay", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, version: "0.2.0", result: "deployed" },
        status: { kind: "container", state: "running", health: "healthy" },
      }),
    );
    assert.doesNotMatch(c, /Dockerfile<|release\.yml|data-attach|git tag/);
    assert.match(c, /running<\/span><span[^>]*>0\.2\.0</);
    assert.match(c, /LycheeHome\/app-site/);
    assert.doesNotMatch(c, /data-deploy=/);
  });

  test("a deploy already requested is not offered a second time", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "awaiting-image", available: "0.1.0", target: "0.1.0" },
        status: { kind: "awaiting-image" },
      }),
    );
    assert.doesNotMatch(c, /data-deploy=/);
    assert.match(c, /0\.1\.0 requested/);
  });

  // The clone may be stale (refreshed on page load, but bounded), so the page
  // warns and the writer's own fresh pull decides; it refuses with the same
  // prune reason if the retired file is still there.
  test("detached: renders as not attached, Attach enabled, with the prune warning tied to it", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, detached: true, status: { kind: "container", state: "not-created" } });
    const c = card(html);
    assert.doesNotMatch(html, /awaiting image/);
    assert.match(c, /app-lychee-land\.yml/);
    // Shortened by the retired-state spec: Prune is in the notice above now.
    assert.match(c, /Prune it above; pressing Attach checks again\./);
    assert.doesNotMatch(c, /before re-attaching/);
    const button = c.match(/<button[^>]*type="submit"[^>]*>/);
    assert.ok(button);
    assert.doesNotMatch(button[0], /\sdisabled(?=[\s>/])/);
    assert.match(button[0], /aria-describedby="attach-warning"/);
    const input = c.match(/<input[^>]*id="attach-repo"[^>]*>/);
    assert.ok(input);
    assert.doesNotMatch(input[0], /\sdisabled(?=[\s>/])/);
    assert.match(input[0], /aria-describedby="attach-prefix attach-warning"/);
    assert.match(c, /id="attach-warning"/);
  });

  // Since the retired-state spec (2026-10-26) the Prune control is the page's
  // retired notice's, above the request path, not the card's.
  test("detached: the page's retired notice carries the Prune control; the card does not", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, detached: true, status: { kind: "retired" } });
    const c = card(html);
    assert.doesNotMatch(c, /data-prune=/);
    assert.ok(html.includes(renderPruneControl("app-lychee-land", "primary")));
    const button = html.match(/<button[^>]*data-prune="app-lychee-land"[^>]*>([^<]*)<\/button>/);
    assert.ok(button);
    assert.equal(button[1], "Prune old declaration");
    assert.match(button[0], /type="button"/);
    assert.ok(button[0].includes(`class="${BUTTON_PRIMARY_COMPACT}"`));
    // Above the request path, so the reason and the action come first.
    assert.ok(html.indexOf("data-prune=") < html.indexOf("Request path"));
  });

  test("detached: Attach steps back to Secondary and stays enabled", () => {
    const c = card(renderSiteDetail(NEXT_SITE, { ...BASE, detached: true, status: { kind: "container", state: "not-created" } }));
    assert.ok(c.includes(`<button type="submit" class="${BUTTON_SECONDARY}" aria-describedby="attach-warning">Attach repository</button>`));
  });

  test("not detached: no Prune control, whatever the resource's state", () => {
    const pages = [
      renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } }),
      renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RESOURCE, result: "awaiting-image" }, status: { kind: "awaiting-image" } }),
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, version: "0.2.0", result: "deployed" },
        status: { kind: "container", state: "running", health: "healthy" },
      }),
    ];
    for (const html of pages) assert.doesNotMatch(html, /data-prune/);
  });

  test("a failed first deploy: the Deploy step points up and offers nothing", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.0", failedStep: "Pull the image: <manifest> unknown" },
      status: { kind: "failed" },
    });
    const c = card(html);
    assert.doesNotMatch(c, /data-deploy-failed/);
    assert.doesNotMatch(c, /journalctl/);
    assert.match(c, /the reason is under the request path/);
    assert.doesNotMatch(c, /0\.1\.0 requested/);
    assert.doesNotMatch(c, /data-deploy=/);
    assert.match(html, /data-state-pill><span aria-hidden="true">●<\/span> failed<\/span>/);
  });

  test("a failed deploy with no failed step still names the tag and the journal", () => {
    const w = whatToCheck(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "failed", target: "0.1.0" },
        status: { kind: "failed" },
      }),
    );
    assert.match(w, /data-deploy-failed/);
    assert.match(w, /journalctl -u lychee-reconcile/);
    assert.doesNotMatch(w, /data-failed-step/);
  });

  test("a failed redeploy shows the failure line in the collapsed card", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, version: "0.1.0", target: "0.2.0", result: "failed", failedStep: "Start the container: exit 1" },
        status: { kind: "container", state: "running" },
      }),
    );
    assert.match(c, /data-deploy-failed/);
    assert.match(c, /0\.2\.0/);
    assert.match(c, /Start the container: exit 1/);
    assert.match(c, /journalctl -u lychee-reconcile/);
  });

  test("blocked shows its gate and no failure line", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, version: "0.1.0", target: "0.2.0", result: "blocked", gate: "job test concluded: failure" },
        status: { kind: "container", state: "running" },
      }),
    );
    assert.match(c, /job test concluded: failure/);
    assert.doesNotMatch(c, /data-deploy-failed/);
  });

  test("a running, skipped site shows no gate line", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RUNNING_RESOURCE, result: "skipped", gate: "pin unchanged (0.2.0)", available: "0.3.0" },
        status: { kind: "container", state: "running" },
      }),
    );
    assert.doesNotMatch(c, /data-gate/);
  });

  test("a requested tag whose deploy failed shows the gate, not a promise of the next run", () => {
    for (const result of ["failed", "blocked"]) {
      const c = card(
        renderSiteDetail(NEXT_SITE, {
          ...BASE,
          resource: { ...RESOURCE, result, available: "0.1.0", target: "0.1.0", gate: "health check failed after install" },
          status: { kind: "awaiting-image" },
        }),
      );
      assert.match(c, /health check failed after install/, result);
      assert.doesNotMatch(c, /pulls it and starts the container/, result);
    }
  });

  test("a failed first deploy with a newer tag: the pointer, then the offer", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" },
        status: { kind: "failed" },
      }),
    );
    assert.match(c, /the reason is under the request path/);
    assert.doesNotMatch(c, /data-deploy-failed/);
    assert.match(c, /0\.1\.1 available/);
    assert.match(c, /data-deploy="app-lychee-land"/);
    assert.match(c, /data-deploy-tag="0\.1\.1"/);
    assert.doesNotMatch(c, /No tag found/);
  });

  test("a failed redeploy with a newer tag: the failure line, then the offer", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, version: "0.1.0", target: "0.2.0", available: "0.2.1", result: "failed", failedStep: "Start the container: exit 1" },
        status: { kind: "container", state: "running" },
      }),
    );
    assert.match(c, /data-deploy-failed/);
    assert.match(c, /0\.2\.1 available/);
    assert.match(c, /data-deploy="app-lychee-land"/);
    assert.ok(c.indexOf("data-deploy-failed") < c.indexOf("data-offer"));
  });

  test("a failed deploy whose only tag is the one that failed offers nothing", () => {
    for (const resource of [
      { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.0" },
      { ...RESOURCE, version: "0.1.0", target: "0.2.0", available: "0.2.0", result: "failed" },
    ]) {
      const c = card(renderSiteDetail(NEXT_SITE, { ...BASE, resource, status: { kind: "failed" } }));
      // A first deploy points up at the chain; a redeploy keeps its line here.
      assert.match(c, "version" in resource ? /data-deploy-failed/ : /the reason is under the request path/);
      assert.doesNotMatch(c, /data-offer|data-deploy=/);
    }
  });

  test("with no tag found, step 3 says so once, names both causes and offers the change; Deploy does not repeat it", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "awaiting-image", gate: "no image yet" },
        status: { kind: "awaiting-image" },
      }),
    );
    assert.equal(c.match(/No image found at/g)?.length, 1);
    assert.match(c, /No image found at <span[^>]*>ghcr\.io\/lycheehome\/app-site<\/span> yet/);
    assert.match(c, /v0\.1\.0/);
    assert.match(c, /repository name is wrong/);
    assert.doesNotMatch(c, /No tag found/);
    // An awaiting-image run is waiting, not in trouble: its gate sentence is not shown.
    assert.doesNotMatch(c, /no image yet|data-gate/);
    const form = c.match(/<form[^>]*data-change-repository="app\.lychee\.land"[\s\S]*?<\/form>/);
    assert.ok(form, "no change-repository form");
    const input = form[0].match(/<input[^>]*>/);
    assert.ok(input);
    assert.match(input[0], /name="repo"/);
    assert.match(input[0], /value="app-site"/);
    assert.match(input[0], /aria-describedby="change-repo-prefix"/);
    assert.match(form[0], />ghcr\.io\/lycheehome\/</);
    assert.ok(form[0].includes(`class="${BUTTON_SECONDARY}">Change repository</button>`));
    assert.match(form[0], /id="change-repo-error" role="alert"/);
  });

  test("an unreadable declaration (no repo) offers no change control", () => {
    const c = card(
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, repo: null, result: "awaiting-image" },
        status: { kind: "awaiting-image" },
      }),
    );
    assert.doesNotMatch(c, /data-change-repository/);
    assert.match(c, /No tag found for <span[^>]*>the image<\/span> yet/);
  });

  test("a running resource that fails points at its logs by project, not a /var/www directory", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, version: "0.2.0", result: "deployed" },
      status: { kind: "container", state: "exited" },
    });
    assert.match(html, /docker compose -p app-lychee-land logs/);
    assert.doesNotMatch(html, /in \/var\/www\/app\.lychee\.land\//);
  });
});

describe("card order", () => {
  const order = (html: string, ...labels: string[]) => labels.map((l) => html.indexOf(`>${l}</h3>`));
  const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || xs[i - 1] < x));

  test("an attached site puts Manual steps after the repository card", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } });
    assert.ok(ascending(order(html, "Request path", "From a repository", "Manual steps", "Danger")));
  });

  test("static, plain-proxy and unattached sites keep Manual steps second", () => {
    const static_ = renderSiteDetail(STATIC_SITE, OPTS);
    assert.ok(ascending(order(static_, "Request path", "Manual steps", "Danger")));
    const proxy = renderSiteDetail(PROXY_SITE, OPTS);
    assert.ok(ascending(order(proxy, "Request path", "Manual steps", "Danger")));
    const next = renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } });
    assert.ok(ascending(order(next, "Request path", "Manual steps", "From a repository", "Danger")));
  });

  test("a detached site keeps Manual steps before the repository card", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...BASE, detached: true, status: { kind: "container", state: "not-created" } });
    assert.ok(ascending(order(html, "Request path", "Manual steps", "From a repository", "Danger")));
  });

  test("the Danger paragraph is held to a reading measure", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html.split(">Danger</h3>")[1], /^\s*<p class="[^"]*max-w-\[25rem\]/);
  });

  test("no id repeats on a detail page", () => {
    const EXITED = { status: "exited", since: null } as const;
    const pages = [
      renderSiteDetail(STATIC_SITE, OPTS),
      renderSiteDetail(PROXY_SITE, {
        ...OPTS,
        status: { kind: "tcp", responding: false },
        unitStates: { "cloudflared-sites.service": EXITED, "caddy.service": EXITED },
      }),
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" },
        status: { kind: "failed" },
      }),
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, version: "0.2.0", result: "deployed" },
        status: { kind: "container", state: "exited" },
      }),
      renderSiteDetail(NEXT_SITE, {
        ...BASE,
        resource: { ...RESOURCE, available: "0.1.0", result: "awaiting-image" },
        status: { kind: "awaiting-image" },
      }),
    ];
    for (const html of pages) {
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(ids.length, new Set(ids).size, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
    }
  });
});

describe("a site page links to its board row", () => {
  test("a site page's resource row links to its board row", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      resource: RUNNING_RESOURCE,
      status: { kind: "container", state: "running" },
    });
    assert.ok(html.includes('href="/services#service-app-lychee-land"'));
  });
});

describe("failed redeploy of an installed site", () => {
  test("renders the reconcile-log command once, in the repository card only", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, version: "0.1.0", target: "0.2.0", result: "failed" },
      status: { kind: "failed" },
    });
    assert.equal(html.match(/id="cmd-reconcile-log"/g)?.length, 1);
  });
});

describe("one Ember action per site page", () => {
  const emberCount = (html: string): number =>
    (html.match(/<(?:a|button)\b[^>]*>/g) ?? []).filter((tag) => {
      const cls = tag.match(/\sclass="([^"]*)"/);
      return cls !== null && cls[1].split(" ").includes("bg-rose-400");
    }).length;
  const page = (site: Site, opts: object): string => renderSiteDetail(site, { ...BASE, ...opts });

  const zero: Array<[string, string]> = [
    ["a proxy not responding", page(PROXY_SITE, { status: { kind: "tcp", responding: false } })],
    ["starting", page(NEXT_SITE, { resource: RUNNING_RESOURCE, status: { kind: "container", state: "running", health: "starting" } })],
    ["unknown", page(NEXT_SITE, { resource: RUNNING_RESOURCE, status: { kind: "container", state: "unknown" } })],
  ];
  for (const [name, html] of zero) {
    test(`${name}: no Ember below the header`, () => assert.equal(emberCount(html), 0));
  }

  const atMostOne: Array<[string, string]> = [
    ["a static site", page(STATIC_SITE, {})],
    ["a proxy responding", page(PROXY_SITE, { status: { kind: "tcp", responding: true } })],
    ["unattached", page(NEXT_SITE, { status: { kind: "container", state: "not-created" } })],
    ["detached", page(NEXT_SITE, { detached: true, status: { kind: "container", state: "not-created" } })],
    ["awaiting image with a tag on offer", page(NEXT_SITE, { resource: { ...RESOURCE, result: "awaiting-image", available: "0.1.0" }, status: { kind: "awaiting-image" } })],
    ["a failed first deploy with a newer tag", page(NEXT_SITE, { resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1" }, status: { kind: "failed" } })],
    ["running with a newer tag", page(NEXT_SITE, { resource: { ...RUNNING_RESOURCE, available: "0.3.0" }, status: { kind: "container", state: "running", health: "healthy" } })],
    ["starting", zero[1][1]],
    ["unknown", zero[2][1]],
  ];
  for (const [name, html] of atMostOne) {
    test(`${name}: at most one Ember below the header`, () => assert.ok(emberCount(html) <= 1, `${emberCount(html)}`));
  }
});

describe("DNS step and Danger card copy", () => {
  const DNS = "Until it exists, the site can't be reached from the internet even while every check on this page passes: lychee-admin checks lychee itself, never Cloudflare.";
  const S1 = "Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the sites tunnel.";
  const S2 = "It then retires the site's declaration, which stops its container.";
  const S3 = "The site's files stay unless you tick the box when you confirm.";
  const S4 = "lychee-admin never touches the DNS record; delete it in Cloudflare afterwards.";

  function danger(html: string): string {
    const [, after] = html.split(">Danger</h3>");
    assert.ok(after, "expected a Danger card");
    const m = after.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    assert.ok(m, "expected a Danger paragraph");
    return m[1];
  }

  const dnsPages: [string, string][] = [
    ["with a tunnel id", renderSiteDetail(STATIC_SITE, OPTS)],
    ["apex", renderSiteDetail(APEX_SITE, OPTS)],
    ["without a tunnel id", renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" })],
  ];
  for (const [name, html] of dnsPages) {
    test(`DNS step ${name} states what lychee-admin checks`, () => {
      assert.ok(html.includes(DNS));
      assert.ok(!html.includes("still reports the site running"));
    });
  }

  test("static site with files: sentences 1, 3, 4", () => {
    assert.equal(danger(renderSiteDetail(STATIC_SITE, { ...OPTS, filesExist: true })), `${S1} ${S3} ${S4}`);
  });
  test("plain proxy: sentences 1 and 4", () => {
    assert.equal(danger(renderSiteDetail(PROXY_SITE, OPTS)), `${S1} ${S4}`);
  });
  test("attached Next.js without files: sentences 1, 2, 4", () => {
    assert.equal(danger(renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE })), `${S1} ${S2} ${S4}`);
  });
  test("attached Next.js with files: sentences 1, 2, 3, 4", () => {
    assert.equal(danger(renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE, filesExist: true })), `${S1} ${S2} ${S3} ${S4}`);
  });
  test("no Danger paragraph says 'unless you ask otherwise'", () => {
    for (const html of [renderSiteDetail(STATIC_SITE, OPTS), renderSiteDetail(NEXT_SITE, { ...BASE, resource: RESOURCE })]) {
      assert.ok(!danger(html).includes("unless you ask otherwise"));
    }
  });
});

describe("the requested line", () => {
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const repoCard = (html: string) => html.split("From a repository</h3>")[1].split("</section>")[0];
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  test("renderRequestedLine is a focusable status line with no button", () => {
    const html = renderRequestedLine("0.3.0");
    assert.ok(html.includes("data-requested"));
    assert.ok(html.includes('role="status"'));
    assert.ok(html.includes('tabindex="-1"'));
    assert.equal(text(html), "0.3.0 requested · applies on the next run");
    assert.ok(!html.includes("<button"));
  });

  // Its page half asserted the requested-line template carried the same hook;
  // the template is gone (ruling R3), so the hook is checked on the line.
  test("the tag has its own hook, so a client can set it without erasing 'requested'", () => {
    const line = renderRequestedLine("0.3.0");
    assert.match(line, /<span data-requested-tag>0\.3\.0<\/span>/);
    assert.equal(text(line), "0.3.0 requested · applies on the next run");
    // What role="status" announces: tags removed with nothing inserted in their place.
    assert.equal(line.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(), "0.3.0 requested · applies on the next run");
  });

  test("the first-deploy step shows the requested line in the offer's place", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RESOURCE, result: "awaiting-image", available: "0.1.0", requestedTag: "0.1.0" },
      status: { kind: "awaiting-image" },
    });
    const c = repoCard(html);
    assert.ok(c.includes("data-requested"));
    assert.ok(!c.includes("data-deploy"));
  });

  test("the installed card shows the requested line in the offer's place", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...BASE,
      resource: { ...RUNNING_RESOURCE, available: "0.3.0", requestedTag: "0.3.0" },
    });
    const c = repoCard(html);
    assert.ok(c.includes("data-requested"));
    assert.ok(!c.includes("data-deploy"));
  });

  // Was "the template rides on every site page that renders an offer, once,
  // and on no other". app.js cloned that template after a Deploy; the client
  // re-reads the page instead (ruling R3), so no site page carries it now.
  // The board still does, and its rule is in BoardMarkup.test.tsx.
  test("no site page carries the requested-line template, with an offer or without", () => {
    const site = renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RUNNING_RESOURCE, available: "0.3.0" } });
    assert.ok(site.includes("data-offer"), "the offer case must render an offer");
    assert.equal(count(site, "<template"), 0);
    assert.equal(count(renderSiteDetail(STATIC_SITE, OPTS), "<template"), 0);
  });
});

describe("Smoke sentences hold a readable measure", () => {
  /**
   * Every Smoke paragraph (Body classes, not mono) that lacks the 25rem cap.
   * The one sanctioned narrower measure is the Empty State component's
   * `max-w-[46ch]` (about 62 letters), which DESIGN.md's Body entry names.
   */
  function uncappedSmoke(html: string): string[] {
    return (html.match(/<p\b[^>]*>/g) ?? []).filter((tag) => {
      const cls = tag.match(/class="([^"]*)"/)?.[1] ?? "";
      const capped = cls.includes("max-w-[25rem]") || cls.includes("max-w-[46ch]");
      return cls.includes("text-stone-400") && cls.includes("text-[0.8rem]") && !cls.includes("font-mono") && !capped;
    });
  }

  // The services board's own case is in BoardMarkup.test.tsx, the sites
  // list's in SiteListMarkup.test.tsx, the add page's in
  // AddSiteMarkup.test.tsx, and the measure's own value in
  // src/views/shared.test.ts.
  const pages: [string, string][] = [
    ["static site", renderSiteDetail(STATIC_SITE, OPTS)],
    ["proxy not responding", renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } })],
    ["unattached Next.js (full runbook)", renderSiteDetail(NEXT_SITE, { ...BASE, status: { kind: "container", state: "not-created" } })],
    ["awaiting image, 0.1.0 on offer", renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RESOURCE, result: "awaiting-image", available: "0.1.0" }, status: { kind: "awaiting-image" } })],
    ["failed first deploy", renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" }, status: { kind: "failed" } })],
    ["running, 0.3.0 on offer", renderSiteDetail(NEXT_SITE, { ...BASE, resource: { ...RUNNING_RESOURCE, available: "0.3.0" }, status: { kind: "container", state: "running" } })],
    ["retired declaration", renderSiteDetail(NEXT_SITE, { ...BASE, detached: true, status: { kind: "container", state: "not-created" } })],
  ];

  for (const [name, html] of pages) {
    test(`every Smoke paragraph carries the measure: ${name}`, () => {
      assert.deepEqual(uncappedSmoke(html), []);
    });
  }

  test("the Danger paragraph drops its 70ch, which held about 95 letters", () => {
    for (const [, html] of pages) assert.ok(!html.includes("max-w-[70ch]"));
  });

  test("an offer row is a flex row of controls, not prose, and stays uncapped", () => {
    const html = pages[5][1];
    const offer = html.match(/<p\b[^>]*data-offer[^>]*>/)?.[0];
    assert.ok(offer, "expected an offer line");
    assert.ok(!offer.includes("max-w-[25rem]"));
  });
});

// Were html.test.ts's tests of the server's error page (renderErrorPage),
// carried over when it was retired: CaddyfileError is that page's body, on a
// site's page and on the add page alike.
describe("the unreadable-Caddyfile body", () => {
  const body = (message: string) => renderToStaticMarkup(<CaddyfileError message={message} />);

  test("escapes the message", () => {
    const html = body(`<script>alert("x")</script>`);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert/);
  });

  // The list's half: SiteListMarkup.test.tsx pins its error box to ERROR_BOX too.
  test("uses the same error-box classes the site list uses for its error", () => {
    assert.equal(body("boom").match(/<p class="([^"]*bg-red-950[^"]*)"/)?.[1], ERROR_BOX);
  });

  test("has no Sites heading and no empty state, and links back to the list", () => {
    const html = body("boom");
    assert.doesNotMatch(html, /<h2[^>]*>\s*Sites\s*<\/h2>/);
    assert.doesNotMatch(html, /id="empty-state"/);
    assert.match(html, /<a href="\/"[^>]*>← sites<\/a>/);
  });
});
