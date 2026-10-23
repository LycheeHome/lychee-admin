import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { formatAge, BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY, PROSE_MEASURE, statePhrase } from "./shared";

// The rules shared.ts's class constants and helpers hold on their own, for
// every page that uses them. These were the part of html.test.ts that tested
// no page; the add page's and the error page's rules went to the React
// components with those pages (AddSiteMarkup.test.tsx, SiteDetailRules.test.tsx)
// when src/views/html.ts was retired.

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

describe("hardening: browser defaults never carry the design", () => {
  // The pages' halves: the add page's radios in AddSiteMarkup.test.tsx, the
  // not-found link in SiteDetailRules.test.tsx, and the list's row links in
  // SiteListMarkup.test.tsx.
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
  // Each page's own case is beside that page's markup rules: the add page's
  // in AddSiteMarkup.test.tsx, the services board's in BoardMarkup.test.tsx,
  // the sites list's in SiteListMarkup.test.tsx, and the site page's in
  // SiteDetailRules.test.tsx.
  test("the measure is 25rem, in rem and not ch", () => {
    assert.equal(PROSE_MEASURE, "max-w-[25rem]");
  });
});
