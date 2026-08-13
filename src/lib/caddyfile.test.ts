import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendSite, computeFilesPath, hostnameExists, parseSites, removeSite } from "./caddyfile";

const SAMPLE = `{
	auto_https off
}

http://lyly.dev {
	root * /var/www/lyly.dev
	file_server
}

http://api.lyly.dev {
	reverse_proxy localhost:4000
}

http://app.lyly.dev {
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
      ["lyly.dev", "api.lyly.dev", "app.lyly.dev"],
    );
  });

  test("reads a static site's root path", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "lyly.dev");
    assert.deepEqual(site, { hostname: "lyly.dev", type: "static", target: "/var/www/lyly.dev" });
  });

  test("reads a plain reverse proxy's port and sets no framework", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "api.lyly.dev");
    assert.deepEqual(site, { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" });
  });

  test("reads the framework and healthcheck marker comments", () => {
    const site = parseSites(SAMPLE).find((s) => s.hostname === "app.lyly.dev");
    assert.deepEqual(site, {
      hostname: "app.lyly.dev",
      type: "reverse-proxy",
      target: "3000",
      framework: "nextjs",
      healthcheckPath: "/api/health",
    });
  });

  test("returns an empty array for content with no site blocks", () => {
    assert.deepEqual(parseSites("{\n\tauto_https off\n}\n"), []);
  });
});

describe("appendSite", () => {
  test("appends a static block with root and file_server", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lyly.dev",
      type: "static",
      target: "/var/www/new.lyly.dev",
    });
    assert.match(result, /http:\/\/new\.lyly\.dev \{\n\troot \* \/var\/www\/new\.lyly\.dev\n\tfile_server\n\}/);
    assert.equal(parseSites(result).length, 4);
  });

  test("appends a reverse-proxy block with no marker comments when no framework given", () => {
    const result = appendSite(SAMPLE, { hostname: "new.lyly.dev", type: "reverse-proxy", target: "5000" });
    assert.match(result, /http:\/\/new\.lyly\.dev \{\n\treverse_proxy localhost:5000\n\}/);
    assert.doesNotMatch(result, /new\.lyly\.dev[\s\S]*lyly-admin-framework/);
  });

  test("writes both marker comments when a framework is given", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lyly.dev",
      type: "reverse-proxy",
      target: "5000",
      framework: "nextjs",
      healthcheckPath: "/healthz",
    });
    assert.match(result, /\t# lyly-admin-framework: nextjs\n\t# lyly-admin-healthcheck: \/healthz\n/);
  });

  test("defaults the healthcheck comment to / when a framework has no path", () => {
    const result = appendSite(SAMPLE, {
      hostname: "new.lyly.dev",
      type: "reverse-proxy",
      target: "5000",
      framework: "nextjs",
    });
    assert.match(result, /\t# lyly-admin-healthcheck: \/\n/);
  });

  test("ends with exactly one trailing newline", () => {
    const result = appendSite(SAMPLE, { hostname: "new.lyly.dev", type: "reverse-proxy", target: "5000" });
    assert.match(result, /\}\n$/);
    assert.doesNotMatch(result, /\n\n$/);
  });
});

describe("removeSite", () => {
  test("removes only the named block", () => {
    const result = removeSite(SAMPLE, "api.lyly.dev");
    assert.equal(hostnameExists(result, "api.lyly.dev"), false);
    assert.equal(hostnameExists(result, "lyly.dev"), true);
    assert.equal(hostnameExists(result, "app.lyly.dev"), true);
  });

  test("collapses the blank lines the removal leaves behind", () => {
    const result = removeSite(SAMPLE, "api.lyly.dev");
    assert.doesNotMatch(result, /\n{3,}/);
  });

  test("throws for a hostname with no block", () => {
    assert.throws(() => removeSite(SAMPLE, "absent.lyly.dev"), /No Caddyfile block found/);
  });
});

describe("hostnameExists", () => {
  test("is true for a present hostname and false for an absent one", () => {
    assert.equal(hostnameExists(SAMPLE, "app.lyly.dev"), true);
    assert.equal(hostnameExists(SAMPLE, "absent.lyly.dev"), false);
  });
});

describe("computeFilesPath", () => {
  test("returns sitesRoot/hostname for a static site", () => {
    const site = { hostname: "blog.lyly.dev", type: "static" as const, target: "/var/www/blog.lyly.dev" };
    assert.equal(computeFilesPath(site, "/var/www"), "/var/www/blog.lyly.dev");
  });

  test("returns sitesRoot/hostname for a scaffolded reverse proxy", () => {
    const site = {
      hostname: "app.lyly.dev",
      type: "reverse-proxy" as const,
      target: "3000",
      framework: "nextjs",
    };
    assert.equal(computeFilesPath(site, "/var/www"), "/var/www/app.lyly.dev");
  });

  test("returns null for a reverse proxy with no framework", () => {
    const site = { hostname: "api.lyly.dev", type: "reverse-proxy" as const, target: "4000" };
    assert.equal(computeFilesPath(site, "/var/www"), null);
  });
});
