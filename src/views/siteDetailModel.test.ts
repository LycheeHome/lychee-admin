import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { seedSiteDetailFacts } from "../dev/testHelpers";
import {
  addedNotice,
  appFix,
  canChangeRepository,
  cardOrder,
  deployStep,
  hopFixKeys,
  manualSteps,
  offerFor,
  removeDeclaration,
  removeSteps,
  runbookSteps,
  unitPhrase,
} from "./siteDetailModel";

describe("appFix", () => {
  test("a failed first deploy", async () => {
    const { site, facts } = await seedSiteDetailFacts("broken.lychee.land");
    assert.deepEqual(appFix(site, facts), { kind: "failed-first-deploy" });
  });

  test("a plain proxy nobody answered: the listen check", async () => {
    const { site, facts } = await seedSiteDetailFacts("api.lychee.land");
    assert.deepEqual(appFix(site, { ...facts, status: { kind: "tcp", responding: false } }), {
      kind: "port",
      command: "ss -ltn 'sport = :4000'",
    });
    assert.equal(appFix(site, { ...facts, status: { kind: "tcp", responding: true } }), null);
  });

  test("an installed container in a bad state: its logs by project name", async () => {
    const { site, facts } = await seedSiteDetailFacts("app.lychee.land");
    assert.deepEqual(appFix(site, { ...facts, status: { kind: "container", state: "exited" } }), {
      kind: "container",
      command: "docker compose -p app-lychee-land logs --tail 100",
    });
  });

  test("a never-created container has no fix", async () => {
    const { site, facts } = await seedSiteDetailFacts("app.lychee.land");
    assert.equal(appFix(site, { ...facts, status: { kind: "container", state: "not-created" } }), null);
  });

  test("a static site has none", async () => {
    const { site, facts } = await seedSiteDetailFacts("lychee.land");
    assert.equal(appFix(site, facts), null);
  });
});

describe("hopFixKeys", () => {
  test("a bad sites tunnel comes first, in request order", async () => {
    const { site, facts } = await seedSiteDetailFacts("broken.lychee.land");
    const keys = hopFixKeys(site, {
      ...facts,
      unitStates: {
        "cloudflared-sites.service": { status: "exited", since: null },
        "caddy.service": { status: "exited", since: null },
      },
    });
    assert.deepEqual(keys, ["tunnel", "caddy", "your app"]);
  });

  test("units missing from the read are unknown, which is neutral", async () => {
    const { site, facts } = await seedSiteDetailFacts("lychee.land");
    assert.deepEqual(hopFixKeys(site, { ...facts, unitStates: {} }), []);
    assert.deepEqual(hopFixKeys(site, { ...facts, unitStates: undefined }), []);
  });

  test("unitPhrase is the unit's pill word as a sentence", async () => {
    const { facts } = await seedSiteDetailFacts("lychee.land");
    const f = { ...facts, unitStates: { "caddy.service": { status: "exited" as const, since: null } } };
    assert.equal(unitPhrase(f, "caddy.service"), "has stopped");
  });
});

describe("runbookSteps", () => {
  test("preview with no tag found: 1 and 2 open, 3 done, nothing folds", async () => {
    const { site, facts } = await seedSiteDetailFacts("preview.lychee.land");
    assert.ok(facts.resource);
    const f = { ...facts, resource: { ...facts.resource, available: undefined } };
    assert.deepEqual(runbookSteps(site, f), [
      { n: 1, done: false, folds: false },
      { n: 2, done: false, folds: false },
      { n: 3, done: true, folds: false },
      { n: 4, done: false, folds: false },
    ]);
  });

  test("preview as seeded, with 0.1.0 found: 1 and 2 done and folded", async () => {
    const { site, facts } = await seedSiteDetailFacts("preview.lychee.land");
    assert.deepEqual(
      runbookSteps(site, facts).map((s) => [s.n, s.done, s.folds]),
      [
        [1, true, true],
        [2, true, true],
        [3, true, false],
        [4, false, false],
      ],
    );
  });

  test("legacy, unattached: nothing done", async () => {
    const { site, facts } = await seedSiteDetailFacts("legacy.lychee.land");
    assert.ok(runbookSteps(site, facts).every((s) => !s.done && !s.folds));
  });
});

describe("canChangeRepository", () => {
  test("attached, looked, found nothing", async () => {
    const { facts } = await seedSiteDetailFacts("preview.lychee.land");
    assert.ok(facts.resource);
    assert.equal(canChangeRepository({ ...facts.resource, available: undefined }), true);
  });

  test("not once a tag is found, written or installed, nor before the first look", async () => {
    const { facts } = await seedSiteDetailFacts("preview.lychee.land");
    const r = facts.resource;
    assert.ok(r);
    assert.equal(canChangeRepository(r), false);
    assert.equal(canChangeRepository({ ...r, available: undefined, target: "0.1.0" }), false);
    assert.equal(canChangeRepository({ ...r, available: undefined, result: undefined }), false);
    assert.equal(canChangeRepository({ ...r, available: undefined, result: "failed" }), false);
    assert.equal(canChangeRepository({ ...r, available: undefined, repo: null }), false);
    assert.equal(canChangeRepository(undefined), false);
  });
});

describe("offerFor", () => {
  test("app: 0.3.0 on offer beside the installed 0.2.0", async () => {
    const { facts } = await seedSiteDetailFacts("app.lychee.land");
    assert.deepEqual(offerFor(facts), { name: "app-lychee-land", tag: "0.3.0", requested: false, emphasis: "offer" });
  });

  test("app with 0.3.0 already requested", async () => {
    const { facts } = await seedSiteDetailFacts("app.lychee.land");
    assert.ok(facts.resource);
    const f = { ...facts, resource: { ...facts.resource, requestedTag: "0.3.0" } };
    assert.deepEqual(offerFor(f), { name: "app-lychee-land", tag: "0.3.0", requested: true, emphasis: "offer" });
  });

  test("a first deploy is the page's primary", async () => {
    const preview = await seedSiteDetailFacts("preview.lychee.land");
    assert.deepEqual(offerFor(preview.facts), { name: "preview-lychee-land", tag: "0.1.0", requested: false, emphasis: "primary" });
    const broken = await seedSiteDetailFacts("broken.lychee.land");
    assert.deepEqual(offerFor(broken.facts), { name: "broken-lychee-land", tag: "0.1.1", requested: false, emphasis: "primary" });
  });

  test("nothing to offer: unattached, not yet looked, or the found tag already pinned", async () => {
    const legacy = await seedSiteDetailFacts("legacy.lychee.land");
    assert.equal(offerFor(legacy.facts), null);
    const { facts } = await seedSiteDetailFacts("preview.lychee.land");
    assert.ok(facts.resource);
    assert.equal(offerFor({ ...facts, resource: { ...facts.resource, result: undefined } }), null);
    assert.equal(offerFor({ ...facts, resource: { ...facts.resource, target: "0.1.0" } }), null);
  });
});

describe("deployStep", () => {
  test("names which first-deploy branch the step is in", async () => {
    const legacy = await seedSiteDetailFacts("legacy.lychee.land");
    assert.equal(deployStep(legacy.facts.resource), "unattached");
    const { facts } = await seedSiteDetailFacts("preview.lychee.land");
    const r = facts.resource;
    assert.ok(r);
    assert.equal(deployStep({ ...r, result: undefined }), "unchecked");
    assert.equal(deployStep({ ...r, result: "failed" }), "failed");
    assert.equal(deployStep({ ...r, target: "0.1.0" }), "requested");
    assert.equal(deployStep({ ...r, target: "0.1.0", result: "blocked" }), "requested-blocked");
    assert.equal(deployStep(r), "offer");
    assert.equal(deployStep({ ...r, available: undefined }), "awaiting-image-change");
    assert.equal(deployStep({ ...r, available: undefined, repo: null }), "awaiting-image");
  });
});

describe("cardOrder", () => {
  test("attached: the repository card leads", async () => {
    const { facts } = await seedSiteDetailFacts("app.lychee.land");
    assert.deepEqual(cardOrder(facts), ["path", "repository", "manual", "danger"]);
  });

  test("unattached: manual steps lead", async () => {
    const { facts } = await seedSiteDetailFacts("legacy.lychee.land");
    assert.deepEqual(cardOrder(facts), ["path", "manual", "repository", "danger"]);
  });

  test("a static site has no repository card", async () => {
    const { facts } = await seedSiteDetailFacts("blog.lychee.land");
    assert.deepEqual(cardOrder(facts), ["path", "manual", "danger"]);
  });
});

describe("removeSteps", () => {
  const BASE = ["caddyfile", "tunnel", "caddy", "cloudflared"];

  test("four steps for an unattached site", async () => {
    const { site, facts } = await seedSiteDetailFacts("legacy.lychee.land");
    const steps = removeSteps(site, facts);
    assert.deepEqual(steps.map((s) => s.id), BASE);
    assert.deepEqual(steps.map((s) => s.label), [
      "Caddyfile block removed",
      "Tunnel route removed",
      "Caddy validated and reloaded",
      "cloudflared-sites restarted",
    ]);
  });

  test("a fifth, retiring the declaration, for an attached one", async () => {
    const { site, facts } = await seedSiteDetailFacts("app.lychee.land");
    const steps = removeSteps(site, facts);
    assert.deepEqual(steps.map((s) => s.id), [...BASE, "declaration"]);
    assert.equal(steps[4].label, "app-lychee-land.yml set to state: absent");
    assert.equal(removeDeclaration(site, facts), "app-lychee-land");
  });

  // One predicate decides the fifth step and whether the chain posts /detach:
  // the two must never disagree.
  test("no fifth step, and nothing to retire, on a site with no framework", async () => {
    const { facts: attached } = await seedSiteDetailFacts("app.lychee.land");
    const { site, facts } = await seedSiteDetailFacts("api.lychee.land");
    const withResource = { ...facts, resource: attached.resource };
    assert.deepEqual(removeSteps(site, withResource).map((s) => s.id), BASE);
    assert.equal(removeDeclaration(site, withResource), null);
  });
});

describe("addedNotice", () => {
  test("one sentence per type", async () => {
    assert.match(addedNotice((await seedSiteDetailFacts("blog.lychee.land")).site), /^Added blog\.lychee\.land — Caddy is serving/);
    assert.match(addedNotice((await seedSiteDetailFacts("app.lychee.land")).site), /shows as not deployed/);
    assert.match(addedNotice((await seedSiteDetailFacts("api.lychee.land")).site), /nothing is listening on port 4000 yet/);
  });

  // These three were html.test.ts's "the ?created=1 notice" tests of the
  // server site page's banner; the sentences are addedNotice's, which the
  // shell's #page-notice carries (its placement is tested in sites.test.ts).
  test("a static site is told its placeholder is already live", () => {
    const notice = addedNotice({ hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" });
    assert.match(notice, /Added blog\.lychee\.land/);
    assert.match(notice, /serving the placeholder page it created/);
    assert.match(notice, /Manual steps has the DNS record/);
  });

  test("a plain proxy is told why it reads as not responding", () => {
    const notice = addedNotice({ hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" });
    assert.match(notice, /routing is live/);
    assert.match(notice, /nothing is listening on port 4000 yet/);
    assert.match(notice, /not responding until you start your process/);
  });

  test("a scaffolded site is told why it reads as not deployed", () => {
    const notice = addedNotice({
      hostname: "app.lychee.land",
      type: "reverse-proxy",
      target: "3000",
      framework: "nextjs",
      healthcheckPath: "/api/health",
    });
    assert.match(notice, /routing is live/);
    // Add-site writes nothing to /var/www for a Next.js site any more.
    assert.doesNotMatch(notice, /\/var\/www/);
    assert.match(notice, /not deployed until a repository is attached/);
    assert.match(notice, /From a repository has the steps/);
  });

  // Re-adding a site before its old declaration is pruned is the main way into
  // the retired state; the notice must explain the retired pill beside it, not
  // contradict it with "not deployed".
  test("a site re-added over a retired declaration is told why it reads as retired", async () => {
    const notice = addedNotice((await seedSiteDetailFacts("gone.lychee.land")).site, { retired: true });
    assert.equal(
      notice,
      "Added gone.lychee.land — routing is live. It shows as retired until its old declaration is pruned; Prune is just below.",
    );
  });
});

describe("manualSteps", () => {
  test("with a tunnel id: the CNAME target, then route dns as the fallback", async () => {
    const { site, facts } = await seedSiteDetailFacts("app.lychee.land");
    const [dns, ...rest] = manualSteps(site, facts, null);
    assert.equal(rest.length, 0);
    assert.deepEqual(dns.command, { id: "cmd-dns-target", value: "11111111-2222-3333-4444-555555555555.cfargotunnel.com", label: "Copy CNAME target" });
    assert.ok(dns.text.some((part) => typeof part !== "string" && part.code === "app"));
    assert.equal(dns.then?.command.value, "cloudflared tunnel route dns 11111111-2222-3333-4444-555555555555 app.lychee.land");
  });

  test("the apex's record is named @", async () => {
    const { site, facts } = await seedSiteDetailFacts("lychee.land");
    const [dns] = manualSteps(site, facts, "/var/www/lychee.land");
    assert.ok(dns.text.some((part) => typeof part !== "string" && part.code === "@"));
  });

  test("without one: the dashboard instruction alone", async () => {
    const { site, facts } = await seedSiteDetailFacts("app.lychee.land");
    const [dns] = manualSteps(site, { ...facts, tunnelId: "" }, null);
    assert.equal(dns.command, undefined);
    assert.equal(dns.text.length, 1);
  });

  test("a static site also gets the placeholder step", async () => {
    const { site, facts } = await seedSiteDetailFacts("blog.lychee.land");
    const steps = manualSteps(site, facts, "/var/www/blog.lychee.land");
    assert.equal(steps.length, 2);
    assert.deepEqual(steps[1].text, [
      "Put your site's files in /var/www/blog.lychee.land/. lychee-admin created a placeholder index.html there, which Caddy serves until you replace it.",
    ]);
  });
});

test("the model imports nothing from node", () => {
  const source = readFileSync(path.join(__dirname, "siteDetailModel.ts"), "utf8");
  assert.doesNotMatch(source, /from "node:/);
  assert.doesNotMatch(source, /from "\.\.\/config"/);
  assert.doesNotMatch(source, /^import \{[^}]*\} from "\.\.\/lib\/platform"/m);
});
