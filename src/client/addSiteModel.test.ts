import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  composeHostname,
  fieldVisibility,
  headlineParts,
  portMessage,
  previewSections,
  resultMarks,
  skipMarks,
} from "./addSiteModel";
import type { SitePreview } from "../lib/sitePreview";

describe("composeHostname", () => {
  test("appends the domain to a bare label", () => {
    assert.equal(composeHostname("blog", "lychee.land"), "blog.lychee.land");
  });
  test("strips trailing dots and keeps the original casing", () => {
    assert.equal(composeHostname("Blog.Lychee.Land.", "lychee.land"), "Blog.Lychee.Land");
  });
  test("the domain itself is already full", () => {
    assert.equal(composeHostname("lychee.land", "lychee.land"), "lychee.land");
  });
  test("blank is empty", () => {
    assert.equal(composeHostname("  ", "lychee.land"), "");
  });
});

describe("headlineParts", () => {
  test("splits label and suffix", () => {
    assert.deepEqual(headlineParts("blog.lychee.land", "lychee.land"), { label: "blog", suffix: ".lychee.land" });
  });
  test("empty means Add a site", () => {
    assert.equal(headlineParts("", "lychee.land"), null);
  });
  test("the bare domain is shown whole", () => {
    assert.deepEqual(headlineParts("lychee.land", "lychee.land"), { whole: "lychee.land" });
  });
});

describe("portMessage", () => {
  const owners = { "8787": "Port 8787 is reserved for lychee-admin." };
  test("returns the sentence for a claimed port", () => {
    assert.equal(portMessage("8787", owners), "Port 8787 is reserved for lychee-admin.");
  });
  test("null for a free port", () => {
    assert.equal(portMessage("3000", owners), null);
  });
});

describe("fieldVisibility", () => {
  test("static", () => {
    assert.deepEqual(fieldVisibility("static", ""), { port: false, healthcheck: false, nextjsDescription: false });
    assert.deepEqual(fieldVisibility("static", "nextjs"), { port: false, healthcheck: true, nextjsDescription: true });
  });
  test("reverse proxy", () => {
    assert.deepEqual(fieldVisibility("reverse-proxy", ""), { port: true, healthcheck: false, nextjsDescription: false });
    assert.deepEqual(fieldVisibility("reverse-proxy", "nextjs"), { port: true, healthcheck: true, nextjsDescription: true });
  });
});

describe("previewSections", () => {
  const base: SitePreview = {
    hostname: "a.lychee.land",
    caddy: { path: "/etc/caddy/Caddyfile", added: ["http://a.lychee.land {", "}"] },
    tunnel: { path: "/etc/cloudflared/sites-config.yml", added: ["- hostname: a.lychee.land"], contextAfter: "- service: http_status:404" },
    files: null,
    steps: [],
  };
  test("static gives three sections, files last", () => {
    const s = previewSections({ ...base, files: { path: "/var/www/a.lychee.land", creates: ["index.html"] } });
    assert.equal(s.length, 3);
    assert.deepEqual(s[2], { path: "/var/www/a.lychee.land", lines: ["index.html"], contextAfter: null });
  });
  test("proxy gives two", () => {
    assert.equal(previewSections(base).length, 2);
  });
  test("tunnel keeps contextAfter", () => {
    const s = previewSections(base);
    assert.equal(s[0].contextAfter, null);
    assert.equal(s[1].contextAfter, "- service: http_status:404");
  });
});

describe("marks", () => {
  test("skipMarks", () => {
    const m = skipMarks([{ id: "a", willRun: false }, { id: "b", willRun: true }]);
    assert.deepEqual(m.a, { text: "—", className: "text-stone-400" });
    assert.deepEqual(m.b, { text: "", className: "" });
  });
  test("resultMarks", () => {
    const m = resultMarks([
      { id: "a", status: "ok" },
      { id: "b", status: "failed" },
      { id: "c", status: "skipped" },
      { id: "d", status: "not-run" },
      { id: "e", status: "weird" },
    ]);
    assert.deepEqual(m.a, { text: "✓", className: "text-green-300" });
    assert.deepEqual(m.b, { text: "✗", className: "text-red-300" });
    assert.deepEqual(m.c, { text: "—", className: "text-stone-400" });
    assert.deepEqual(m.d, { text: "·", className: "text-stone-400" });
    assert.deepEqual(m.e, { text: "", className: "" });
  });
});
