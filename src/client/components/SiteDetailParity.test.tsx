import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Site } from "../../lib/caddyfile";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import { renderErrorPage, renderSiteDetail, renderSiteNotFound } from "../../views/html";
import {
  REPOSITORY_CARD,
  mainRegion,
  seedSiteDetailPayload as seedPayload,
  testShell,
  withoutRepositoryCard,
} from "../../dev/testHelpers";
import { CaddyfileError, SiteDetail, SiteNotFound } from "./SiteDetail";
import { canonical } from "../test/canonical";

/*
 * The React site page against the live server renderer (renderSiteDetail is
 * still the page's HTML until the migration retires it), for the header, the
 * request path with What to check, Manual steps and the Danger card with its
 * closed dialog. The repository card is Task 4's, so both sides are compared
 * with it cut out (withoutRepositoryCard, in src/dev/testHelpers.ts).
 */

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;

/** Ruling R3: React never renders the requested-line template app.js clones. */
const REQUESTED_TEMPLATE = /<template data-requested-template>[\s\S]*?<\/template>/;

function serverMarkup(site: Site, payload: Detail): string {
  // The payload carries every option the renderer reads; its other fields go unread.
  return mainRegion(renderSiteDetail(site, payload, testShell())).replace(REQUESTED_TEMPLATE, "");
}

function clientMarkup(payload: Detail): string {
  return renderToStaticMarkup(<SiteDetail payload={payload} />);
}

/** Asserts parity and returns the server region, so a test can check it reached the branch it names. */
function assertParity(site: Site, payload: Detail, reaches: string[] = []): string {
  const server = serverMarkup(site, payload);
  assert.equal(REPOSITORY_CARD.test(server), payload.scaffold !== undefined, "the repository card cut missed");
  assert.equal(canonical(withoutRepositoryCard(clientMarkup(payload))), canonical(withoutRepositoryCard(server)));
  for (const branch of reaches) assert.ok(server.includes(branch), `the server never reached ${branch}`);
  return server;
}

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
    assertParity(site, payload, ["responding", "data-state-pill"]);
  });

  test("api not responding", async () => {
    const { site, payload } = await seedPayload("api.lychee.land", { status: { kind: "tcp", responding: false } });
    assertParity(site, payload, ["What to check", "cmd-fix-listen", "Nothing answered on"]);
  });

  test("legacy: unattached Next.js with its old directory", async () => {
    const { site, payload } = await seedPayload("legacy.lychee.land");
    assertParity(site, payload, ["framework", "files", "docker compose down"]);
  });

  test("preview: attached, awaiting its first image", async () => {
    const { site, payload } = await seedPayload("preview.lychee.land");
    assertParity(site, payload, ["resource", "image", 'data-attached="true"']);
  });

  test("app: running an installed version", async () => {
    const { site, payload } = await seedPayload("app.lychee.land");
    assertParity(site, payload, ["/services#service-app-lychee-land"]);
  });

  test("app: an installed container in a bad state", async () => {
    const { site, payload } = await seedPayload("app.lychee.land", {
      status: { kind: "container", state: "exited" },
    });
    assertParity(site, payload, ["cmd-logs", "The container has stopped"]);
  });

  test("broken: a failed first deploy", async () => {
    const { site, payload } = await seedPayload("broken.lychee.land");
    assertParity(site, payload, ["data-deploy-failed", "To recover, publish a fixed tag"]);
  });

  test("gone: detached and re-added", async () => {
    const { site, payload } = await seedPayload("gone.lychee.land");
    assertParity(site, payload);
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
    assertParity(missing.site, missing.payload, ["unknown"]);
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
    const server = withoutRepositoryCard(serverMarkup(site, payload));
    const tampered = server.replace("Nothing answered on", "Nothing replied on");
    assert.ok(tampered !== server, "the negative case never changed the server markup");
    assert.notEqual(canonical(clientMarkup(payload)), canonical(tampered));
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
