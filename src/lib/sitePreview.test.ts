import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readSiteInput, type SiteEnv } from "./siteValidation";
import { appendSite } from "./caddyfile";
import { addIngressRule } from "./tunnelConfig";
import { buildSitePreview, diffInserted } from "./sitePreview";

const ENV: SiteEnv = {
  domain: "lychee.land",
  sitesRoot: "/var/www",
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  reservedPorts: [8787, 2019],
};

const CADDYFILE = `{
\tauto_https off
}

http://blog.lychee.land {
\troot * /var/www/blog.lychee.land
\tfile_server
}
`;

const TUNNEL = `tunnel: 11111111-2222-3333-4444-555555555555
ingress:
  - hostname: blog.lychee.land
    service: http://localhost:80
  - service: http_status:404
`;

const EXISTING = { caddyfileContent: CADDYFILE, tunnelContent: TUNNEL };

describe("diffInserted", () => {
  test("finds text appended at the end, with no context line after it", () => {
    const result = diffInserted("a\nb\n", "a\nb\n\nc\nd\n");
    assert.deepEqual(result.added, ["c", "d"]);
    assert.equal(result.contextAfter, null);
  });

  test("finds text spliced into the middle, and names the line it lands above", () => {
    const result = diffInserted("a\nb\nz\n", "a\nb\nc\nz\n");
    assert.deepEqual(result.added, ["c"]);
    assert.equal(result.contextAfter, "z");
  });

  test("reports nothing added when the two are identical", () => {
    assert.deepEqual(diffInserted("a\nb\n", "a\nb\n").added, []);
  });
});

describe("buildSitePreview — static", () => {
  const preview = buildSitePreview(readSiteInput({ hostname: "docs.lychee.land" }), EXISTING, ENV);

  test("the Caddyfile lines it reports are exactly what appendSite would write", () => {
    const after = appendSite(CADDYFILE, {
      hostname: "docs.lychee.land",
      type: "static",
      target: "/var/www/docs.lychee.land",
    });
    assert.ok(after.includes(preview.caddy.added.join("\n")));
    assert.deepEqual(preview.caddy.added, [
      "http://docs.lychee.land {",
      "\troot * /var/www/docs.lychee.land",
      "\tfile_server",
      "}",
    ]);
  });

  test("the ingress lines it reports are exactly what addIngressRule would write", () => {
    const after = addIngressRule(TUNNEL, "docs.lychee.land", "http://localhost:80");
    assert.ok(after.includes(preview.tunnel.added.join("\n")));
    assert.deepEqual(preview.tunnel.added, [
      "  - hostname: docs.lychee.land",
      "    service: http://localhost:80",
    ]);
  });

  test("shows the catch-all the route is inserted above, so the position is visible", () => {
    assert.equal(preview.tunnel.contextAfter, "  - service: http_status:404");
  });

  test("a static site creates its directory and a placeholder page", () => {
    assert.deepEqual(preview.files, { path: "/var/www/docs.lychee.land", creates: ["index.html"] });
  });

  test("every step runs for a static site", () => {
    assert.deepEqual(preview.steps.filter((step) => !step.willRun), []);
  });

  test("carries the paths it is describing, so the panel never hardcodes them", () => {
    assert.equal(preview.caddy.path, "/etc/caddy/Caddyfile");
    assert.equal(preview.tunnel.path, "/etc/cloudflared/sites-config.yml");
  });
});

describe("buildSitePreview — plain reverse proxy", () => {
  const preview = buildSitePreview(
    readSiteInput({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "4100" }),
    EXISTING,
    ENV,
  );

  test("writes a reverse_proxy block with no marker comments", () => {
    assert.deepEqual(preview.caddy.added, [
      "http://docs.lychee.land {",
      "\treverse_proxy localhost:4100",
      "}",
    ]);
  });

  test("creates no directory, so the files step is the one that will not run", () => {
    assert.equal(preview.files, null);
    const skipped = preview.steps.filter((step) => !step.willRun).map((step) => step.id);
    assert.deepEqual(skipped, ["files"]);
  });
});

describe("buildSitePreview — Next.js reverse proxy", () => {
  const preview = buildSitePreview(
    readSiteInput({
      hostname: "docs.lychee.land",
      type: "reverse-proxy",
      port: "4100",
      framework: "nextjs",
      healthcheckPath: "/api/health",
    }),
    EXISTING,
    ENV,
  );

  test("records both marker comments inside the block", () => {
    assert.deepEqual(preview.caddy.added, [
      "http://docs.lychee.land {",
      "\t# lyly-admin-framework: nextjs",
      "\t# lyly-admin-healthcheck: /api/health",
      "\treverse_proxy localhost:4100",
      "}",
    ]);
  });

  test("lists the scaffold files as to copy into the site's repository, not written to /var/www", () => {
    assert.deepEqual(preview.files, {
      path: "Copy into your site's repository",
      creates: ["Dockerfile", ".dockerignore", ".github/workflows/release.yml"],
      destination: "repository",
    });
    assert.doesNotMatch(JSON.stringify(preview.files), /\/var\/www/);
  });

  test("the host files step does not run, since nothing is created on the host", () => {
    assert.deepEqual(preview.steps.filter((step) => !step.willRun).map((step) => step.id), ["files"]);
  });
});
