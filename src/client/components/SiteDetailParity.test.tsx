import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import { renderErrorPage } from "../../views/html";
import { DETAIL_KEY, type SiteResourceView } from "../../views/siteDetailModel";
import { mainRegion, seedSiteDetailPayload as seedPayload, testShell } from "../../dev/testHelpers";
import { CaddyfileError, SiteDetail, SiteNotFound } from "./SiteDetail";
import { canonical } from "../test/canonical";

/*
 * The React site page against what the server's site page renderer rendered,
 * whole: the header, the request path with What to check, the repository card
 * in both shapes, Manual steps and the Danger card with its closed dialog. The
 * renderer is retired; its output for each payload below is frozen in
 * src/dev/fixtures/detail/ (see serverRegion).
 *
 * The one sanctioned difference (ruling R3, spec §5) is already out of the
 * frozen files: the server appended an inert <template
 * data-requested-template> for app.js to clone after a Deploy wherever it
 * rendered an offer, React never renders it, and the fixtures were frozen with
 * it stripped, which is what the comparison compared. Nothing else is cut.
 *
 * CaddyfileError is still compared live against renderErrorPage, which no
 * route answers with any more (/sites/new is the client's) but which has not
 * been deleted yet; it goes with src/views/html.ts.
 */

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;

// In src/dev, not src/client: outside the design detector's scope, and like
// all of src/dev, outside the build and the release tree.
const FIXTURES = path.join(__dirname, "../../dev/fixtures/detail");
const read = new Set<string>();

/**
 * The server's content region for a fixture, frozen. Each file is exactly what
 * the retired site page renderer produced for that test's payload (or, for
 * not-found-escaped, the retired not-found renderer for its hostname), sliced
 * from just after the copy-status live region to </main> (no ?created=1, so
 * there is no #page-notice in it), with the requested-line template removed.
 * They were generated from the live renderer and asserted byte-equal to it
 * before it was deleted; they are never regenerated, because there is
 * nothing left to generate them from. A fixture's payload is the one its test
 * builds. The text-* files belong to SiteDetailMarkup.test.tsx.
 */
function serverRegion(name: string): string {
  read.add(`${name}.html`);
  return readFileSync(path.join(FIXTURES, `${name}.html`), "utf8");
}

function clientMarkup(payload: Detail): string {
  return renderToStaticMarkup(<SiteDetail payload={payload} />);
}

/** Asserts parity and returns the server region, so a test can check it reached the branch it names. */
function assertParity(name: string, payload: Detail, reaches: string[] = []): string {
  const server = serverRegion(name);
  const client = clientMarkup(payload);
  assert.equal(canonical(client), canonical(server));
  assertInlineWhitespace(client, server);
  for (const branch of reaches) assert.ok(server.includes(branch), `the fixture never reached ${branch}`);
  return server;
}

/**
 * The space a whitespace-only node renders as, between inline siblings, is
 * the same on both sides. canonical() drops those nodes, so without this the
 * breadcrumb's "sites / host" and React's "sites/host" compared equal.
 */
function assertInlineWhitespace(client: string, server: string): void {
  assert.equal(canonical(client, { inlineWhitespace: true }), canonical(server, { inlineWhitespace: true }));
}

/** The seed payload with its resource changed: a branch the seed does not hold as it stands. */
async function withResource(hostname: string, change: (r: SiteResourceView) => SiteResourceView) {
  const { payload } = await seedPayload(hostname);
  assert.ok(payload.resource, `${hostname} has no resource in the seed`);
  return { ...payload, resource: change(payload.resource) };
}

/** A seed payload, with `override` merged over its facts. */
async function seeded(...args: Parameters<typeof seedPayload>): Promise<Detail> {
  return (await seedPayload(...args)).payload;
}

/** A detail row's key, as only the request path or the installed card writes it. */
const rowKey = (key: string) => `<span class="${DETAIL_KEY}">${key}</span>`;
/** A hop or pill status word: the dot, then the word, as one phrase. */
const HOP_UNKNOWN = '<p class="font-mono text-[0.72rem] text-stone-300 m-0" data-hop-status><span aria-hidden="true">●</span> unknown</p>';
const PILL_RESPONDING = '<span aria-hidden="true">&#9679;</span> responding</span>';

const BAD = { status: "exited", since: null } as const;
const RESTARTING = { status: "restarting", since: null } as const;
const RUNNING = { status: "running", since: null } as const;

describe("SiteDetail parity with the frozen server site page", () => {
  test("lychee.land, the apex, with its directory", async () => {
    assertParity("apex-with-directory", await seeded("lychee.land"), [
      "Your files",
      "confirm-remove-delete-files",
      "placeholder index.html",
    ]);
  });

  test("lychee.land without its directory", async () => {
    const server = assertParity("apex-without-directory", await seeded("lychee.land", { filesExist: false }));
    assert.ok(!server.includes("confirm-remove-delete-files"));
  });

  test("blog.lychee.land, a static subdomain", async () => {
    assertParity("static-subdomain", await seeded("blog.lychee.land"), ['<span class="text-stone-500">.lychee.land</span>']);
  });

  test("api responding", async () => {
    const payload = await seeded("api.lychee.land", { status: { kind: "tcp", responding: true } });
    const server = assertParity("proxy-responding", payload, [PILL_RESPONDING]);
    assert.ok(!server.includes("not responding"));
  });

  test("api not responding", async () => {
    const payload = await seeded("api.lychee.land", { status: { kind: "tcp", responding: false } });
    assertParity("proxy-not-responding", payload, ["What to check", "cmd-fix-listen", "Nothing answered on"]);
  });

  test("app: an installed container in a bad state", async () => {
    const payload = await seeded("app.lychee.land", { status: { kind: "container", state: "exited" } });
    assertParity("container-bad-state", payload, ["cmd-logs", "The container has stopped"]);
  });

  test("a bad tunnel", async () => {
    const payload = await seeded("api.lychee.land", {
      status: { kind: "tcp", responding: true },
      unitStates: { "cloudflared-sites.service": BAD, "caddy.service": RUNNING },
    });
    const server = assertParity("bad-tunnel", payload, ["cmd-fix-tunnel", "The sites tunnel has stopped"]);
    assert.ok(!server.includes("cmd-fix-caddy"));
  });

  test("a bad Caddy", async () => {
    const payload = await seeded("lychee.land", {
      unitStates: { "cloudflared-sites.service": RUNNING, "caddy.service": RESTARTING },
    });
    const server = assertParity("bad-caddy", payload, ["cmd-fix-caddy", "Caddy keeps restarting"]);
    assert.ok(!server.includes("cmd-fix-tunnel"));
  });

  test("a bad tunnel and a bad Caddy, beside a bad app", async () => {
    const payload = await seeded("api.lychee.land", {
      status: { kind: "tcp", responding: false },
      unitStates: { "cloudflared-sites.service": BAD, "caddy.service": RESTARTING },
    });
    assertParity("bad-tunnel-caddy-and-app", payload, ["cmd-fix-tunnel", "cmd-fix-caddy", "cmd-fix-listen"]);
  });

  test("unit states missing, and not read at all", async () => {
    assertParity("unit-states-missing", await seeded("lychee.land", { unitStates: {} }), [HOP_UNKNOWN]);
    const server = assertParity("unit-states-unread", await seeded("lychee.land", { unitStates: undefined }));
    assert.ok(!server.includes("data-hop-status"));
  });

  test("an empty tunnelId", async () => {
    const server = assertParity("empty-tunnel-id", await seeded("blog.lychee.land", { tunnelId: "" }), [
      "add a CNAME for this hostname to your tunnel",
    ]);
    assert.ok(!server.includes("cmd-dns"));
  });

  test("the DNS steps carry their copy targets", async () => {
    assertParity("static-subdomain", await seeded("blog.lychee.land"), [
      'data-copy-target="cmd-dns-target"',
      'data-copy-target="cmd-dns"',
    ]);
  });

  test("the dialog for a plain site", async () => {
    const payload = await seeded("api.lychee.land", { status: { kind: "tcp", responding: true } });
    const server = assertParity("proxy-responding", payload, ['id="confirm-remove-dialog"', "cloudflared-sites restarted"]);
    assert.ok(!server.includes("data-attached"));
    assert.ok(!server.includes("Step 5 is what stops the container"));
  });

  test("the dialog for an attached site", async () => {
    assertParity("app-installed", await seeded("app.lychee.land"), [
      'data-attached="true"',
      "app-lychee-land.yml set to state: absent",
      "Step 5 is what stops the container",
    ]);
  });

  test("markup-shaped values escape as the server escapes them", async () => {
    const payload = await seeded("blog.lychee.land", { tunnelId: `<id&"x>`, domain: "lychee.land" });
    assertParity("escaping-tunnel-id", payload, ["&lt;id&amp;"]);
  });

  test("a mismatch is caught", async () => {
    const payload = await seeded("api.lychee.land", { status: { kind: "tcp", responding: false } });
    const server = serverRegion("proxy-not-responding");
    const tampered = server.replace("Nothing answered on", "Nothing replied on");
    assert.ok(tampered !== server, "the negative case never changed the server markup");
    assert.notEqual(canonical(clientMarkup(payload)), canonical(tampered));
  });

  test("a lost space between inline siblings is caught, and flex indentation is not", async () => {
    const client = clientMarkup(await seeded("blog.lychee.land"));
    const server = serverRegion("static-subdomain");
    // The breadcrumb as React first wrote it: no whitespace between its three
    // children, which rendered "sites/host" where the server rendered "sites / host".
    const squeezed = server.replace(/<\/a>\s+<span class="text-stone-600 mx-1\.5"/, '</a><span class="text-stone-600 mx-1.5"');
    assert.ok(squeezed !== server, "the negative case never changed the server markup");
    assert.equal(canonical(squeezed), canonical(server), "the lenient form cannot see it, which is why both run");
    assert.notEqual(canonical(client, { inlineWhitespace: true }), canonical(squeezed, { inlineWhitespace: true }));
    // Indentation inside a flex container is not a space, so dropping it is not a mismatch.
    const flexSqueezed = server.replace(/(<div class="flex items-start justify-between gap-4">)\s+/, "$1");
    assert.ok(flexSqueezed !== server, "the flex case never changed the server markup");
    assertInlineWhitespace(client, flexSqueezed);
  });

  test("a mismatch inside the repository card is caught", async () => {
    const payload = await seeded("legacy.lychee.land");
    const server = serverRegion("legacy-runbook");
    const tampered = server.replace("Commit these three files", "Commit these 3 files");
    assert.ok(tampered !== server, "the negative case never changed the server markup");
    assert.notEqual(canonical(clientMarkup(payload)), canonical(tampered));
  });
});

describe("the repository card, whole, in every branch", () => {
  test("legacy: the runbook, unattached, with the Attach form", async () => {
    const server = assertParity("legacy-runbook", await seeded("legacy.lychee.land"), [
      "form",
      'data-attach="legacy.lychee.land"',
      'id="attach-error"',
      "writes legacy-lychee-land.yml to lychee-resources",
      "Once the repository is attached and",
      'id="scaffold-file-0"',
      'data-copy-target="cmd-tag"',
      "docker compose down",
    ]);
    assert.ok(!server.includes("attach-warning"));
  });

  test("preview as seeded: awaiting its first image, 0.1.0 on offer as the Primary", async () => {
    const server = assertParity("preview-awaiting-first-image", await seeded("preview.lychee.land"), [
      'href="/services#service-preview-lychee-land"',
      rowKey("image"),
      'data-deploy="preview-lychee-land"',
      "<details",
      "Step 1, done",
      "· Dockerfile, .dockerignore, release.yml",
      'data-attached="true"',
    ]);
    assert.ok(!server.includes("data-change-repository"));
  });

  test("preview with no tag found: Change repository", async () => {
    const payload = await withResource("preview.lychee.land", (r) => ({ ...r, available: undefined }));
    const server = assertParity("preview-no-tag-found", payload, [
      'data-change-repository="preview.lychee.land"',
      'id="change-repo-error"',
      'value="preview-site"',
      "No image found at",
      "rewrites the image line in preview-lychee-land.yml",
      "Nothing to deploy until the image exists",
    ]);
    assert.ok(!server.includes("<details"));
  });

  test("preview before the reconciler has looked", async () => {
    const payload = await withResource("preview.lychee.land", (r) => ({ ...r, available: undefined, result: undefined }));
    const server = assertParity("preview-before-reconciler", payload, [
      "Attached. The reconciler looks for the image on its next run",
    ]);
    assert.ok(!server.includes("data-change-repository"));
  });

  test("preview with 0.1.0 already requested", async () => {
    const payload = await withResource("preview.lychee.land", (r) => ({ ...r, target: "0.1.0" }));
    assertParity("preview-requested", payload, ["0.1.0 requested</p>", "The reconciler pulls it and starts the container"]);
  });

  test("preview requested and blocked: the gate in full", async () => {
    const payload = await withResource("preview.lychee.land", (r) => ({
      ...r,
      target: "0.1.0",
      result: "blocked",
      gate: "blocked: ci-pending <&\"x>",
    }));
    const server = assertParity("preview-requested-blocked", payload, [
      "0.1.0 requested</p>",
      "data-gate>blocked: ci-pending &lt;&amp;",
    ]);
    assert.ok(!server.includes("The reconciler pulls it"));
  });

  test("preview after the offer was deployed: the requested line in the offer's place", async () => {
    const payload = await withResource("preview.lychee.land", (r) => ({ ...r, requestedTag: "0.1.0" }));
    const server = assertParity("preview-requested-line", payload, ["data-requested role=\"status\""]);
    assert.ok(!server.includes("data-deploy="));
  });

  test("app: installed, the board's offer", async () => {
    const server = assertParity("app-installed", await seeded("app.lychee.land"), [
      rowKey("running"),
      rowKey("repository"),
      "LycheeHome/app-site",
      'data-deploy="app-lychee-land"',
      'data-deploy-tag="0.3.0"',
      "Baked into the Dockerfile",
    ]);
    assert.ok(!server.includes("data-gate"));
  });

  test("app with 0.3.0 requested: the requested line", async () => {
    const payload = await withResource("app.lychee.land", (r) => ({ ...r, requestedTag: "0.3.0" }));
    const server = assertParity("app-requested-line", payload, [
      "data-requested role=\"status\"",
      "<span data-requested-tag>0.3.0</span> requested",
    ]);
    assert.ok(!server.includes("data-deploy="));
  });

  test("app with a pin in flight: the requested row", async () => {
    const payload = await withResource("app.lychee.land", (r) => ({ ...r, target: "0.3.0" }));
    assertParity("app-pin-in-flight", payload, [rowKey("requested")]);
  });

  test("app blocked: the gate line", async () => {
    const payload = await withResource("app.lychee.land", (r) => ({
      ...r,
      result: "blocked",
      gate: "provenance-failed: signer mismatch",
    }));
    assertParity("app-blocked", payload, ["data-gate>provenance-failed: signer mismatch</p>"]);
  });

  test("app: a redeploy failed while the old version runs", async () => {
    const payload = await withResource("app.lychee.land", (r) => ({
      ...r,
      target: "0.3.0",
      result: "failed",
      failedStep: "Pull the image: manifest unknown",
    }));
    assertParity("app-redeploy-failed", payload, ['<div class="flex flex-col gap-2 mt-3" data-deploy-failed>', "data-failed-step"]);
  });

  test("broken: a failed first deploy points up, with a newer tag on offer", async () => {
    assertParity("broken-failed-first-deploy", await seeded("broken.lychee.land"), [
      "failed; the reason is under the request path.",
      'data-deploy="broken-lychee-land"',
      'data-deploy-tag="0.1.1"',
      "To recover, publish a fixed tag",
    ]);
  });

  test("gone: the detached warning, with Prune as the Primary", async () => {
    const server = assertParity("gone-detached", await seeded("gone.lychee.land"), [
      'id="attach-warning"',
      'data-prune="gone-lychee-land"',
      'aria-describedby="attach-warning"',
    ]);
    assert.ok(!server.includes("data-attached"));
  });

  test("an inventory-only resource, nothing installed: the resource name stands in for the image", async () => {
    const payload = await withResource("preview.lychee.land", (r) => ({ ...r, repo: null, available: undefined }));
    const server = assertParity("inventory-only-nothing-installed", payload, [
      'preview-lychee-land <span class="text-stone-400">· preview-lychee-land.yml</span>',
      "No tag found for",
      "the image</span>",
    ]);
    assert.ok(!server.includes("data-change-repository"));
  });

  test("an inventory-only resource, installed: no repository row", async () => {
    const payload = await withResource("app.lychee.land", (r) => ({ ...r, repo: null }));
    const server = assertParity("inventory-only-installed", payload, ["tag to the site's repository; it is offered here"]);
    assert.ok(!server.includes(rowKey("repository")));
  });

  test("markup-shaped scaffold files and commands escape as the server escapes them", async () => {
    const payload = await seeded("legacy.lychee.land", {
      scaffold: { buildCommand: `npm run build <&"x>`, runCommand: "node server.js" },
      scaffoldFiles: [{ name: `a<b>.txt`, content: `<script>&"\n` }],
    });
    assertParity("escaping-scaffold", payload, ["&lt;script&gt;", "1 line</span>", "a&lt;b&gt;.txt"]);
  });
});

describe("SiteNotFound and CaddyfileError parity", () => {
  test("SiteNotFound matches the frozen not-found body", () => {
    const hostname = `nope<&"x>.lychee.land`;
    const server = serverRegion("not-found-escaped");
    assert.ok(server.includes("nope&lt;&amp;"), "the fixture never reached the escaped hostname");
    assert.equal(canonical(renderToStaticMarkup(<SiteNotFound hostname={hostname} />)), canonical(server));
  });

  test("CaddyfileError matches renderErrorPage", () => {
    const message = `caddy read failed: permission denied <&"x>\nopen /etc/caddy/Caddyfile: EACCES`;
    const server = mainRegion(renderErrorPage("Can't read the Caddyfile", message, testShell()));
    assert.equal(canonical(renderToStaticMarkup(<CaddyfileError message={message} />)), canonical(server));
  });
});

// Last in the file, so every test above has run: a frozen file no test reads
// is a branch that has quietly stopped being compared. The text-* files are
// SiteDetailMarkup.test.tsx's, and it checks them the same way.
describe("the frozen detail fixtures", () => {
  test("every fixture file is read by a parity test", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".html") && !f.startsWith("text-"))
      .sort();
    assert.deepEqual(files, [...read].sort());
  });
});
