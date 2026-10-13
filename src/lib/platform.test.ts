import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadContractJson } from "../dev/contract";
import { CLIENTS_FILE, clientSocketPath, HOST_ACTIONS, opUnitName, FLOATING_TAGS, IMAGE_PREFIX, isValidTag, MAX_RESOURCE_NAME_LENGTH, PATHS, RESERVED_PORTS, SITE_MIN_PORT } from "./platform";
import { SITE_TAGLESS_IMAGE_RE } from "./declarationWriter";
import { siteNamePatternFor, siteSuffixFor } from "./siteValidation";
import { SUDO } from "./sudoCommands";
import { INVENTORY_PATH } from "./serviceInventory";

interface Constants {
  image_prefix: string;
  reserved_ports: number[];
  site_min_port: number;
  floating_tags: string[];
  tag_pattern: string;
  max_resource_name_length: number;
  domain: string;
  site_suffix: string;
  site_name_pattern: string;
  paths: Record<string, string>;
  host_actions: string[];
  op_unit_pattern: string;
  op_sudo_argv: string[];
  client_socket_path: string;
  clients_file: string;
}
const constants = loadContractJson<Constants>("constants.json");

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

describe("platform constants match the contract", () => {
  test("scalar constants", () => {
    assert.equal(IMAGE_PREFIX, constants.image_prefix);
    assert.deepEqual(RESERVED_PORTS, constants.reserved_ports);
    assert.equal(SITE_MIN_PORT, constants.site_min_port);
    assert.deepEqual(FLOATING_TAGS, constants.floating_tags);
  });

  test("PATHS is constants.paths in camelCase", () => {
    const expected = Object.fromEntries(Object.entries(constants.paths).map(([k, v]) => [camel(k), v]));
    assert.deepEqual(PATHS, expected);
  });

  test("INVENTORY_PATH is PATHS.inventory", () => {
    assert.equal(INVENTORY_PATH, PATHS.inventory);
  });

  test("isValidTag agrees with tag_pattern minus floating tags", () => {
    const re = new RegExp(constants.tag_pattern);
    for (const t of ["1.2.3", "sha-abc", "-x", "", "a".repeat(129), "latest"]) {
      assert.equal(isValidTag(t), re.test(t) && !constants.floating_tags.includes(t), t);
    }
  });

  test("isValidTag", () => {
    assert.equal(isValidTag("latest"), false);
    assert.equal(isValidTag("1.2.3"), true);
    assert.equal(isValidTag("-x"), false);
  });
});

describe("carried-over constants match the contract", () => {
  test("MAX_RESOURCE_NAME_LENGTH", () => {
    assert.equal(MAX_RESOURCE_NAME_LENGTH, constants.max_resource_name_length);
  });

  test("siteSuffixFor(domain) is site_suffix", () => {
    assert.equal(siteSuffixFor(constants.domain), constants.site_suffix);
  });

  test("siteNamePatternFor agrees with site_name_pattern as a full match", () => {
    const contractRe = new RegExp("^(?:" + constants.site_name_pattern + ")$");
    const appRe = siteNamePatternFor(constants.domain);
    for (const n of ["blog-lychee-land", "a-lychee-land", "-x-lychee-land", "x--lychee-land", "blog-lychee-land-2", "Blog-lychee-land"]) {
      assert.equal(appRe.test(n), contractRe.test(n), n);
    }
  });
});

describe("SITE_TAGLESS_IMAGE_RE", () => {
  // Frozen on purpose: the old SITE_TAGLESS_IMAGE_RE literal, kept verbatim as the baseline. Do not "fix" it.
  const today = /^(\s*image:\s*["']?ghcr\.io\/lycheehome\/)([^\s"'#:/]+)(["']?)(.*)$/;
  test("matches exactly what the literal it replaced matched", () => {
    const lines = [
      "image: ghcr.io/lycheehome/blog",
      '  image: "ghcr.io/lycheehome/blog"',
      "image: 'ghcr.io/lycheehome/blog' # note",
      "image: ghcr.io/lycheehome/blog # note",
      "image: ghcr.io/lycheehome/blog:1.2.3",
      "image: ghcr.io/lycheehome/blog/sub",
      "image: ghcr.io/otherorg/blog",
      "image: ghcr.io/lycheehomeX/blog",
      "image: docker.io/lycheehome/blog",
    ];
    for (const l of lines) {
      assert.deepEqual(SITE_TAGLESS_IMAGE_RE.exec(l), today.exec(l), l);
    }
    assert.ok(SITE_TAGLESS_IMAGE_RE.test(lines[0]));
    assert.ok(!SITE_TAGLESS_IMAGE_RE.test(lines[6]));
  });
});

describe("host operations constants", () => {
  test("HOST_ACTIONS and CLIENTS_FILE", () => {
    assert.deepEqual([...HOST_ACTIONS], constants.host_actions);
    assert.equal(CLIENTS_FILE, constants.clients_file);
  });

  test("clientSocketPath fills the contract pattern", () => {
    assert.equal(clientSocketPath("swee"), constants.client_socket_path.replace("{client}", "swee"));
  });

  test("clientSocketPath refuses a name that is not a bare name", () => {
    for (const bad of ["../swee", "swee/x", "Swee", "swee\n", "", "a".repeat(64)]) {
      assert.throws(() => clientSocketPath(bad), bad);
    }
  });

  test("opUnitName fills op_unit_pattern for every action", () => {
    for (const a of HOST_ACTIONS) {
      assert.equal(opUnitName("palworld-palchuds", a), constants.op_unit_pattern.replace("{unit}", "palworld-palchuds").replace("{action}", a));
    }
  });

  test("opUnitName refuses names that are not a bare unit name", () => {
    for (const bad of ["Palworld", "a.b", "-x", "x y", "a".repeat(64), ""]) {
      assert.throws(() => opUnitName(bad, "start"), bad);
    }
    assert.doesNotThrow(() => opUnitName("a".repeat(63), "start"));
  });

  test("SUDO.startOp is op_sudo_argv with the op unit substituted", () => {
    const expected = constants.op_sudo_argv.map((a) => a.replace("{op_unit}", opUnitName("swee", "restart")));
    assert.deepEqual(SUDO.startOp("swee", "restart"), expected);
  });
});
