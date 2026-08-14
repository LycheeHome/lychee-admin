import { describe, test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { addIngressRule, ingressExists, removeIngressRule } from "./tunnelConfig";

interface ParsedConfig {
  ingress: Array<{ hostname?: string; service: string }>;
}

const TUNNEL = `tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e
credentials-file: /etc/cloudflared/c7081f91-61c2-476b-8505-42d219bb6d7e.json
ingress:
  - hostname: lyly.dev
    service: http://localhost:80
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

const parse = (content: string) => yaml.load(content) as ParsedConfig;

describe("addIngressRule", () => {
  test("inserts immediately before the catch-all rule", () => {
    const result = parse(addIngressRule(TUNNEL, "new.lyly.dev", "http://localhost:80"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lyly.dev", "blog.lyly.dev", "new.lyly.dev", undefined],
    );
  });

  test("sets the supplied service on the new rule", () => {
    const result = parse(addIngressRule(TUNNEL, "new.lyly.dev", "http://localhost:80"));
    const added = result.ingress.find((rule) => rule.hostname === "new.lyly.dev");
    assert.equal(added?.service, "http://localhost:80");
  });

  test("preserves the tunnel id and credentials-file keys", () => {
    const result = yaml.load(addIngressRule(TUNNEL, "new.lyly.dev", "http://localhost:80")) as Record<string, unknown>;
    assert.equal(result.tunnel, "c7081f91-61c2-476b-8505-42d219bb6d7e");
    assert.equal(result["credentials-file"], "/etc/cloudflared/c7081f91-61c2-476b-8505-42d219bb6d7e.json");
  });

  test("appends at the end when there is no catch-all", () => {
    const noCatchAll = `ingress:
  - hostname: lyly.dev
    service: http://localhost:80
`;
    const result = parse(addIngressRule(noCatchAll, "new.lyly.dev", "http://localhost:80"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lyly.dev", "new.lyly.dev"],
    );
  });

  test("throws when the hostname already has a rule", () => {
    assert.throws(() => addIngressRule(TUNNEL, "blog.lyly.dev", "http://localhost:80"), /already exists/);
  });

  test("throws when the document has no ingress list", () => {
    assert.throws(() => addIngressRule("tunnel: abc-123\n", "new.lyly.dev", "http://localhost:80"), /missing an `ingress` list/);
  });
});

describe("removeIngressRule", () => {
  test("removes only the named rule and keeps the catch-all", () => {
    const result = parse(removeIngressRule(TUNNEL, "blog.lyly.dev"));
    assert.deepEqual(
      result.ingress.map((rule) => rule.hostname),
      ["lyly.dev", undefined],
    );
  });

  test("throws when no rule matches", () => {
    assert.throws(() => removeIngressRule(TUNNEL, "absent.lyly.dev"), /No ingress rule found/);
  });
});

describe("ingressExists", () => {
  test("is true for a present hostname and false for an absent one", () => {
    assert.equal(ingressExists(TUNNEL, "blog.lyly.dev"), true);
    assert.equal(ingressExists(TUNNEL, "absent.lyly.dev"), false);
  });
});
