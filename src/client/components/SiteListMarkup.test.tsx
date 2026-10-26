import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostProblem, SitesPayload, SiteStatus, SiteSummary } from "../../shared/sites";
import { BUTTON_PRIMARY, ERROR_BOX, TONE_PILL } from "../../views/shared";
import { SiteList } from "./SiteList";

/*
 * The sites list's markup rules, against the React SiteList. These were
 * src/views/html.test.ts's tests of the server's list renderer, carried over
 * when that renderer was retired: same names, same fixtures, same assertions.
 * Only the renderer behind `listMarkup` below changed (it took the retired
 * renderer's arguments, less the notice and the shell). The page around
 * the list (the frame, #page-notice) is AppFrame's: src/client/AppFrame.test.tsx
 * and src/client/AppFrameParity.test.tsx.
 */

/**
 * The retired renderer's arguments, now building the payload the way
 * GET /api/sites does and rendering it with the React SiteList. There is no
 * notice argument: `?removed` is the server's #page-notice, outside the list.
 *
 * The markup is respelled where React and the server wrote the same DOM
 * differently, so the assertions read as they did: `●` as `&#9679;`,
 * `&#x27;` as `&#39;`, and an empty attribute (`data-hostname=""`) in its
 * bare form (`data-hostname`). Those spellings parse to identical nodes; the
 * frozen parity fixtures (SiteListParity.test.tsx) hold the rest of the
 * markup to what the server rendered.
 */
function listMarkup(
  sites: SiteSummary[],
  statuses: Record<string, SiteStatus>,
  domain: string,
  error?: string,
  problems: HostProblem[] = [],
): string {
  const payload: SitesPayload = { sites, statuses, problems, domain, caddyfileError: error ?? null };
  return renderToStaticMarkup(<SiteList payload={payload} />)
    .replace(/●/g, "&#9679;")
    .replace(/&#x27;/g, "&#39;")
    .replace(/ ([a-z][a-z-]*)=""/g, " $1");
}

const STATIC_SITE: SiteSummary = { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" };
const APEX_SITE: SiteSummary = { hostname: "lychee.land", type: "static", target: "/var/www/lychee.land" };
const PROXY_SITE: SiteSummary = { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" };
const NEXT_SITE: SiteSummary = { hostname: "app.lychee.land", type: "reverse-proxy", target: "3000", framework: "nextjs" };
const SITES = [STATIC_SITE, APEX_SITE, PROXY_SITE, NEXT_SITE];

/**
 * Returns the opening tag of the element with `id`, so an assertion is made
 * against that element rather than the whole list.
 */
function tagById(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]* id="${id}"[^>]*>`));
  assert.ok(match, `no element with id="${id}" was rendered`);
  return match[0];
}

/**
 * The markup of one site's row, from its opening anchor to the close of that
 * anchor. Rows contain no nested links, so the first "</a>" after the opening
 * tag is this row's own.
 */
function rowFor(html: string, hostname: string): string {
  const start = html.indexOf(`<a href="/sites/${encodeURIComponent(hostname)}"`);
  assert.notEqual(start, -1, `no row rendered for ${hostname}`);
  const end = html.indexOf("</a>", start);
  assert.notEqual(end, -1, `row for ${hostname} was never closed`);
  return html.slice(start, end);
}

/**
 * The inner markup of a row's hostname element, so the dimmed suffix can be
 * asserted without matching the identical dim class on the sub-line. Walks to
 * the matching close rather than the first one, since the apex domain renders
 * no nested span and a subdomain renders one.
 */
function hostnameCell(row: string): string {
  const open = row.match(/<span [^>]*data-hostname[^>]*>/);
  assert.ok(open, "no element carrying data-hostname was rendered in the row");
  const start = (open.index ?? 0) + open[0].length;
  let depth = 1;
  let cursor = start;
  for (;;) {
    const next = row.slice(cursor).match(/<\/?span\b/);
    assert.ok(next, "the hostname element was never closed");
    const at = cursor + (next.index ?? 0);
    depth += next[0] === "</span" ? -1 : 1;
    if (depth === 0) return row.slice(start, at);
    cursor = at + next[0].length;
  }
}

/**
 * Approximates the accessible name a link computes from its contents: text
 * nodes in order, minus anything aria-hidden, with whitespace collapsed the
 * way a screen reader collapses it. sr-only text IS included — Tailwind's
 * sr-only clips visually but leaves the node in the accessibility tree.
 */
function accessibleName(markup: string): string {
  return markup
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

describe("the site list heading", () => {
  test("one destination has one name", () => {
    const body = listMarkup(SITES, {}, "lychee.land");
    assert.doesNotMatch(body, /Existing sites/);
    assert.match(body, /<h2[^>]*>Sites<\/h2>/);
  });

  test("the list page with sites links Add site from its own section header, as a page", () => {
    const body = listMarkup(SITES, {}, "lychee.land");
    assert.match(body, /href="\/sites\/new"/);
    assert.doesNotMatch(body, /data-open-dialog="add-site-dialog"/);
  });
});

describe("status on the site list", () => {
  test("a retired site reads retired and a never-attached one not deployed, both in the neutral pill", () => {
    const gone: SiteSummary = { hostname: "gone.lychee.land", type: "reverse-proxy", target: "3400", framework: "nextjs" };
    const legacy: SiteSummary = { hostname: "legacy.lychee.land", type: "reverse-proxy", target: "3001", framework: "nextjs" };
    const html = listMarkup(
      [gone, legacy],
      { [gone.hostname]: { kind: "retired" }, [legacy.hostname]: { kind: "container", state: "not-created" } },
      "lychee.land",
    );
    assert.match(rowFor(html, gone.hostname), new RegExp(`class="${TONE_PILL.neutral.replace(/[[\]/.]/g, "\\$&")}"[^>]*>.*&#9679;</span> retired<`));
    assert.match(rowFor(html, legacy.hostname), /&#9679;<\/span> not deployed</);
    assert.doesNotMatch(rowFor(html, legacy.hostname), /retired/);
  });

  // Respelled to the server's "&#9679;" by listMarkup above. The dot is
  // wrapped in its own aria-hidden span so it never joins the accessible name.
  test("a proxy site's card carries its canonical status word", () => {
    const html = listMarkup([PROXY_SITE], { [PROXY_SITE.hostname]: { kind: "tcp", responding: true } }, "lychee.land");
    assert.match(html, /<span aria-hidden="true">&#9679;<\/span> responding/);
  });

  test("a container site reports the worst-case word, not the lifecycle one", () => {
    const html = listMarkup(
      [NEXT_SITE],
      { [NEXT_SITE.hostname]: { kind: "container", state: "running", health: "unhealthy" } },
      "lychee.land",
    );
    assert.match(html, /<span aria-hidden="true">&#9679;<\/span> unhealthy/);
  });

  test("starting is neutral, not red", () => {
    const html = listMarkup(
      [NEXT_SITE],
      { [NEXT_SITE.hostname]: { kind: "container", state: "running", health: "starting" } },
      "lychee.land",
    );
    assert.match(html, /text-stone-300[^"]*"[^>]*><span aria-hidden="true">&#9679;<\/span> starting/);
    assert.doesNotMatch(html, /text-red-300[^"]*"[^>]*><span aria-hidden="true">&#9679;<\/span> starting/);
  });

  test("a static site gets no status pill — nothing checks one", () => {
    const html = listMarkup([STATIC_SITE], {}, "lychee.land");
    assert.doesNotMatch(html, /&#9679;/);
  });

  test("a site with no status entry renders no pill rather than a guess", () => {
    const html = listMarkup([PROXY_SITE], {}, "lychee.land");
    assert.doesNotMatch(html, /&#9679;/);
  });

  test("the status dot is not part of any accessible name", () => {
    const html = listMarkup(SITES, { "api.lychee.land": { kind: "tcp", responding: false } }, "lychee.land");
    const dots = [...html.matchAll(/<span[^>]*>&#9679;/g)];
    assert.ok(dots.length > 0, "no status dot was rendered");
    for (const dot of dots) {
      assert.match(dot[0], /aria-hidden="true"/);
    }
  });

  test("status pills clear the 11px floor", () => {
    const html = listMarkup(SITES, { "api.lychee.land": { kind: "tcp", responding: false } }, "lychee.land");
    assert.match(html, /inline-flex items-center gap-1 shrink-0 font-mono text-\[0\.6875rem\] uppercase/);
  });
});

describe("the site list's ledger rows", () => {
  test("a subdomain's shared suffix is dimmed, as it already is on the detail page", () => {
    const cell = hostnameCell(rowFor(listMarkup([STATIC_SITE], {}, "lychee.land"), "blog.lychee.land"));
    assert.match(cell, /^blog<span [^>]*>\.lychee\.land<\/span>$/);
  });

  test("the apex domain has no shared suffix to dim, so it stays whole", () => {
    const cell = hostnameCell(rowFor(listMarkup([APEX_SITE], {}, "lychee.land"), "lychee.land"));
    assert.equal(cell, "lychee.land");
  });

  test("a static row states its path with no key label in front of it", () => {
    const row = rowFor(listMarkup([STATIC_SITE], {}, "lychee.land"), "blog.lychee.land");
    assert.match(row, /\/var\/www\/blog\.lychee\.land/);
    assert.doesNotMatch(row, /path:/);
  });

  test("a proxy row states one unbroken local address", () => {
    const row = rowFor(listMarkup([PROXY_SITE], {}, "lychee.land"), "api.lychee.land");
    assert.match(row, /localhost:4000/);
  });

  test("a framework proxy row still names its framework", () => {
    const row = rowFor(listMarkup([NEXT_SITE], {}, "lychee.land"), "app.lychee.land");
    assert.match(row, /localhost:3000/);
    assert.match(row, /Next\.js/);
  });

  test("every row keeps a right-aligned status slot", () => {
    const staticRow = rowFor(listMarkup([STATIC_SITE], {}, "lychee.land"), "blog.lychee.land");
    const proxyRow = rowFor(
      listMarkup([PROXY_SITE], { [PROXY_SITE.hostname]: { kind: "tcp", responding: true } }, "lychee.land"),
      "api.lychee.land",
    );
    for (const row of [staticRow, proxyRow]) {
      assert.match(row, /data-status-slot/);
      assert.match(row, /class="flex justify-end" data-status-slot/);
      assert.doesNotMatch(row, /min-w-\[9rem\]/);
    }
    assert.doesNotMatch(staticRow, /&#9679;/);
  });

  test("the list carries no type pill and no ember fill", () => {
    const html = listMarkup(SITES, { [PROXY_SITE.hostname]: { kind: "tcp", responding: false } }, "lychee.land");
    // Scoped to the rows: the list's own Add site button legitimately uses
    // the rose family.
    const rows = SITES.map((site) => rowFor(html, site.hostname)).join("");
    assert.doesNotMatch(rows, />static<\/span>|>proxy<\/span>/);
    assert.doesNotMatch(rows, /rose-950/);
  });

  test("the right half holds the status pill alone", () => {
    const row = rowFor(
      listMarkup([PROXY_SITE], { [PROXY_SITE.hostname]: { kind: "tcp", responding: true } }, "lychee.land"),
      "api.lychee.land",
    );
    const at = row.indexOf("data-row-side");
    assert.notEqual(at, -1, "no element carrying data-row-side was rendered in the row");
    const side = row.slice(at);
    assert.match(side, /data-status-slot/);
    assert.doesNotMatch(side, />proxy<|>static<|rose-950/);
  });
});

describe("what a site row announces", () => {
  // "api.lychee.land localhost:4000 responding" is serviceable but runs
  // three separate facts together. The separators are sr-only rather than an
  // aria-label so the name still derives from the visible text and cannot
  // drift from it.
  test("a proxy row's three facts are separated rather than run together", () => {
    const row = rowFor(
      listMarkup([PROXY_SITE], { [PROXY_SITE.hostname]: { kind: "tcp", responding: true } }, "lychee.land"),
      "api.lychee.land",
    );
    assert.equal(accessibleName(row), "api.lychee.land, localhost:4000, responding");
  });

  test("a static row ends after its address, with no trailing separator", () => {
    const row = rowFor(listMarkup([STATIC_SITE], {}, "lychee.land"), "blog.lychee.land");
    assert.equal(accessibleName(row), "blog.lychee.land, /var/www/blog.lychee.land");
  });

  test("the apex row reads host then address", () => {
    const row = rowFor(listMarkup([APEX_SITE], {}, "lychee.land"), "lychee.land");
    assert.equal(accessibleName(row), "lychee.land, /var/www/lychee.land");
  });

  test("a proxy row with no status ends after its address", () => {
    const row = rowFor(listMarkup([PROXY_SITE], {}, "lychee.land"), "api.lychee.land");
    assert.equal(accessibleName(row), "api.lychee.land, localhost:4000");
  });

  test("the status dot is still absent from the name", () => {
    const row = rowFor(
      listMarkup([NEXT_SITE], { [NEXT_SITE.hostname]: { kind: "container", state: "exited" } }, "lychee.land"),
      "app.lychee.land",
    );
    assert.doesNotMatch(accessibleName(row), /&#9679;|●/);
    assert.match(accessibleName(row), /, exited$/);
  });
});

describe("the site list's error banner", () => {
  // <main> is a flex column, where `mx-auto` on a child stops meaning "centre
  // a block" and starts meaning "shrink to fit, then centre". Measured at
  // 1280px the banner sat 276-1004 while every row ran 88-1192, so the one
  // element reporting a broken Caddyfile was the one element not aligned to
  // the page. The mount point is `display: contents`, so the banner is still
  // one of <main>'s flex children.
  test("the error banner spans the content column instead of shrink-wrapping", () => {
    const html = listMarkup([], {}, "lychee.land", "caddy validate failed");
    const banner = html.match(/<p class="[^"]*bg-red-950[^"]*"/);
    assert.ok(banner, "no error banner rendered");
    assert.doesNotMatch(banner[0], /\bmx-auto\b/);
  });

  test("the error banner still renders its message", () => {
    const html = listMarkup([], {}, "lychee.land", "caddy validate failed");
    assert.match(html, /caddy validate failed/);
  });

  // CaddyfileError's box is pinned to ERROR_BOX in SiteDetailRules.test.tsx;
  // together the two keep the list's error and the unreadable-Caddyfile body one box.
  test("uses the shared error box, as the site routes' error page does", () => {
    const box = listMarkup([], {}, "lychee.land", "boom").match(/<p class="([^"]*bg-red-950[^"]*)"/)?.[1];
    assert.equal(box, ERROR_BOX);
  });
});

describe("host problems on the site list", () => {
  const CADDY_DOWN: HostProblem = {
    name: "caddy",
    word: "exited",
    consequence: "Every site is unreachable from outside",
    page: "infrastructure",
    href: "/infrastructure",
  };

  test("no problems renders no block", () => {
    assert.doesNotMatch(listMarkup(SITES, {}, "lychee.land"), /data-host-problems/);
  });

  test("a problem renders consequence first, red state words, a link", () => {
    const html = listMarkup(SITES, {}, "lychee.land", undefined, [CADDY_DOWN]);
    assert.match(html, /<[^>]*role="status"[^>]*data-host-problems|<[^>]*data-host-problems[^>]*role="status"/);
    const consequence = html.indexOf("Every site is unreachable from outside");
    const phrase = html.indexOf("caddy has stopped");
    assert.ok(consequence >= 0 && phrase > consequence, "consequence must come before the state phrase");
    const consequenceTag = html.slice(html.lastIndexOf("<", consequence), consequence);
    assert.doesNotMatch(consequenceTag, /text-red-/);
    assert.match(html, /<span class="[^"]*text-red-300[^"]*">.*caddy has stopped/);
    const block = html.match(/<div role="status" data-host-problems[\s\S]*?<\/div>/)?.[0] ?? "";
    assert.match(block, /href="\/infrastructure"/);
  });

  test("several problems keep their order", () => {
    const html = listMarkup(SITES, {}, "lychee.land", undefined, [
      CADDY_DOWN,
      { name: "lychee-watch", word: "exited", consequence: "Changes wait for the 15-minute full run", page: "reconciler", href: "/reconciler" },
    ]);
    const first = html.indexOf("Every site is unreachable from outside");
    const second = html.indexOf("Changes wait for the 15-minute full run");
    assert.ok(first >= 0 && second > first);
  });

  test("problem values are escaped", () => {
    const html = listMarkup(SITES, {}, "lychee.land", undefined, [{ ...CADDY_DOWN, name: "<b>x</b>" }]);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<b>x<\/b>/);
  });

  test("the error render has no host-problem block", () => {
    // /api/sites sends `problems: []` with a caddyfileError (apiSites.test.ts),
    // so this is the list the client renders for an unreadable Caddyfile.
    assert.doesNotMatch(listMarkup([], {}, "lychee.land", "boom"), /data-host-problems/);
  });
});

describe("the site list with no sites", () => {
  test("the empty state carries the call to action rather than stranding it in the header", () => {
    const html = listMarkup([], {}, "lychee.land");
    assert.doesNotMatch(html, /No sites configured yet/);
    assert.match(tagById(html, "empty-state-cta"), /href="\/sites\/new"/);
  });

  test("the empty state explains what a site is", () => {
    const html = listMarkup([], {}, "lychee.land");
    assert.match(html, /lychee\.land/);
    assert.ok(tagById(html, "empty-state"));
  });

  // Ember marks what you can act on and is capped at roughly a tenth of the
  // screen. Two primary buttons pointing at the same destination spend it
  // twice and make neither the obvious one, so the section header yields its
  // button to the empty state rather than sitting beside it.
  test("an empty page offers its one action once, not twice", () => {
    const body = listMarkup([], {}, "lychee.land");
    const ctas = [...body.matchAll(/href="\/sites\/new"/g)];
    assert.equal(ctas.length, 1, "the section header and the empty state both offered Add site");
  });

  // Add site lives on the sites page and nowhere in the rail, so with sites
  // the section header carries it as the page's one Ember action.
  test("the section header carries Add site as its one Ember action once there are sites", () => {
    const body = listMarkup(SITES, {}, "lychee.land");
    const ctas = [...body.matchAll(/<a href="\/sites\/new" class="([^"]*)"/g)];
    assert.equal(ctas.length, 1, "expected exactly one Add site link in the list body");
    assert.equal(ctas[0][1], `${BUTTON_PRIMARY} no-underline`);
    assert.match(body, /Add site<\/a>/);
  });

  // With no sites, the empty state's own button is the one Ember action.
  test("the empty state's call to action stays Ember", () => {
    const cta = tagById(listMarkup([], {}, "lychee.land"), "empty-state-cta");
    assert.ok(cta.includes(`class="${BUTTON_PRIMARY} no-underline"`), cta);
    assert.match(cta, /href="\/sites\/new"/);
  });
});

describe("hardening: browser defaults never carry the design", () => {
  test("every interactive element the design draws gets the project focus ring", () => {
    const card = listMarkup(SITES, {}, "lychee.land").match(/<a href="\/sites\/api\.lychee\.land"[^>]*>/);
    assert.ok(card, "no site-card link rendered");
    assert.match(card[0], /focus-visible:outline-rose-400/);
  });

  test("no transition escapes the reduced-motion gate", () => {
    for (const html of [listMarkup(SITES, {}, "lychee.land"), listMarkup([], {}, "lychee.land")]) {
      assert.doesNotMatch(html, /(?<!motion-safe:)transition-colors/);
    }
  });
});

describe("Smoke sentences hold a readable measure", () => {
  /**
   * Every Smoke paragraph (Body classes, not mono) that lacks the 25rem cap.
   * The one sanctioned narrower measure is the Empty State component's
   * `max-w-[46ch]` (about 62 letters), which DESIGN.md's Body entry names.
   * The other pages' cases are beside their own markup rules; the measure's
   * value is in src/views/shared.test.ts.
   */
  function uncappedSmoke(html: string): string[] {
    return (html.match(/<p\b[^>]*>/g) ?? []).filter((tag) => {
      const cls = tag.match(/class="([^"]*)"/)?.[1] ?? "";
      const capped = cls.includes("max-w-[25rem]") || cls.includes("max-w-[46ch]");
      return cls.includes("text-stone-400") && cls.includes("text-[0.8rem]") && !cls.includes("font-mono") && !capped;
    });
  }

  const pages: [string, string][] = [
    ["sites list, empty", listMarkup([], {}, "lychee.land")],
    ["sites list, populated", listMarkup(SITES, {}, "lychee.land")],
  ];

  for (const [name, html] of pages) {
    test(`every Smoke paragraph carries the measure: ${name}`, () => {
      assert.deepEqual(uncappedSmoke(html), []);
    });
  }

  test("the Danger paragraph drops its 70ch, which held about 95 letters", () => {
    for (const [, html] of pages) assert.ok(!html.includes("max-w-[70ch]"));
  });
});
