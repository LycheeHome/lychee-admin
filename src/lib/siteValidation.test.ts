import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  readSiteInput,
  validateSiteInput,
  validateAgainstExisting,
  isManagedHostname,
  maxSiteLabelLength,
  siteNamePatternFor,
  siteSuffixFor,
  type SiteEnv,
} from "./siteValidation";

const ENV: SiteEnv = {
  domain: "lychee.land",
  sitesRoot: "/var/www",
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  reservedPorts: [8787, 2019],
};

const NO_DECLARED = new Map<number, string>();

const CADDYFILE = `{
\tauto_https off
}

http://blog.lychee.land {
\troot * /var/www/blog.lychee.land
\tfile_server
}

http://api.lychee.land {
\treverse_proxy localhost:4000
}
`;

describe("readSiteInput", () => {
  test("lowercases and trims the hostname, the way the add handler always has", () => {
    assert.equal(readSiteInput({ hostname: "  BLOG.Lychee.Land " }).hostname, "blog.lychee.land");
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
    assert.deepEqual(result, { ok: false, error: `"blog.example.com" must be a subdomain of lychee.land` });
  });

  test("rejects a reverse proxy with no port", () => {
    const result = validateSiteInput(readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy" }), ENV);
    assert.deepEqual(result, { ok: false, error: "A valid local port is required for a reverse proxy site" });
  });

  test("rejects a port outside 1-65535", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "70000" });
    assert.equal(validateSiteInput(input, ENV).ok, false);
  });

  test("rejects a malformed healthcheck path", () => {
    const input = readSiteInput({
      hostname: "x.lychee.land",
      type: "reverse-proxy",
      port: "4100",
      framework: "nextjs",
      healthcheckPath: "no-leading-slash",
    });
    assert.deepEqual(result_error(input), `"no-leading-slash" is not a valid healthcheck path`);
  });

  test("accepts a well-formed static site", () => {
    assert.deepEqual(validateSiteInput(readSiteInput({ hostname: "docs.lychee.land" }), ENV), { ok: true });
  });

  function result_error(input: ReturnType<typeof readSiteInput>): string {
    const result = validateSiteInput(input, ENV);
    assert.equal(result.ok, false);
    return result.ok ? "" : result.error;
  }
});

describe("validateSiteInput — privileged ports", () => {
  test("refuses a Next.js site below 1024", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "80", framework: "nextjs" });
    const result = validateSiteInput(input, ENV);
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /1024/);
  });

  test("allows 1024 for Next.js, and low ports for plain proxies", () => {
    assert.deepEqual(
      validateSiteInput(readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "1024", framework: "nextjs" }), ENV),
      { ok: true },
    );
    assert.deepEqual(
      validateSiteInput(readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "80" }), ENV),
      { ok: true },
    );
  });
});

describe("validateSiteInput — a Next.js site's label must fit its resource name", () => {
  const label = (n: number) => "a".repeat(n);

  test("refuses a Next.js label longer than 51 characters, naming the resource-name limit", () => {
    const input = readSiteInput({ hostname: `${label(52)}.lychee.land`, type: "reverse-proxy", port: "3000", framework: "nextjs" });
    const result = validateSiteInput(input, ENV);
    assert.equal(result.ok, false);
    const error = result.ok ? "" : result.error;
    assert.match(error, /51/);
    assert.match(error, /63/);
    assert.match(error, /-lychee-land/);
  });

  test("accepts a 51-character label, and longer labels for a plain proxy or a static site", () => {
    assert.deepEqual(
      validateSiteInput(readSiteInput({ hostname: `${label(51)}.lychee.land`, type: "reverse-proxy", port: "3000", framework: "nextjs" }), ENV),
      { ok: true },
    );
    assert.deepEqual(
      validateSiteInput(readSiteInput({ hostname: `${label(60)}.lychee.land`, type: "reverse-proxy", port: "3000" }), ENV),
      { ok: true },
    );
    assert.deepEqual(validateSiteInput(readSiteInput({ hostname: `${label(60)}.lychee.land`, type: "static" }), ENV), { ok: true });
  });
});

describe("validateAgainstExisting", () => {
  test("rejects a hostname already in the Caddyfile", () => {
    const result = validateAgainstExisting(readSiteInput({ hostname: "blog.lychee.land" }), CADDYFILE, ENV, NO_DECLARED);
    assert.deepEqual(result, { ok: false, error: "blog.lychee.land already exists in the Caddyfile" });
  });

  test("rejects a reserved port before it can reach a conflict check", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "2019" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV, NO_DECLARED), {
      ok: false,
      error: "Port 2019 is reserved (used by lyly-admin itself or Caddy's admin API)",
    });
  });

  test("names the site already holding a conflicting port", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "4000" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV, NO_DECLARED), {
      ok: false,
      error: "Port 4000 is already used by api.lychee.land",
    });
  });

  test("lets a free port through", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "4100" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV, NO_DECLARED), { ok: true });
  });

  test("rejects a port claimed by a declaration, naming it and lychee-resources", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "reverse-proxy", port: "8788" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV, new Map([[8788, "palsave-api"]])), {
      ok: false,
      error: "Port 8788 is already claimed by palsave-api in lychee-resources.",
    });
  });

  test("a declared port does not block a static site", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "static", port: "8788" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV, new Map([[8788, "palsave-api"]])), { ok: true });
  });

  test("a static site is not port-checked at all", () => {
    const input = readSiteInput({ hostname: "x.lychee.land", type: "static", port: "4000" });
    assert.deepEqual(validateAgainstExisting(input, CADDYFILE, ENV, NO_DECLARED), { ok: true });
  });
});

describe("isManagedHostname", () => {
  test("keeps the apex domain and its subdomains", () => {
    assert.equal(isManagedHostname("lychee.land", "lychee.land"), true);
    assert.equal(isManagedHostname("blog.lychee.land", "lychee.land"), true);
  });

  test("excludes a block lyly-admin does not own", () => {
    assert.equal(isManagedHostname("lychee.local", "lychee.land"), false);
  });
});

describe("the suffix, pattern and label limit follow the domain", () => {
  test("siteSuffixFor turns dots into dashes", () => {
    assert.equal(siteSuffixFor("lychee.land"), "-lychee-land");
    assert.equal(siteSuffixFor("example.co.uk"), "-example-co-uk");
  });

  test("maxSiteLabelLength is 63 minus the suffix", () => {
    assert.equal(maxSiteLabelLength("lychee.land"), 51);
  });

  test("siteNamePatternFor matches whole names under that suffix only", () => {
    const re = siteNamePatternFor("lychee.land");
    assert.equal(re.test("blog-lychee-land"), true);
    assert.equal(re.test("blog-lyly-dev"), false);
    assert.equal(re.test("-lychee-land"), false);
    assert.equal(re.test("xblog-lychee-landx"), false);
    assert.equal(re.test("blog-lychee.land"), false);
    assert.equal(re.test("blog-lycheexland"), false);
  });

  test("the Next.js label error names the limit for the configured domain", () => {
    const env = { ...ENV, domain: "lychee.land" };
    const long = validateSiteInput(
      readSiteInput({ hostname: `${"a".repeat(52)}.lychee.land`, type: "reverse-proxy", port: "3000", framework: "nextjs" }),
      env,
    );
    assert.equal(long.ok, false);
    const error = long.ok ? "" : long.error;
    assert.match(error, /at most 51 characters/);
    assert.match(error, /<label>-lychee-land/);
    assert.deepEqual(
      validateSiteInput(
        readSiteInput({ hostname: `${"a".repeat(51)}.lychee.land`, type: "reverse-proxy", port: "3000", framework: "nextjs" }),
        env,
      ),
      { ok: true },
    );
  });
});
