import "../test/setup";
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seedAddSitePayload } from "../../dev/testHelpers";
import type { AddSitePayload } from "../../shared/addSite";
import { ADD_STEPS } from "../../lib/stepReport";
import { AddSiteBody } from "../pages/AddSitePage";

/*
 * The add page's markup rules, against the React page at rest. They were
 * src/views/html.test.ts's and shell.test.ts's tests of the server's add page
 * renderer, carried over when it was retired; the behaviour after each step
 * is AddSiteParity.test.tsx's, against the frozen reference. Where a rule
 * pins a shared class constant rather than the page, it stayed with the
 * constants in src/views/shared.test.ts.
 */

let html: string;

before(async () => {
  const payload: AddSitePayload = await seedAddSitePayload();
  html = renderToStaticMarkup(<AddSiteBody payload={payload} headingRef={createRef<HTMLHeadingElement>()} go={() => {}} />);
});

/**
 * Returns the opening tag of the element with `id`, so an assertion is made
 * against that element rather than the whole page. A page-wide regex would
 * pass on any page that happens to mention the attribute somewhere else.
 */
function tagById(markup: string, id: string): string {
  const match = markup.match(new RegExp(`<[a-z]+[^>]* id="${id}"[^>]*>`));
  assert.ok(match, `no element with id="${id}" was rendered`);
  return match[0];
}

/** The whole <ol id="…">…</ol>, so a claim about a step's row is anchored to this list. */
function listById(markup: string, id: string): string {
  const match = markup.match(new RegExp(`<ol[^>]* id="${id}"[^>]*>[\\s\\S]*?<\\/ol>`));
  assert.ok(match, `no <ol id="${id}"> was rendered`);
  return match[0];
}

/** The whole <aside id="…">…</aside>, where the same path string also appears in the form's own copy. */
function sectionById(markup: string, id: string): string {
  const match = markup.match(new RegExp(`<aside[^>]* id="${id}"[^>]*>[\\s\\S]*?<\\/aside>`));
  assert.ok(match, `no <aside id="${id}"> was rendered`);
  return match[0];
}

describe("the add page's form", () => {
  test("renders the fields that used to live in the dialog", () => {
    assert.match(html, /name="hostname"/);
    assert.match(html, /name="type"[^>]*value="static"/);
    assert.match(html, /name="type"[^>]*value="reverse-proxy"/);
    assert.match(html, /id="port-field"/);
    assert.match(html, /id="framework-field"/);
    assert.match(html, /id="healthcheck-field"/);
    assert.match(html, /id="healthcheck-field-wrapper"/);
    // The progressive disclosure and the port-conflict and failure regions
    // the page writes into; their loss would fail nothing else at rest.
    assert.match(html, /\bport-input\b/);
    assert.match(html, /\bport-error\b/);
    assert.match(html, /id="add-site-error"/);
  });

  test("posts to the unchanged endpoint", () => {
    assert.match(tagById(html, "add-site-form"), /action="\/sites"/);
  });

  test("the heading is a documented ramp step", () => {
    assert.match(html, /<h2 class="font-mono text-\[1\.7rem\]/);
    assert.doesNotMatch(html, /text-\[1\.35rem\]/);
  });

  test("the headline carries an element the page retypes as the hostname", () => {
    assert.ok(tagById(html, "composed-hostname"));
  });
});

describe("the add page describes Next.js as it actually works", () => {
  const NEXTJS_DESCRIPTION =
    "Routes to a container the reconciler runs on this port, built from the site's own repository. After you add it, the site's page has the steps to attach and deploy.";
  const PROXY_DESCRIPTION =
    "Routes to a process you already run and manage yourself on a local port (e.g. next start). lychee-admin only wires up the routing — it won't start, stop, or restart that process for you.";
  /** The text of the element with this id, whitespace collapsed (React escapes `'`, so read it parsed). */
  const textOf = (id: string): string => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const found = template.content.getElementById(id);
    assert.ok(found, `no element with id="${id}"`);
    return (found.textContent ?? "").replace(/\s+/g, " ").trim();
  };

  test("the framework option says the repository builds it and the reconciler runs it", () => {
    assert.ok(html.includes('<option value="nextjs">Next.js — built from its own repository; the reconciler runs it</option>'));
  });

  test("nothing on the page promises a compose file", () => {
    assert.ok(!html.includes("docker-compose"));
  });

  test("the plain-proxy description is unchanged", () => {
    assert.equal(textOf("type-proxy-description"), PROXY_DESCRIPTION);
  });

  test("a Next.js description exists, hidden until Next.js is picked", () => {
    assert.match(tagById(html, "type-proxy-description-nextjs"), /class="[^"]*\bhidden\b/);
    assert.equal(textOf("type-proxy-description-nextjs"), NEXTJS_DESCRIPTION);
  });
});

describe("the hostname field", () => {
  test("affixes the domain instead of hiding it in a placeholder", () => {
    assert.match(html, /id="hostname-suffix"[^>]*>\.lychee\.land</);
    assert.match(tagById(html, "hostname-field"), /aria-describedby="[^"]*hostname-suffix/);
  });

  test("the focus ring encloses the whole composed control, not the input alone", () => {
    // INPUT bakes its own focus:outline onto the input. Left as-is, that ring
    // would stop at the input/suffix seam and split the composed control the
    // moment it's used. The input's own ring is suppressed (`!important`, to
    // beat INPUT's same-specificity utility regardless of class order) and
    // relocated to the row through focus-within: same 2px rose outline, same
    // offset, relocated rather than duplicated.
    const row = tagById(html, "hostname-row");
    assert.match(row, /focus-within:outline\b/);
    assert.match(row, /focus-within:outline-2\b/);
    assert.match(row, /focus-within:outline-rose-400\b/);
    assert.match(row, /focus-within:outline-offset-2\b/);
    assert.match(tagById(html, "hostname-field"), /focus:outline-none!/);
  });
});

describe("accessible status and error wiring", () => {
  test("the port field points at the message that explains a conflict", () => {
    assert.match(tagById(html, "port-field"), /aria-describedby="port-error"/);
  });

  test("the port conflict message is the element the field names", () => {
    assert.match(tagById(html, "port-error"), /class="[^"]*port-error/);
  });

  test("a port conflict is announced, not just shown", () => {
    assert.match(tagById(html, "port-error"), /aria-live="polite"/);
  });

  test("a failed submit is announced, not only shown", () => {
    assert.match(tagById(html, "add-site-error"), /role="alert"/);
  });
});

describe("hardening: browser defaults never carry the design", () => {
  test("both type radios get the project focus ring", () => {
    for (const value of ["static", "reverse-proxy"]) {
      const radio = html.match(new RegExp(`<input type="radio"[^>]*value="${value}"[^>]*>`));
      assert.ok(radio, `no ${value} radio rendered`);
      assert.match(radio[0], /focus-visible:outline-rose-400/);
    }
  });

  test("a radio's accessible name is its option, not its explanation", () => {
    const radio = html.match(/<input type="radio"[^>]*value="static"[^>]*>/);
    assert.ok(radio);
    // The paragraph stays announced, as a description rather than a name.
    assert.match(radio[0], /aria-label="Static site"/);
    assert.match(radio[0], /aria-describedby="type-static-description"/);
    assert.ok(tagById(html, "type-static-description"));
  });

  test("no transition escapes the reduced-motion gate", () => {
    assert.doesNotMatch(html, /(?<!motion-safe:)transition-colors/);
  });
});

describe("small-text ramp", () => {
  test("the type-option description clears AA on its raised card", () => {
    // Anchored to the two type-option <label> cards themselves. On the
    // checked state's raised background, the description measured 3.98:1 at
    // 12px in stone-400; stone-300 clears 4.5:1.
    const cards = html.match(/<label[^>]*has-\[:checked\][\s\S]*?<\/label>/g) ?? [];
    assert.equal(cards.length, 2, "expected two type-option cards");
    for (const card of cards) assert.doesNotMatch(card, /text-stone-400/);
  });
});

describe("the step list", () => {
  test("the add form states its steps in execution order", () => {
    const list = listById(html, "add-site-steps");
    const ids = [...list.matchAll(/data-step-id="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["backup", "caddyfile", "files", "tunnel", "caddy", "cloudflared"]);
    assert.match(html, /If a step fails, the ones after it don&#x27;t run\./);
    assert.match(html, /cloudflared-sites restarted/);
  });
});

describe("the add page's preview panel", () => {
  test("takes the 1080px frame rather than the 760px reading column", () => {
    assert.doesNotMatch(html, /max-w-\[760px\]/, "the add page should not cap at the site page's width");
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

  test("renders the step list inside the panel, keeping the id a failed submit marks", () => {
    assert.match(sectionById(html, "write-preview"), /id="add-site-steps"/);
  });

  test("every step keeps its data-step-id, so a failed submit can still mark it", () => {
    const list = listById(html, "add-site-steps");
    for (const step of ADD_STEPS) assert.match(list, new RegExp(`data-step-id="${step.id}"`));
  });

  test("the panel's error region is announced and focusable by script, so a blocked submit can move the reader to the reason", () => {
    const error = tagById(html, "preview-error");
    assert.match(error, /role="status"/);
    assert.match(error, /tabindex="-1"/);
  });

  test("the panel itself is not a live region — announcing a config block per keystroke is hostile", () => {
    assert.doesNotMatch(tagById(html, "write-preview"), /aria-live/);
  });

  test("the port branch keeps the 2px Ember Edge rule DESIGN.md documents", () => {
    const branch = html.match(/<div class="port-input[^"]*"/);
    assert.ok(branch);
    assert.match(branch[0], /border-l-2/);
    assert.match(branch[0], /border-l-rose-800/);
  });
});

describe("Smoke sentences hold a readable measure", () => {
  // The rule and the measure's own value are in src/views/shared.test.ts.
  test("every Smoke paragraph carries the measure: add page", () => {
    const uncapped = (html.match(/<p\b[^>]*>/g) ?? []).filter((tag) => {
      const cls = tag.match(/class="([^"]*)"/)?.[1] ?? "";
      const capped = cls.includes("max-w-[25rem]") || cls.includes("max-w-[46ch]");
      return cls.includes("text-stone-400") && cls.includes("text-[0.8rem]") && !cls.includes("font-mono") && !capped;
    });
    assert.deepEqual(uncapped, []);
  });
});
