import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { testShell, withoutShell } from "../dev/testHelpers";
import * as views from "./html";

// Every page renderer takes the shell last. These wrappers pass testShell(),
// marking current what each page's route marks, so the assertions below stay
// about page bodies; the rail itself is pinned in rail.test.ts and
// shell.test.ts, and which item each route marks in the route tests. The
// sites list and the site page are the client's: their markup rules are in
// src/client/components/SiteListMarkup.test.tsx and SiteDetailRules.test.tsx.
function renderAddSite(...args: [Site[], string, Record<string, string>, { caddyfilePath: string; tunnelConfigPath: string }]): string {
  return views.renderAddSite(...args, testShell({ current: null }));
}
import { formatAge, BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY, PROSE_MEASURE, ERROR_BOX, statePhrase } from "./shared";
import { ADD_STEPS } from "../lib/stepReport";

describe("BUTTON_PRIMARY_COMPACT", () => {
  const tokens = BUTTON_PRIMARY_COMPACT.split(" ");
  test("takes the offer's size and keeps Primary's colours", () => {
    for (const t of ["min-h-8", "px-3", "py-1.5", "text-[0.8rem]", "bg-rose-400", "text-stone-900", "hover:bg-rose-300", "focus-visible:outline-rose-400"]) {
      assert.ok(tokens.includes(t), `missing ${t}`);
    }
    for (const t of ["min-h-10", "px-4", "py-2.5", "text-sm"]) assert.ok(!tokens.includes(t), `still has ${t}`);
  });

  test("BUTTON_PRIMARY carries the aria-disabled look", () => {
    const primary = BUTTON_PRIMARY.split(" ");
    for (const t of ["aria-disabled:cursor-not-allowed", "aria-disabled:text-stone-500", "aria-disabled:bg-rose-400/40", "aria-disabled:hover:bg-rose-400/40"]) {
      assert.ok(primary.includes(t), `missing ${t}`);
    }
  });
});

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

const SITES = [STATIC_SITE, APEX_SITE, PROXY_SITE, NEXT_SITE];

const PATHS = {
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
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
 * rather than the whole document. Scoped to <ol> deliberately: it is the
 * only tag this file needs full contents from, and assuming no nested <ol>
 * keeps the match unambiguous.
 */
function listById(html: string, id: string): string {
  const match = html.match(new RegExp(`<ol[^>]* id="${id}"[^>]*>[\\s\\S]*?<\\/ol>`));
  assert.ok(match, `no <ol id="${id}"> was rendered`);
  return match[0];
}

/**
 * The whole <aside id="..."> ... </aside>, so a claim about the preview panel
 * is anchored to it rather than to the document — where the same path string
 * also appears in the form's own copy.
 */
function sectionById(html: string, id: string): string {
  const match = html.match(new RegExp(`<aside[^>]* id="${id}"[^>]*>[\\s\\S]*?<\\/aside>`));
  assert.ok(match, `no <aside id="${id}"> was rendered`);
  return match[0];
}

describe("renderAddSite heading", () => {
  test("the add-site page's heading is a documented ramp step", () => {
    const html = renderAddSite([], "lychee.land", {}, PATHS);
    assert.match(html, /<h2 class="font-mono text-\[1\.7rem\]/);
    assert.doesNotMatch(html, /text-\[1\.35rem\]/);
  });
});

describe("the add-site page describes Next.js as it actually works", () => {
  const NEXTJS_DESCRIPTION =
    "Routes to a container the reconciler runs on this port, built from the site's own repository. After you add it, the site's page has the steps to attach and deploy.";
  const PROXY_DESCRIPTION =
    "Routes to a process you already run and manage yourself on a local port (e.g. next start). lychee-admin only wires up the routing — it won't start, stop, or restart that process for you.";
  /** The text inside the span with this id, tags stripped (the descriptions hold no nested span). */
  const textOf = (html: string, id: string): string => {
    const inner = html.match(new RegExp(`<span id="${id}"[^>]*>([\\s\\S]*?)</span>`))?.[1];
    assert.ok(inner !== undefined, `no span with id="${id}"`);
    return inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  };
  const html = renderAddSite(SITES, "lychee.land", {}, PATHS);

  test("the framework option says the repository builds it and the reconciler runs it", () => {
    assert.ok(html.includes('<option value="nextjs">Next.js — built from its own repository; the reconciler runs it</option>'));
  });

  test("nothing on the page promises a compose file", () => {
    assert.ok(!html.includes("docker-compose"));
  });

  test("the plain-proxy description is unchanged", () => {
    assert.equal(textOf(html, "type-proxy-description"), PROXY_DESCRIPTION);
  });

  test("a Next.js description exists, hidden until Next.js is picked", () => {
    const tag = tagById(html, "type-proxy-description-nextjs");
    assert.match(tag, /class="[^"]*\bhidden\b/);
    assert.equal(textOf(html, "type-proxy-description-nextjs"), NEXTJS_DESCRIPTION);
  });
});

describe("the hostname field", () => {
  test("the hostname field affixes the domain instead of hiding it in a placeholder", () => {
    const html = renderAddSite(SITES, "lychee.land", {}, PATHS);
    const input = tagById(html, "hostname-field");
    assert.match(html, /id="hostname-suffix"[^>]*>\.lychee\.land</);
    assert.match(input, /aria-describedby="[^"]*hostname-suffix/);
  });

  test("the focus ring encloses the whole composed control, not the input alone", () => {
    // INPUT bakes its own focus:outline directly onto the input. Left as-is,
    // that ring would stop at the input/suffix seam and draw a rose bar
    // between the two, splitting the composed control the moment it's used.
    // The input's own ring must be suppressed (needs `!important` to beat
    // INPUT's same-specificity utility regardless of class order) and the
    // ring relocated to the row wrapper via focus-within, so it encloses
    // both pieces as one control — same 2px rose outline, same offset,
    // relocated rather than duplicated.
    const html = renderAddSite(SITES, "lychee.land", {}, PATHS);
    const row = tagById(html, "hostname-row");
    assert.match(row, /focus-within:outline\b/);
    assert.match(row, /focus-within:outline-2\b/);
    assert.match(row, /focus-within:outline-rose-400\b/);
    assert.match(row, /focus-within:outline-offset-2\b/);
    const input = tagById(html, "hostname-field");
    assert.match(input, /focus:outline-none!/);
  });
});

describe("accessible status and error wiring", () => {
  test("the port field points at the message that explains a conflict", () => {
    const input = tagById(renderAddSite(SITES, "lychee.land", {}, PATHS), "port-field");
    assert.match(input, /aria-describedby="port-error"/);
  });

  test("the port conflict message is the element the field names", () => {
    const span = tagById(renderAddSite(SITES, "lychee.land", {}, PATHS), "port-error");
    assert.match(span, /class="[^"]*port-error/);
  });

  test("a port conflict is announced, not just shown", () => {
    const error = tagById(renderAddSite(SITES, "lychee.land", {}, PATHS), "port-error");
    assert.match(error, /aria-live="polite"/);
  });

  test("a failed submit is announced, not only shown", () => {
    const p = tagById(renderAddSite(SITES, "lychee.land", {}, PATHS), "add-site-error");
    assert.match(p, /role="alert"/);
  });

  // The site page's half ("copy outcomes get a polite live region") is in
  // shell.test.ts, against the shell GET /sites/:hostname serves.
  test("the live region is on every page the shell renders, not only the detail page", () => {
    const span = tagById(renderAddSite(SITES, "lychee.land", {}, PATHS), "copy-status");
    assert.match(span, /aria-live="polite"/);
  });
});

describe("hardening: browser defaults never carry the design", () => {
  // The not-found half of this test is in SiteDetailRules.test.tsx, and the
  // list's row links in SiteListMarkup.test.tsx.
  test("every interactive element the design draws gets the project focus ring", () => {
    const add = renderAddSite(SITES, "lychee.land", {}, PATHS);
    for (const value of ["static", "reverse-proxy"]) {
      const radio = add.match(new RegExp(`<input type="radio"[^>]*value="${value}"[^>]*>`));
      assert.ok(radio, `no ${value} radio rendered`);
      assert.match(radio[0], /focus-visible:outline-rose-400/);
    }
  });

  test("a radio's accessible name is its option, not its explanation", () => {
    const add = renderAddSite(SITES, "lychee.land", {}, PATHS);
    const radio = add.match(/<input type="radio"[^>]*value="static"[^>]*>/);
    assert.ok(radio);
    // The paragraph stays announced, as a description rather than a name.
    assert.match(radio[0], /aria-label="Static site"/);
    assert.match(radio[0], /aria-describedby="type-static-description"/);
    assert.ok(tagById(add, "type-static-description"));
  });

  test("no transition escapes the reduced-motion gate", () => {
    // The list's half is in SiteListMarkup.test.tsx.
    const add = renderAddSite(SITES, "lychee.land", {}, PATHS);
    assert.doesNotMatch(add, /(?<!motion-safe:)transition-colors/);
  });

  test("a disabled control's hover fill cannot survive underneath it", () => {
    // Clicking Remove leaves the pointer on the button while it disables, so a
    // live hover background would sit under the dimmed disabled text. Measured
    // at 2.09:1 before this guard — stone-500 on red-900.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /disabled:hover:/, `no disabled:hover override in: ${c}`);
    }
    assert.match(BUTTON_DANGER, /disabled:hover:bg-transparent/);
    assert.match(BUTTON_SECONDARY, /disabled:hover:bg-transparent/);
  });

  test("a disabled control says so tonally, not by going transparent", () => {
    // No opacity as a state signal — this system carries meaning in tone.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /disabled:cursor-not-allowed/);
      assert.match(c, /disabled:text-stone-500/);
      assert.doesNotMatch(c, /disabled:opacity/);
    }
  });

  test("the secondary is a filled object, not an outline", () => {
    // Measured: a Hairline Strong 1px outline is 2.29:1 on Hearth and 1.99:1
    // on Hearth Lift — invisible as a line, unmistakable as a surface. Same
    // token, different amount of it.
    assert.match(BUTTON_SECONDARY, /\bbg-stone-600\b/);
    assert.match(BUTTON_SECONDARY, /\btext-stone-50\b/);
    assert.match(BUTTON_SECONDARY, /\bborder-none\b/);
    assert.doesNotMatch(BUTTON_SECONDARY, /\bborder-stone-600\b/);
  });

  test("the secondary's hover recedes toward the ground, it does not brighten", () => {
    // Chalk on Hairline is 9.85:1. Brightening to Smoke Deep would have been
    // 4.61:1 — inside AA, but the weakest ratio in a system that runs 6-9:1.
    // Asserted as a property (hover step is darker than rest) rather than a
    // literal, so the direction survives a future retune of either token.
    const rest = BUTTON_SECONDARY.match(/(?<![-:\w])bg-stone-(\d+)\b/);
    const hover = BUTTON_SECONDARY.match(/\bhover:bg-stone-(\d+)\b/);
    assert.ok(rest, "secondary has no resting stone fill");
    assert.ok(hover, "secondary has no stone hover fill");
    assert.ok(
      Number(hover[1]) > Number(rest[1]),
      `hover fill stone-${hover[1]} should be darker than rest fill stone-${rest[1]}`,
    );
  });

  test("a disabled secondary dissolves into the page rather than staying solid", () => {
    // The enabled/disabled distinction is now fill-versus-none, which is a
    // louder signal than the text-tone change it used to be.
    assert.match(BUTTON_SECONDARY, /disabled:bg-transparent/);
    assert.match(BUTTON_SECONDARY, /disabled:hover:bg-transparent/);
  });

  test("every button states its own min-height instead of inheriting one", () => {
    // Measured before this change: the primary was 40px on the list header
    // and 42px in the add-site footer; the danger button was 33.2px in the
    // Danger card and 42px in the confirm dialog — the same component at two
    // sizes, because a flex row's default align-items:stretch resized it.
    // A stated min-height wins over stretch (stretch only applies when the
    // cross size is auto) while still letting a long label grow the button
    // instead of overflowing it — a fixed height cannot do that, which is
    // why the dialog's Remove button once spilled out of its own outline.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /\bmin-h-\d+\b/, `no explicit min-height in: ${c}`);
    }
  });

  test("the danger button stays one size down from the primary", () => {
    // The Scorch-Is-Not-Ember Rule: a destructive action is never the largest
    // control on screen. Stretch defeated this in the dialog before Task 2.
    const step = (c: string) => {
      const match = c.match(/\bmin-h-(\d+)\b/);
      assert.ok(match, `no min-h-* step found in: ${c}`);
      return Number(match[1]);
    };
    assert.equal(step(BUTTON_PRIMARY), step(BUTTON_SECONDARY));
    assert.ok(
      step(BUTTON_DANGER) < step(BUTTON_PRIMARY),
      `danger min-h-${step(BUTTON_DANGER)} is not smaller than primary min-h-${step(BUTTON_PRIMARY)}`,
    );
  });

  test("buttons transition their state changes, gated behind motion-safe", () => {
    // DESIGN.md's motion table already claimed a 150ms state-transition for
    // "cards, buttons and option rows". Cards and option rows had it; the
    // button constants did not. This closes that gap rather than adding a
    // new claim.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /motion-safe:transition-colors/, `no gated transition in: ${c}`);
      assert.match(c, /motion-safe:duration-150/, `no 150ms duration in: ${c}`);
      assert.doesNotMatch(c, /(?<!motion-safe:)transition-colors/, `ungated transition in: ${c}`);
    }
  });

  test("a pressed button moves, and only for viewers who want motion", () => {
    // The Flat-At-Rest Rule already allows for "you are touching it right
    // now"; nothing in the app had ever used that clause. A 1px translate
    // satisfies it without introducing a resting shadow, which is what made
    // the rejected Keycap variant expensive.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /motion-safe:active:translate-y-px/, `no press state in: ${c}`);
      assert.doesNotMatch(c, /(?<!motion-safe:)active:translate/, `ungated press in: ${c}`);
    }
  });
});

describe("small-text ramp", () => {
  // The site page's cases are in SiteDetailRules.test.tsx, and the rail's
  // current row in shell.test.ts.
  test("the type-option description clears AA on its raised card", () => {
    const html = renderAddSite(SITES, "lychee.land", {}, PATHS);
    // Anchored to the two type-option <label> cards themselves, not the whole
    // document — a document-wide regex here would also catch the header
    // nav's unrelated bg-stone-700/text-stone-400 pairing and pass vacuously.
    // On the checked state's raised background, the description measured
    // 3.98:1 at 12px in stone-400; stone-300 clears 4.5:1.
    const cards = html.match(/<label[^>]*has-\[:checked\][\s\S]*?<\/label>/g) ?? [];
    assert.equal(cards.length, 2, "expected two type-option cards");
    for (const card of cards) assert.doesNotMatch(card, /text-stone-400/);
  });
});

describe("renderAddSite step list", () => {
  test("the add form states its steps in execution order", () => {
    const html = renderAddSite(SITES, "lychee.land", {}, PATHS);
    const list = listById(html, "add-site-steps");
    for (const id of ["backup", "caddyfile", "files", "tunnel", "caddy", "cloudflared"]) {
      assert.match(list, new RegExp(`data-step-id="${id}"`));
    }
    assert.match(html, /If a step fails, the ones after it don't run\./);
    assert.match(html, /cloudflared-sites restarted/);
  });
});

describe("the add-site preview panel", () => {
  const html = renderAddSite(SITES, "lychee.land", {}, PATHS);

  test("takes the 1080px frame rather than the 760px reading column", () => {
    const body = withoutShell(html);
    assert.doesNotMatch(body, /max-w-\[760px\]/, "add-site should no longer cap at the detail page's width");
  });

  test("puts the form and the panel in one grid that collapses below lg", () => {
    const grid = tagById(html, "add-site-columns");
    assert.match(grid, /grid-cols-1/);
    assert.match(grid, /lg:grid-cols-\[1fr_400px\]/);
  });

  test("names both files it is going to edit, before anything is typed", () => {
    const panel = sectionById(html, "write-preview");
    assert.match(panel, /\/etc\/caddy\/Caddyfile/);
    assert.match(panel, /\/etc\/cloudflared\/sites-config\.yml/);
  });

  test("renders the step list inside the panel, keeping the id the submit handler marks", () => {
    const panel = sectionById(html, "write-preview");
    assert.match(panel, /id="add-site-steps"/);
  });

  test("every step keeps its data-step-id, so a failed submit can still mark it", () => {
    const list = listById(html, "add-site-steps");
    for (const step of ADD_STEPS) {
      assert.match(list, new RegExp(`data-step-id="${step.id}"`));
    }
  });

  test("the panel's error region is announced, since a duplicate hostname is actionable", () => {
    const error = tagById(html, "preview-error");
    assert.match(error, /role="status"/);
  });

  test("the error region is focusable by script, so a blocked submit can move the reader to the reason", () => {
    const error = tagById(html, "preview-error");
    assert.match(error, /tabindex="-1"/);
    assert.match(error, /role="status"/);
  });

  test("the panel itself is not a live region — announcing a config block per keystroke is hostile", () => {
    const panel = tagById(html, "write-preview");
    assert.doesNotMatch(panel, /aria-live/);
  });

  test("the headline carries an element the client can retype as the hostname", () => {
    assert.ok(tagById(html, "composed-hostname"));
  });

  test("the port branch keeps the 2px Ember Edge rule DESIGN.md documents", () => {
    const branch = withoutShell(html).match(/<div class="port-input[^"]*"/);
    assert.ok(branch);
    assert.match(branch[0], /border-l-2/);
    assert.match(branch[0], /border-l-rose-800/);
  });
});

/*
 * The services board's markup tests moved to
 * src/client/components/BoardMarkup.test.tsx with the React board, and the
 * site page's (its Prune control and requested line included) to
 * SiteDetailRules.test.tsx with the React site page, each when its server
 * renderer was retired. offeredTag's tests are in boardFacts.test.ts.
 */

describe("formatAge", () => {
  const now = new Date("2026-10-02T05:00:00Z");
  const at = (secondsFromNow: number) => new Date(now.getTime() + secondsFromNow * 1000);

  test("under five seconds either way is just now", () => {
    assert.equal(formatAge(at(-4), now), "just now");
    assert.equal(formatAge(at(4), now), "just now");
    assert.equal(formatAge(at(-5), now), "5 seconds ago");
  });

  test("cuts over from seconds to minutes to hours to days", () => {
    assert.equal(formatAge(at(-59), now), "59 seconds ago");
    assert.equal(formatAge(at(-60), now), "1 minute ago");
    assert.equal(formatAge(at(-120), now), "2 minutes ago");
    assert.equal(formatAge(at(-3599), now), "60 minutes ago");
    assert.equal(formatAge(at(-3600), now), "1 hour ago");
    assert.equal(formatAge(at(-47 * 3600), now), "47 hours ago");
    assert.equal(formatAge(at(-48 * 3600), now), "2 days ago");
  });

  test("past reads ago and future reads in", () => {
    assert.equal(formatAge(at(-180), now), "3 minutes ago");
    assert.equal(formatAge(at(180), now), "in 3 minutes");
  });

  test("accepts a systemd weekday-prefixed timestamp", () => {
    assert.equal(formatAge("Fri 2026-10-02 04:57:38 UTC", now), "2 minutes ago");
  });

  test("anything unparseable is null, not NaN", () => {
    assert.equal(formatAge(null, now), null);
    assert.equal(formatAge(undefined, now), null);
    assert.equal(formatAge("not a date", now), null);
  });
});

// Were in "what to check under the chain"; they test shared.ts's statePhrase,
// which the site page's What to check entries use.
describe("statePhrase", () => {
  test("each bad state reads as a phrase", () => {
    assert.equal(statePhrase("exited"), "has stopped");
    assert.equal(statePhrase("restarting"), "keeps restarting");
    assert.equal(statePhrase("paused"), "is paused");
    assert.equal(statePhrase("unhealthy"), "is running but failing its health check");
  });

  test("an unmapped word falls back to is <word>", () => {
    assert.equal(statePhrase("unknown"), "is unknown");
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
  // list's in SiteListMarkup.test.tsx, and the site page's in
  // SiteDetailRules.test.tsx.
  test("the measure is 25rem, in rem and not ch", () => {
    assert.equal(PROSE_MEASURE, "max-w-[25rem]");
  });

  test("every Smoke paragraph carries the measure: add-site page", () => {
    assert.deepEqual(uncappedSmoke(renderAddSite(SITES, "lychee.land", {}, PATHS)), []);
  });
});

describe("renderErrorPage", () => {
  const page = (message: string) => views.renderErrorPage("Can't read the Caddyfile", message, testShell({ current: null }));

  test("escapes the message", () => {
    const html = page(`<script>alert("x")</script>`);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert/);
  });

  // The list's half: SiteListMarkup.test.tsx pins its error box to ERROR_BOX too.
  test("uses the same error-box classes the site list uses for its error", () => {
    const boxOf = (html: string) => html.match(/<p class="([^"]*bg-red-950[^"]*)"/)?.[1];
    assert.equal(boxOf(page("boom")), ERROR_BOX);
  });

  test("has no Sites heading and no empty state, and links back to the list", () => {
    const html = withoutShell(page("boom"));
    assert.doesNotMatch(html, /<h2[^>]*>\s*Sites\s*<\/h2>/);
    assert.doesNotMatch(html, /id="empty-state"/);
    assert.match(html, /<a href="\/"[^>]*>← sites<\/a>/);
  });
});
