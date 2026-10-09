import { describe, test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { addIngressRule, ingressExists, removeIngressRule } from "./tunnelConfig";

interface ParsedConfig {
  ingress: Array<{ hostname?: string; service: string }>;
}

const TUNNEL = `tunnel: 11111111-2222-3333-4444-555555555555
credentials-file: /etc/cloudflared/11111111-2222-3333-4444-555555555555.json
ingress:
  - hostname: lychee.land
    service: http://localhost:80
  - hostname: blog.lychee.land
    service: http://localhost:80
  - service: http_status:404
`;

const parse = (content: string) => yaml.load(content) as ParsedConfig;

describe("addIngressRule", () => {
  test("inserts immediately before the catch-all rule", () => {
    const result = parse(addIngressRule(TUNNEL, "new.lychee.land", "http://localhost:80"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lychee.land", "blog.lychee.land", "new.lychee.land", undefined],
    );
  });

  test("sets the supplied service on the new rule", () => {
    const result = parse(addIngressRule(TUNNEL, "new.lychee.land", "http://localhost:80"));
    const added = result.ingress.find((rule) => rule.hostname === "new.lychee.land");
    assert.equal(added?.service, "http://localhost:80");
  });

  test("preserves the tunnel id and credentials-file keys", () => {
    const result = yaml.load(addIngressRule(TUNNEL, "new.lychee.land", "http://localhost:80")) as Record<string, unknown>;
    assert.equal(result.tunnel, "11111111-2222-3333-4444-555555555555");
    assert.equal(result["credentials-file"], "/etc/cloudflared/11111111-2222-3333-4444-555555555555.json");
  });

  test("appends at the end when there is no catch-all", () => {
    const noCatchAll = `ingress:
  - hostname: lychee.land
    service: http://localhost:80
`;
    const result = parse(addIngressRule(noCatchAll, "new.lychee.land", "http://localhost:80"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lychee.land", "new.lychee.land"],
    );
  });

  test("throws when the hostname already has a rule", () => {
    assert.throws(() => addIngressRule(TUNNEL, "blog.lychee.land", "http://localhost:80"), /already exists/);
  });

  test("throws when the document has no ingress list", () => {
    assert.throws(() => addIngressRule("tunnel: abc-123\n", "new.lychee.land", "http://localhost:80"), /missing an `ingress` list/);
  });
});

describe("removeIngressRule", () => {
  test("removes only the named rule and keeps the catch-all", () => {
    const result = parse(removeIngressRule(TUNNEL, "blog.lychee.land"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lychee.land", undefined],
    );
  });

  test("throws when no rule matches", () => {
    assert.throws(() => removeIngressRule(TUNNEL, "absent.lychee.land"), /No ingress rule found/);
  });
});

describe("ingressExists", () => {
  test("is true for a present hostname and false for an absent one", () => {
    assert.equal(ingressExists(TUNNEL, "blog.lychee.land"), true);
    assert.equal(ingressExists(TUNNEL, "absent.lychee.land"), false);
  });
});
