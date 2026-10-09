import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendSite, computeFilesPath, hostnameExists, parseSites, removeSite } from "./caddyfile";

const SAMPLE = `{
	auto_https off
}

http://lychee.land {
	root * /var/www/lychee.land
	file_server
}

http://api.lychee.land {
	reverse_proxy localhost:4000
}

http://app.lychee.land {
	# lyly-admin-framework: nextjs
	# lyly-admin-healthcheck: /api/health
	reverse_proxy localhost:3000
}
`;

describe("parseSites", () => {
  test("skips the global options block and returns one entry per site", () => {
    const sites = parseSites(SAMPLE);
    assert.equal(sites.length, 3);
    assert.deepEqual(
      sites.map((s) => s.hostname),
      ["lychee.land", "api.lychee.land", "app.lychee.land"],
    );
  });

  test("reads a static site's root path", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "lychee.land");
    assert.deepEqual(site, { hostname: "lychee.land", type: "static", target: "/var/www/lychee.land" });
  });

  test("reads a plain reverse proxy's port and sets no framework", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "api.lychee.land");
    assert.deepEqual(site, { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" });
  });

  test("reads the framework and healthcheck marker comments", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "app.lychee.land");
    assert.deepEqual(site, {
      hostname: "app.lychee.land",
      type: "reverse-proxy",
      target: "3000",
      framework: "nextjs",
      healthcheckPath: "/api/health",
    });
  });

  test("returns an empty array for content with no site blocks", () => {
    assert.deepEqual(parseSites("{\n\tauto_https off\n}\n"), []);
  });

  test("reads the framework marker with no healthcheck comment (pre-healthcheck legacy shape)", () => {
    const LEGACY_FRAMEWORK_ONLY = `http://legacy.lychee.land {
\t# lyly-admin-framework: nextjs
\treverse_proxy localhost:3001
}
`;
    const site = parseSites(LEGACY_FRAMEWORK_ONLY).find((s) => s.hostname === "legacy.lychee.land");
    assert.equal(site?.framework, "nextjs");
    assert.equal(site?.healthcheckPath, undefined);
  });
});

describe("appendSite", () => {
  test("appends a static block with root and file_server", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lychee.land",
      type: "static",
      target: "/var/www/new.lychee.land",
    });
    assert.match(result, /http:\/\/new\.lychee\.land \{\n\troot \* \/var\/www\/new\.lychee\.land\n\tfile_server\n\}/);
    assert.equal(parseSites(result).length, 4);
  });

  test("appends a reverse-proxy block with no marker comments when no framework given", () => {
    const result = appendSite(SAMPLE, { hostname: "new.lychee.land", type: "reverse-proxy", target: "5000" });
    assert.match(result, /http:\/\/new\.lychee\.land \{\n\treverse_proxy localhost:5000\n\}/);
    assert.doesNotMatch(result, /new\.lychee\.land[\s\S]*lyly-admin-framework/);
  });

  test("writes both marker comments when a framework is given", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lychee.land",
      type: "reverse-proxy",
      target: "5000",
      framework: "nextjs",
      healthcheckPath: "/healthz",
    });
    assert.match(result, /\t# lyly-admin-framework: nextjs\n\t# lyly-admin-healthcheck: \/healthz\n/);
  });

  test("defaults the healthcheck comment to / when a framework has no path", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lychee.land",
      type: "reverse-proxy",
      target: "5000",
      framework: "nextjs",
    });
    assert.match(result, /\t# lyly-admin-healthcheck: \/\n/);
  });

  test("ends with exactly one trailing newline", () => {
    const result = appendSite(SAMPLE, { hostname: "new.lychee.land", type: "reverse-proxy", target: "5000" });
    assert.match(result, /\}\n$/);
    assert.doesNotMatch(result, /\n\n$/);
  });
});

describe("removeSite", () => {
  test("removes only the named block", () => {
    const result = removeSite(SAMPLE, "api.lychee.land");
    assert.equal(hostnameExists(result, "api.lychee.land"), false);
    assert.equal(hostnameExists(result, "lychee.land"), true);
    assert.equal(hostnameExists(result, "app.lychee.land"), true);
  });

  test("collapses the blank lines the removal leaves behind", () => {
    const result = removeSite(SAMPLE, "api.lychee.land");
    assert.doesNotMatch(result, /\n{3,}/);
  });

  test("throws for a hostname with no block", () => {
    assert.throws(() => removeSite(SAMPLE, "absent.lychee.land"), /No Caddyfile block found/);
  });
});

describe("hostnameExists", () => {
  test("is true for a present hostname and false for an absent one", () => {
    assert.equal(hostnameExists(SAMPLE, "app.lychee.land"), true);
    assert.equal(hostnameExists(SAMPLE, "absent.lychee.land"), false);
  });
});

describe("computeFilesPath", () => {
  test("returns sitesRoot/hostname for a static site", () => {
    const site = { hostname: "blog.lychee.land", type: "static" as const, target: "/var/www/blog.lychee.land" };
    assert.equal(computeFilesPath(site, "/var/www"), "/var/www/blog.lychee.land");
  });

  test("returns sitesRoot/hostname for a scaffolded reverse proxy", () => {
    const site = {
      hostname: "app.lychee.land",
      type: "reverse-proxy" as const,
      target: "3000",
      framework: "nextjs",
    };
    assert.equal(computeFilesPath(site, "/var/www"), "/var/www/app.lychee.land");
  });

  test("returns null for a reverse proxy with no framework", () => {
    const site = { hostname: "api.lychee.land", type: "reverse-proxy" as const, target: "4000" };
    assert.equal(computeFilesPath(site, "/var/www"), null);
  });
});
