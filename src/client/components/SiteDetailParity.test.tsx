import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Site } from "../../lib/caddyfile";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import { renderErrorPage, renderSiteDetail, renderSiteNotFound } from "../../views/html";
import { DETAIL_KEY, type SiteResourceView } from "../../views/siteDetailModel";
import { mainRegion, seedSiteDetailPayload as seedPayload, testShell } from "../../dev/testHelpers";
import { CaddyfileError, SiteDetail, SiteNotFound } from "./SiteDetail";
import { canonical } from "../test/canonical";

/*
 * The React site page against the live server renderer (renderSiteDetail is
 * still the page's HTML until the migration retires it), whole: the header,
 * the request path with What to check, the repository card in both shapes,
 * Manual steps and the Danger card with its closed dialog.
 *
 * The one sanctioned difference (ruling R3, spec §5): the server appends an
 * inert <template data-requested-template> for app.js to clone after a
 * Deploy, and React never renders it, so the server side is compared without
 * it. Nothing else is cut.
 */

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;

/** Ruling R3: React never renders the requested-line template app.js clones. */
const REQUESTED_TEMPLATE = /<template data-requested-template>[\s\S]*?<\/template>/;

function serverMarkup(site: Site, payload: Detail): string {
  // The payload carries every option the renderer reads; its other fields go unread.
  const raw = mainRegion(renderSiteDetail(site, payload, testShell()));
  const stripped = raw.replace(REQUESTED_TEMPLATE, "");
  // The server appends the template wherever it renders an offer: if the
  // strip stops matching it, the comparison would fail on it, or (worse) a
  // changed template would no longer be stripped at all.
  if (raw.includes("data-offer")) {
    assert.ok(raw.includes("data-requested-template"), "an offer without its requested-line template");
    assert.ok(!stripped.includes("data-requested-template"), "the requested-line template was not stripped");
  }
  return stripped;
}

function clientMarkup(payload: Detail): string {
  return renderToStaticMarkup(<SiteDetail payload={payload} />);
}

/** Asserts parity and returns the server region, so a test can check it reached the branch it names. */
function assertParity(site: Site, payload: Detail, reaches: string[] = []): string {
  const server = serverMarkup(site, payload);
  assert.equal(canonical(clientMarkup(payload)), canonical(server));
  for (const branch of reaches) assert.ok(server.includes(branch), `the server never reached ${branch}`);
  return server;
}

/** The seed payload with its resource changed: a branch the seed does not hold as it stands. */
async function withResource(hostname: string, change: (r: SiteResourceView) => SiteResourceView) {
  const { site, payload } = await seedPayload(hostname);
  assert.ok(payload.resource, `${hostname} has no resource in the seed`);
  return { site, payload: { ...payload, resource: change(payload.resource) } };
}

/** A detail row's key, as only the request path or the installed card writes it. */
const rowKey = (key: string) => `<span class="${DETAIL_KEY}">${key}</span>`;
/** A hop or pill status word: the dot, then the word, as one phrase. */
const HOP_UNKNOWN = '<p class="font-mono text-[0.72rem] text-stone-300 m-0" data-hop-status><span aria-hidden="true">●</span> unknown</p>';
const PILL_RESPONDING = '<span aria-hidden="true">&#9679;</span> responding</span>';

const BAD = { status: "exited", since: null } as const;
const RESTARTING = { status: "restarting", since: null } as const;
const RUNNING = { status: "running", since: null } as const;

describe("SiteDetail parity with renderSiteDetail", () => {
  test("lychee.land, the apex, with its directory", async () => {
    const { site, payload } = await seedPayload("lychee.land");
    assertParity(site, payload, ["Your files", "confirm-remove-delete-files", "placeholder index.html"]);
  });

  test("lychee.land without its directory", async () => {
    const { site, payload } = await seedPayload("lychee.land", { filesExist: false });
    const server = assertParity(site, payload);
    assert.ok(!server.includes("confirm-remove-delete-files"));
  });

  test("blog.lychee.land, a static subdomain", async () => {
    const { site, payload } = await seedPayload("blog.lychee.land");
    assertParity(site, payload, ['<span class="text-stone-500">.lychee.land</span>']);
  });

  test("api responding", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", { status: { kind: "tcp", responding: true } });
    const server = assertParity(site, payload, [PILL_RESPONDING]);
    assert.ok(!server.includes("not responding"));
  });

  test("api not responding", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", { status: { kind: "tcp", responding: false } });
    assertParity(site, payload, ["What to check", "cmd-fix-listen", "Nothing answered on"]);
  });

  test("app: an installed container in a bad state", async () => {
    const { site, payload } = await seedPayload("app.lychee.land", {
      status: { kind: "container", state: "exited" },
    });
    assertParity(site, payload, ["cmd-logs", "The container has stopped"]);
  });

  test("a bad tunnel", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", {
      status: { kind: "tcp", responding: true },
      unitStates: { "cloudflared-sites.service": BAD, "caddy.service": RUNNING },
    });
    const server = assertParity(site, payload, ["cmd-fix-tunnel", "The sites tunnel has stopped"]);
    assert.ok(!server.includes("cmd-fix-caddy"));
  });

  test("a bad Caddy", async () => {
    const { site, payload } = await seedPayload("lychee.land", {
      unitStates: { "cloudflared-sites.service": RUNNING, "caddy.service": RESTARTING },
    });
    const server = assertParity(site, payload, ["cmd-fix-caddy", "Caddy keeps restarting"]);
    assert.ok(!server.includes("cmd-fix-tunnel"));
  });

  test("a bad tunnel and a bad Caddy, beside a bad app", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", {
      status: { kind: "tcp", responding: false },
      unitStates: { "cloudflared-sites.service": BAD, "caddy.service": RESTARTING },
    });
    assertParity(site, payload, ["cmd-fix-tunnel", "cmd-fix-caddy", "cmd-fix-listen"]);
  });

  test("unit states missing, and not read at all", async () => {
    const missing = await seedPayload("lychee.land", { unitStates: {} });
    assertParity(missing.site, missing.payload, [HOP_UNKNOWN]);
    const unread = await seedPayload("lychee.land", { unitStates: undefined });
    const server = assertParity(unread.site, unread.payload);
    assert.ok(!server.includes("data-hop-status"));
  });

  test("an empty tunnelId", async () => {
    const { site, payload } = await seedPayload("blog.lychee.land", { tunnelId: "" });
    const server = assertParity(site, payload, ["add a CNAME for this hostname to your tunnel"]);
    assert.ok(!server.includes("cmd-dns"));
  });

  test("the DNS steps carry their copy targets", async () => {
    const { site, payload } = await seedPayload("blog.lychee.land");
    assertParity(site, payload, ['data-copy-target="cmd-dns-target"', 'data-copy-target="cmd-dns"']);
  });

  test("the dialog for a plain site", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", { status: { kind: "tcp", responding: true } });
    const server = assertParity(site, payload, ['id="confirm-remove-dialog"', "cloudflared-sites restarted"]);
    assert.ok(!server.includes("data-attached"));
    assert.ok(!server.includes("Step 5 is what stops the container"));
  });

  test("the dialog for an attached site", async () => {
    const { site, payload } = await seedPayload("app.lychee.land");
    assertParity(site, payload, [
      'data-attached="true"',
      "app-lychee-land.yml set to state: absent",
      "Step 5 is what stops the container",
    ]);
  });

  test("markup-shaped values escape as the server escapes them", async () => {
    const { site, payload } = await seedPayload("blog.lychee.land", {
      tunnelId: `<id&"x>`,
      domain: "lychee.land",
    });
    assertParity(site, payload, ["&lt;id&amp;"]);
  });

  test("a mismatch is caught", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", { status: { kind: "tcp", responding: false } });
    const server = serverMarkup(site, payload);
    const tampered = server.replace("Nothing answered on", "Nothing replied on");
    assert.ok(tampered !== server, "the negative case never changed the server markup");
    assert.notEqual(canonical(clientMarkup(payload)), canonical(tampered));
  });

  test("a mismatch inside the repository card is caught", async () => {
    const { site, payload } = await seedPayload("legacy.lychee.land");
    const server = serverMarkup(site, payload);
    const tampered = server.replace("Commit these three files", "Commit these 3 files");
    assert.ok(tampered !== server, "the negative case never changed the server markup");
    assert.notEqual(canonical(clientMarkup(payload)), canonical(tampered));
  });
});

describe("the repository card, whole, in every branch", () => {
  test("legacy: the runbook, unattached, with the Attach form", async () => {
    const { site, payload } = await seedPayload("legacy.lychee.land");
    const server = assertParity(site, payload, [
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
    const { site, payload } = await seedPayload("preview.lychee.land");
    const server = assertParity(site, payload, [
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
    const { site, payload } = await withResource("preview.lychee.land", (r) => ({ ...r, available: undefined }));
    const server = assertParity(site, payload, [
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
    const { site, payload } = await withResource("preview.lychee.land", (r) => ({ ...r, available: undefined, result: undefined }));
    const server = assertParity(site, payload, ["Attached. The reconciler looks for the image on its next run"]);
    assert.ok(!server.includes("data-change-repository"));
  });

  test("preview with 0.1.0 already requested", async () => {
    const { site, payload } = await withResource("preview.lychee.land", (r) => ({ ...r, target: "0.1.0" }));
    assertParity(site, payload, ["0.1.0 requested</p>", "The reconciler pulls it and starts the container"]);
  });

  test("preview requested and blocked: the gate in full", async () => {
    const { site, payload } = await withResource("preview.lychee.land", (r) => ({
      ...r,
      target: "0.1.0",
      result: "blocked",
      gate: "blocked: ci-pending <&\"x>",
    }));
    const server = assertParity(site, payload, ["0.1.0 requested</p>", "data-gate>blocked: ci-pending &lt;&amp;"]);
    assert.ok(!server.includes("The reconciler pulls it"));
  });

  test("preview after the offer was deployed: the requested line in the offer's place", async () => {
    const { site, payload } = await withResource("preview.lychee.land", (r) => ({ ...r, requestedTag: "0.1.0" }));
    const server = assertParity(site, payload, ["data-requested role=\"status\""]);
    assert.ok(!server.includes("data-deploy="));
  });

  test("app: installed, the board's offer", async () => {
    const { site, payload } = await seedPayload("app.lychee.land");
    // The R3 strip removed something here, so the offer cases compare without it rather than never having it.
    const raw = mainRegion(renderSiteDetail(site, payload, testShell()));
    assert.ok(raw.includes("data-requested-template"));
    assert.ok(raw.replace(REQUESTED_TEMPLATE, "").length < raw.length);
    const server = assertParity(site, payload, [
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
    const { site, payload } = await withResource("app.lychee.land", (r) => ({ ...r, requestedTag: "0.3.0" }));
    const server = assertParity(site, payload, ["data-requested role=\"status\"", "<span data-requested-tag>0.3.0</span> requested"]);
    assert.ok(!server.includes("data-deploy="));
  });

  test("app with a pin in flight: the requested row", async () => {
    const { site, payload } = await withResource("app.lychee.land", (r) => ({ ...r, target: "0.3.0" }));
    assertParity(site, payload, [rowKey("requested")]);
  });

  test("app blocked: the gate line", async () => {
    const { site, payload } = await withResource("app.lychee.land", (r) => ({
      ...r,
      result: "blocked",
      gate: "provenance-failed: signer mismatch",
    }));
    assertParity(site, payload, ["data-gate>provenance-failed: signer mismatch</p>"]);
  });

  test("app: a redeploy failed while the old version runs", async () => {
    const { site, payload } = await withResource("app.lychee.land", (r) => ({
      ...r,
      target: "0.3.0",
      result: "failed",
      failedStep: "Pull the image: manifest unknown",
    }));
    assertParity(site, payload, ['<div class="flex flex-col gap-2 mt-3" data-deploy-failed>', "data-failed-step"]);
  });

  test("broken: a failed first deploy points up, with a newer tag on offer", async () => {
    const { site, payload } = await seedPayload("broken.lychee.land");
    assertParity(site, payload, [
      "failed; the reason is under the request path.",
      'data-deploy="broken-lychee-land"',
      'data-deploy-tag="0.1.1"',
      "To recover, publish a fixed tag",
    ]);
  });

  test("gone: the detached warning, with Prune as the Primary", async () => {
    const { site, payload } = await seedPayload("gone.lychee.land");
    const server = assertParity(site, payload, [
      'id="attach-warning"',
      'data-prune="gone-lychee-land"',
      'aria-describedby="attach-warning"',
    ]);
    assert.ok(!server.includes("data-attached"));
  });

  test("an inventory-only resource, nothing installed: the resource name stands in for the image", async () => {
    const { site, payload } = await withResource("preview.lychee.land", (r) => ({ ...r, repo: null, available: undefined }));
    const server = assertParity(site, payload, [
      'preview-lychee-land <span class="text-stone-400">· preview-lychee-land.yml</span>',
      "No tag found for",
      "the image</span>",
    ]);
    assert.ok(!server.includes("data-change-repository"));
  });

  test("an inventory-only resource, installed: no repository row", async () => {
    const { site, payload } = await withResource("app.lychee.land", (r) => ({ ...r, repo: null }));
    const server = assertParity(site, payload, ["tag to the site's repository; it is offered here"]);
    assert.ok(!server.includes(rowKey("repository")));
  });

  test("markup-shaped scaffold files and commands escape as the server escapes them", async () => {
    const { site, payload } = await seedPayload("legacy.lychee.land", {
      scaffold: { buildCommand: `npm run build <&"x>`, runCommand: "node server.js" },
      scaffoldFiles: [{ name: `a<b>.txt`, content: `<script>&"\n` }],
    });
    assertParity(site, payload, ["&lt;script&gt;", "1 line</span>", "a&lt;b&gt;.txt"]);
  });
});

describe("SiteNotFound and CaddyfileError parity", () => {
  test("SiteNotFound matches renderSiteNotFound", () => {
    const hostname = `nope<&"x>.lychee.land`;
    const server = mainRegion(renderSiteNotFound(hostname, testShell()));
    assert.equal(canonical(renderToStaticMarkup(<SiteNotFound hostname={hostname} />)), canonical(server));
  });

  test("CaddyfileError matches renderErrorPage", () => {
    const message = `caddy read failed: permission denied <&"x>\nopen /etc/caddy/Caddyfile: EACCES`;
    const server = mainRegion(renderErrorPage("Can't read the Caddyfile", message, testShell()));
    assert.equal(canonical(renderToStaticMarkup(<CaddyfileError message={message} />)), canonical(server));
  });
});
