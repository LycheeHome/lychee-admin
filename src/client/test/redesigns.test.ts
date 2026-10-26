import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { REDESIGNS, applyWith, type Redesign } from "./redesigns";

/*
 * The declared substitutions the parity tests apply to frozen fixtures
 * (redesigns.ts). Read from disk here rather than counted inside the parity
 * files, because each test file runs in its own process: none of them can see
 * whether another's substitutions matched.
 */

const FIXTURES = path.resolve(import.meta.dirname, "../../dev/fixtures");

function fixtures(dir = FIXTURES): { name: string; html: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return fixtures(full);
    return e.name.endsWith(".html") ? [{ name: path.relative(FIXTURES, full), html: readFileSync(full, "utf8") }] : [];
  });
}

const all = fixtures();
const count = (html: string, needle: string) => html.split(needle).length - 1;
const matches = (r: Redesign, html: string) => Array.from(html.matchAll(new RegExp(r.from.source, "g")));

describe("declared redesigns of frozen fixtures", () => {
  test("every redesign matches at least one frozen fixture", () => {
    for (const r of REDESIGNS) assert.ok(all.some((f) => matches(r, f.html).length > 0), `${r.id} matches no fixture: it is stale`);
  });

  test("no fixture already holds a redesign's new markup", () => {
    for (const r of REDESIGNS) {
      for (const f of all) {
        // The replacement with its capture groups blanked: what only the new markup would contain.
        const fixed = r.to.split(/\$\d/)[0]!;
        assert.ok(fixed === "" || !f.html.includes(fixed), `${f.name} already holds ${r.id}'s new markup`);
      }
    }
  });

  test("every match contains its anchor, and each anchor occurrence is matched", () => {
    for (const r of REDESIGNS) {
      for (const f of all) {
        const found = matches(r, f.html);
        for (const m of found) assert.ok(m[0].includes(r.anchor), `${r.id} matched outside its anchor in ${f.name}`);
        assert.equal(found.length, count(f.html, r.anchor), `${r.id}: matches and anchors differ in ${f.name}`);
      }
    }
  });

  test("every redesign is dated and explained", () => {
    for (const r of REDESIGNS) {
      assert.match(r.since, /^\d{4}-\d{2}-\d{2}$/, r.id);
      assert.ok(r.why.trim().length > 0, `${r.id} has no reason`);
      assert.ok(r.from.global, `${r.id} must be global`);
    }
  });

  test("applyWith rewrites every match of an entry", () => {
    const entry: Redesign = { id: "t", since: "2026-10-26", why: "test", from: /<b>(\w+)<\/b>/g, to: "<i>$1</i>", anchor: "<b>" };
    assert.equal(applyWith("<b>a</b> <b>c</b>", [entry]), "<i>a</i> <i>c</i>");
    assert.equal(applyWith("<p>x</p>", [entry]), "<p>x</p>");
  });
});
