import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  readSiteInput,
  validateSiteInput,
  validateAgainstExisting,
  isManagedHostname,
  type SiteEnv,
} from "./siteValidation";

const ENV: SiteEnv = {
  domain: "lyly.dev",
  sitesRoot: "/var/www",
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  reservedPorts: [8787, 2019],
};

const CADDYFILE = `{
\tauto_https off
}

http://blog.lyly.dev {
\troot * /var/www/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}
`;

describe("readSiteInput", () => {
  test("lowercases and trims the hostname, the way the add handler always has", () => {
    assert.equal(readSiteInput({ hostname: "  BLOG.Lyly.Dev " }).hostname, "blog.lyly.dev");
  });

  test("treats any type other than reverse-proxy as static", () => {
    assert.equal(readSiteInput({ type: "nonsense" }).type, "static");
    assert.equal(readSiteInput({ type: "reverse-proxy" }).type, "reverse-proxy");
  });

  test("drops a framework on a static site, where it cannot apply", () => {
    const input = readSiteInput({ type: "static", framework: "nextjs" });
    assert.equal(input.framework, undefined);
    assert.equal(input.healthcheckPath, undefined);
  });

  test("defaults a Next.js site's healthcheck to / rather than leaving it empty", () => {
    const input = readSiteInput({ type: "reverse-proxy", framework: "nextjs", healthcheckPath: "  " });
    assert.equal(input.healthcheckPath, "/");
  });
});

describe("validateSiteInput", () => {
  test("rejects a hostname outside the managed domain, in the handler's own words", () => {
    const result = validateSiteInput(readSiteInput({ hostname: "blog.example.com" }), ENV);
    assert.deepEqual(result, { ok: false, error: `"blog.example.com" must be a subdomain of lyly.dev` });
  });

  test("rejects a reverse proxy with no port", () => {
    const result = validateSiteInput(readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy" }), ENV);
    assert.deepEqual(result, { ok: false, error: "A valid local port is required for a reverse proxy site" });
  });

  test("rejects a port outside 1-65535", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "70000" });
    assert.equal(validateSiteInput(input, ENV).ok, false);
  });

  test("rejects a malformed healthcheck path", () => {
    const input = readSiteInput({
      hostname: "x.lyly.dev",
      type: "reverse-proxy",
      port: "4100",
      framework: "nextjs",
      healthcheckPath: "no-leading-slash",
    });
    assert.deepEqual(result_error(input), `"no-leading-slash" is not a valid healthcheck path`);
  });

  test("accepts a well-formed static site", () => {
    assert.deepEqual(validateSiteInput(readSiteInput({ hostname: "docs.lyly.dev" }), ENV), { ok: true });
  });

  function result_error(input: ReturnType<typeof readSiteInput>): string {
    const result = validateSiteInput(input, ENV);
    assert.equal(result.ok, false);
    return result.ok ? "" : result.error;
  }
});

describe("validateAgainstExisting", () => {
  test("rejects a hostname already in the Caddyfile", () => {
    const result = validateAgainstExisting(readSiteInput({ hostname: "blog.lyly.dev" }), CADDYFILE, ENV);
    assert.deepEqual(result, { ok: false, error: "blog.lyly.dev already exists in the Caddyfile" });
  });

  test("rejects a reserved port before it can reach a conflict check", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "2019" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), {
      ok: false,
      error: "Port 2019 is reserved (used by lyly-admin itself or Caddy's admin API)",
    });
  });

  test("names the site already holding a conflicting port", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "4000" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), {
      ok: false,
      error: "Port 4000 is already used by api.lyly.dev",
    });
  });

  test("lets a free port through", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "reverse-proxy", port: "4100" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), { ok: true });
  });

  test("a static site is not port-checked at all", () => {
    const input = readSiteInput({ hostname: "x.lyly.dev", type: "static", port: "4000" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV), { ok: true });
  });
});

describe("isManagedHostname", () => {
  test("keeps the apex domain and its subdomains", () => {
    assert.equal(isManagedHostname("lyly.dev", "lyly.dev"), true);
    assert.equal(isManagedHostname("blog.lyly.dev", "lyly.dev"), true);
  });

  test("excludes a block lyly-admin does not own", () => {
    assert.equal(isManagedHostname("lychee.local", "lyly.dev"), false);
  });
});
