import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { withoutHeader } from "../dev/testHelpers";
import { renderAddSite, renderSiteDetail, renderSiteList } from "./html";

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

const OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  caddyfilePath: "/etc/caddy/Caddyfile",
  sites: [STATIC_SITE, APEX_SITE, PROXY_SITE, NEXT_SITE],
};

const SITES = [STATIC_SITE, APEX_SITE, PROXY_SITE, NEXT_SITE];

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

describe("renderAddSite heading", () => {
  test("the add-site page's heading is a documented ramp step", () => {
    const html = renderAddSite([], "lyly.dev", {});
    assert.match(html, /<h2 class="font-mono text-\[1\.7rem\]/);
    assert.doesNotMatch(html, /text-\[1\.35rem\]/);
  });
});

describe("accessible status and error wiring", () => {
  test("the port field points at the message that explains a conflict", () => {
    const input = tagById(renderAddSite(SITES, "lyly.dev", {}), "port-field");
    assert.match(input, /aria-describedby="port-error"/);
  });

  test("the port conflict message is the element the field names", () => {
    const span = tagById(renderAddSite(SITES, "lyly.dev", {}), "port-error");
    assert.match(span, /class="[^"]*port-error/);
  });

  test("a failed submit is announced, not only shown", () => {
    const p = tagById(renderAddSite(SITES, "lyly.dev", {}), "add-site-error");
    assert.match(p, /role="alert"/);
  });

  test("copy outcomes get a polite live region, since the icon swap is silent", () => {
    const span = tagById(renderSiteDetail(STATIC_SITE, OPTS), "copy-status");
    assert.match(span, /role="status"/);
    assert.match(span, /aria-live="polite"/);
    assert.match(span, /class="[^"]*sr-only/);
  });

  test("the live region is on every page the shell renders, not only the detail page", () => {
    const span = tagById(renderSiteList(SITES, {}), "copy-status");
    assert.match(span, /aria-live="polite"/);
  });
});

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

describe("the hostname switcher", () => {
  const switcher = (html: string) => {
    const match = html.match(/<details id="hostname-switcher"[\s\S]*?<\/details>/);
    assert.ok(match, "expected a hostname switcher");
    return match[0];
  };

  test("sits in the breadcrumb and lists every managed site", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    for (const site of OPTS.sites) assert.match(block, new RegExp(site.hostname));
  });

  test("names the current site in the trigger, and marks only its row", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    const summary = block.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    assert.match(summary, /blog/);
    const currentRows = block.match(/aria-current="page"/g) ?? [];
    assert.equal(currentRows.length, 1);
  });

  test("tells a screen reader what the trigger does, not just where it is", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.match(block, /<summary[^>]*aria-label="Switch site[^"]*blog\.lyly\.dev"/);
  });

  test("never truncates a hostname — the control exists to pick one", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.doesNotMatch(block, /truncate/);
  });

  test("dims the shared suffix in Smoke, not Smoke Deep, at row size", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    const rows = block.match(/<ul[\s\S]*<\/ul>/)?.[0] ?? "";
    assert.match(rows, /text-stone-400/);
    assert.doesNotMatch(rows, /text-stone-500/);
  });

  test("carries a type hint per row and no status", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.match(block, /:4000/);
    // The pill span emits the HTML entity "&#9679;", never the literal glyph
    // — see the same convention noted where the status pill regex lives above.
    assert.doesNotMatch(block, /&#9679;/);
    assert.doesNotMatch(block, /running|responding|unhealthy/);
  });

  test("is a surface containing rows, so it takes the 10px radius", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    const panel = block.match(/<ul[^>]*>/)?.[0] ?? "";
    assert.match(panel, /rounded-\[10px\]/);
  });

  test("marks the current row without the proxy pill's ember fill", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.doesNotMatch(block, /bg-rose-950/);
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

  test("a failing container gets its logs hint beside the hop that reports it", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "exited" } });
    const card = html.split("Request path</h3>")[1].split("</section>")[0];
    // Remediation sits with the failure, not as a numbered setup step that
    // appears and disappears with container state.
    assert.match(card, /id="cmd-logs"/);
    assert.match(card, /docker compose logs/);
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

  test("a static site is told to replace the placeholder it is serving", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // add-site writes a placeholder index.html, so the site works immediately
    // and nothing otherwise prompts the user to notice what is actually live.
    assert.match(html, /Put your site's files in \/var\/www\/blog\.lyly\.dev\//);
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
    assert.doesNotMatch(html, /docker compose logs/);
  });

  test("a plain proxy gets no docker step — lyly-admin scaffolded nothing", () => {
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
    // Deploying is the workflow's job and lives in Deploy; only DNS is manual
    // in the strong sense for a scaffolded proxy site.
    assert.match(card, /cmd-dns/);
    assert.doesNotMatch(card, /docker compose/);
    assert.doesNotMatch(card, /cmd-compose|cmd-logs/);
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

  test("a never-deployed container is not asked to read logs it has none of", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "not-created" } });
    assert.doesNotMatch(html, /cmd-logs/);
  });
});

const SCAFFOLD = {
  buildCommand: "npm run build",
  runCommand: "npm start",
  deployWorkflow: "name: Deploy app.lyly.dev\non:\n  push:\n    branches: [main]\n",
};

/**
 * The header band carries its own wordmark link and "sites"/"add site" nav
 * items, none of which have anything to do with the Deploy card these tests
 * check. withoutHeader() strips it before asserting so its markup can't
 * collide with assertions that are really about that card.
 */
describe("renderSiteDetail deploy", () => {
  test("nothing is hidden behind a disclosure widget", () => {
    const html = withoutHeader(
      renderSiteDetail(NEXT_SITE, {
        ...OPTS,
        status: { kind: "container", state: "running", health: "healthy" },
        scaffold: SCAFFOLD,
      }),
    );
    // Anchored to the Deploy card: the breadcrumb's hostname switcher is its
    // own, unrelated <details> elsewhere on the page.
    //
    // Split in two steps, with an assert.ok in between, rather than chaining
    // straight through to a slice: the doesNotMatch calls below pass
    // trivially on an empty string, so if "Deploy</h3>" ever stopped
    // appearing this needs to fail with a clear message here, not let the
    // second .split silently produce "" (or throw an opaque TypeError on
    // undefined) and have the negative assertions pass having proven nothing.
    const [, afterDeployHeading] = html.split("Deploy</h3>");
    assert.ok(afterDeployHeading, "expected a Deploy card to anchor to");
    const card = afterDeployHeading.split("</section>")[0];
    assert.doesNotMatch(card, /<details/);
    assert.doesNotMatch(card, /<summary/);
    // Deploy is a plain card like Request path and Manual steps.
    assert.match(html, />Deploy<\/h3>/);
  });

  test("the workflow block is its natural height, with no nested vertical scroll", () => {
    const html = withoutHeader(
      renderSiteDetail(NEXT_SITE, {
        ...OPTS,
        status: { kind: "container", state: "running", health: "healthy" },
        scaffold: SCAFFOLD,
      }),
    );
    // Anchored to the Deploy card itself, not the whole page: the breadcrumb's
    // hostname switcher is a legitimate <details> with its own scrollable
    // dropdown elsewhere on this page, and a page-wide assertion would trip on
    // that unrelated control instead of testing what this card does.
    //
    // Same two-step split as the test above: the doesNotMatch calls below
    // pass trivially on an empty string, so the anchor is checked explicitly
    // before trusting a negative result against the slice.
    const [, afterDeployHeading] = html.split("Deploy</h3>");
    assert.ok(afterDeployHeading, "expected a Deploy card to anchor to");
    const card = afterDeployHeading.split("</section>")[0];
    // No max-height and no vertical overflow inside the card: a scrollbar
    // inside a page you are already scrolling is worse than a tall block, and
    // this is a file you may want to read rather than only copy.
    assert.doesNotMatch(card, /max-h-/);
    assert.doesNotMatch(card, /overflow-y-auto|overflow-auto/);
    // Long lines still scroll sideways, which preformatted content needs.
    assert.match(card, /id="github-workflow-yaml"[^>]*\boverflow-x-auto\b/);
  });

  test("only the workflow is copyable; build and run are data, not instructions", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    assert.match(html, /data-copy-target="github-workflow-yaml"/);
    // buildCommand and runCommand describe what the Dockerfile bakes in and
    // the workflow triggers. A copy button on them reads as "run these", which
    // is both wrong and the reverse of the actual order.
    assert.match(html, /npm run build/);
    assert.match(html, /npm start/);
    assert.doesNotMatch(html, /cmd-build|cmd-run/);
    assert.match(html, /not commands to run yourself/);
  });

  test("deploy offers the by-hand alternative for anyone not using Actions", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    const card = html.split(">Deploy</h3>")[1];
    assert.match(card, /Not using GitHub Actions\?/);
    assert.match(card, /id="cmd-compose"/);
    assert.match(card, /docker compose up -d --build/);
  });

  test("the workflow comes before what the image does, not after", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    // Ordering carried the wrong implication: commands first read as "do these,
    // then paste the workflow", when the workflow is what causes them to run.
    assert.ok(
      html.indexOf("github-workflow-yaml") < html.indexOf("npm run build"),
      "the workflow must precede the baked-in commands",
    );
  });

  test("every copy button inside a code block shares one right-hand inset", () => {
    const html = withoutHeader(
      renderSiteDetail(NEXT_SITE, {
        ...OPTS,
        status: { kind: "container", state: "running", health: "healthy" },
        scaffold: SCAFFOLD,
      }),
    );
    // The single-line boxes and the multi-line workflow block position their
    // buttons differently vertically — centred vs top-pinned — but the
    // horizontal inset has to agree or the buttons visibly step in and out.
    // They drifted once (right-1.5 vs right-2) and 2px was noticeable.
    // Scoped past the header, whose own markup carries no absolutely
    // positioned elements today but is stripped anyway for the same reason
    // as the tests above.
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
    const checkbox = tagById(html, "confirm-remove-delete-files");
    assert.doesNotMatch(checkbox, /\bautofocus\b/);
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

/**
 * Anchored to the server-rendered notice, which is where the ?created=1
 * message lives. A page-wide match on "not responding" would pass on the
 * strength of the header pill and the request-path hop, both of which already
 * say it — and this helper throws when the element is missing, so a message
 * that stopped being rendered fails rather than vacuously passing.
 */
function notice(html: string): string {
  // Non-greedy, stopping at the first </div>: the notice contains a span and a
  // button but no nested div, so this is exactly the notice element.
  const match = /<div id="page-notice"[\s\S]*?<\/div>/.exec(html);
  assert.ok(match, "expected a page-notice element");
  return match[0];
}

/** The client toast, which is a different element and always starts empty. */
function toast(html: string): string {
  const match = /<div id="flash-banner"[\s\S]*?<\/div>/.exec(html);
  assert.ok(match, "expected a flash-banner element");
  return match[0];
}

describe("the ?created=1 notice", () => {
  test("a static site is told its placeholder is already live", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, created: true });
    assert.match(notice(html), /Added blog\.lyly\.dev/);
    assert.match(notice(html), /serving the placeholder page it created/);
    assert.match(notice(html), /Manual steps has the DNS record/);
  });

  test("a plain proxy is told why it reads as not responding", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, created: true });
    assert.match(notice(html), /routing is live/);
    assert.match(notice(html), /nothing is listening on port 4000 yet/);
    assert.match(notice(html), /not responding until you start your process/);
  });

  test("a scaffolded site is told why it reads as not deployed", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, created: true });
    assert.match(notice(html), /routing is live/);
    assert.match(notice(html), /scaffold is at \/var\/www\/app\.lyly\.dev/);
    assert.match(notice(html), /not deployed until you add your source/);
  });

  test("it is dismissible when created, and absent otherwise", () => {
    const created = renderSiteDetail(PROXY_SITE, { ...OPTS, created: true });
    assert.match(notice(created), /id="page-notice-close"/);
    assert.doesNotMatch(renderSiteDetail(PROXY_SITE, OPTS), /id="page-notice"/);
  });

  test("it takes layout space above the heading instead of covering it", () => {
    const created = renderSiteDetail(PROXY_SITE, { ...OPTS, created: true });
    // The regression this split exists to prevent: as a fixed element centred
    // on the viewport, this three-line message landed on top of the breadcrumb
    // and the hostname. In flow and ahead of them, it can't.
    assert.doesNotMatch(notice(created), /\bfixed\b/);
    assert.doesNotMatch(notice(created), /\babsolute\b/);
    assert.match(created, /id="page-notice"[\s\S]*id="site-hostname"/);
  });

  test("the client toast stays a separate, empty, hidden element either way", () => {
    for (const html of [
      renderSiteDetail(PROXY_SITE, { ...OPTS, created: true }),
      renderSiteDetail(PROXY_SITE, OPTS),
    ]) {
      assert.match(toast(html), /id="flash-banner" class="hidden/);
      assert.match(toast(html), /id="flash-banner-message"><\/span>/);
    }
  });
});

describe("status on the site list", () => {
  // The pill entity, not the literal glyph: the rounded-full pill spans in
  // this module (the header pill at data-state-pill, and this one) render
  // "&#9679;" verbatim, the same convention as renderDetailHeader's pill —
  // see the "data-state-pill>&#9679;" assertions above. Only the request-path
  // hop's plain-text sub-line uses the literal "●" character.
  test("a proxy site's card carries its canonical status word", () => {
    const html = renderSiteList([PROXY_SITE], { [PROXY_SITE.hostname]: { kind: "tcp", responding: true } });
    assert.match(html, /&#9679; responding/);
  });

  test("a container site reports the worst-case word, not the lifecycle one", () => {
    const html = renderSiteList([NEXT_SITE], {
      [NEXT_SITE.hostname]: { kind: "container", state: "running", health: "unhealthy" },
    });
    assert.match(html, /&#9679; unhealthy/);
  });

  test("starting is neutral, not red", () => {
    const html = renderSiteList([NEXT_SITE], {
      [NEXT_SITE.hostname]: { kind: "container", state: "running", health: "starting" },
    });
    assert.match(html, /text-stone-300[^"]*"[^>]*>&#9679; starting/);
    assert.doesNotMatch(html, /text-red-300[^"]*"[^>]*>&#9679; starting/);
  });

  test("a static site gets no status pill — nothing checks one", () => {
    const html = renderSiteList([STATIC_SITE], {});
    assert.doesNotMatch(html, /&#9679;/);
  });

  test("a site with no status entry renders no pill rather than a guess", () => {
    const html = renderSiteList([PROXY_SITE], {});
    assert.doesNotMatch(html, /&#9679;/);
  });
});
