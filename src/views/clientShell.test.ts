import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readClientManifest, renderClientPage } from "./clientShell";
import { testShell } from "../dev/testHelpers";

const ASSETS = { script: "assets/main-abc.js", styles: ["assets/main-def.css"] };

function tempPublic(manifest?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-manifest-"));
  if (manifest !== undefined) {
    fs.mkdirSync(path.join(dir, "client", ".vite"), { recursive: true });
    fs.writeFileSync(path.join(dir, "client", ".vite", "manifest.json"), manifest);
  }
  return dir;
}

describe("readClientManifest", () => {
  test("returns the entry's script and styles", () => {
    const dir = tempPublic(
      JSON.stringify({
        "src/client/main.tsx": { file: "assets/main-abc.js", isEntry: true, css: ["assets/main-def.css"] },
      }),
    );
    assert.deepEqual(readClientManifest(dir), ASSETS);
  });

  test("a missing entry's css is an empty list", () => {
    const dir = tempPublic(JSON.stringify({ "src/client/main.tsx": { file: "assets/main-abc.js" } }));
    assert.deepEqual(readClientManifest(dir), { script: "assets/main-abc.js", styles: [] });
  });

  test("returns null with no manifest, a broken one, or one without the entry", () => {
    assert.equal(readClientManifest(tempPublic()), null);
    assert.equal(readClientManifest(tempPublic("{not json")), null);
    assert.equal(readClientManifest(tempPublic("{}")), null);
  });
});

describe("renderClientPage", () => {
  const html = renderClientPage("Infrastructure", "infrastructure", testShell({ current: { page: "infrastructure" }, assets: ASSETS }));

  test("renders the mount point", () => {
    assert.ok(html.includes('id="app-root" data-page="infrastructure"'));
  });

  test("loads the module script and the stylesheet", () => {
    assert.ok(html.includes('<script type="module" src="/client/assets/main-abc.js">'));
    assert.ok(html.includes('<link rel="stylesheet" href="/client/assets/main-def.css"'));
  });

  test("puts the module script before the shell's own scripts", () => {
    assert.ok(html.indexOf("/client/assets/main-abc.js") < html.indexOf('src="/actionPoll.js"'));
    assert.ok(html.indexOf('src="/actionPoll.js"') < html.indexOf('src="/app.js"'));
  });

  test("loads each bundle tag exactly once", () => {
    assert.equal(html.split("/client/assets/main-abc.js").length - 1, 1);
    assert.equal(html.split("/client/assets/main-def.css").length - 1, 1);
  });

  test("marks infrastructure current in the rail", () => {
    assert.match(html, /<a href="\/infrastructure"[^>]*aria-current="page"/);
  });

  test("escapes asset paths", () => {
    const evil = renderClientPage("T", "services", testShell({ assets: { script: 'a"><b', styles: ['c"><i'] } }));
    assert.ok(!evil.includes('"><b'));
    assert.ok(!evil.includes('"><i'));
  });
});
