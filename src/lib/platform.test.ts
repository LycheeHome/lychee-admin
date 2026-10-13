import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadContractJson } from "../dev/contract";
import { FLOATING_TAGS, IMAGE_PREFIX, isValidTag, PATHS, RESERVED_PORTS, SITE_MIN_PORT } from "./platform";
import { INVENTORY_PATH } from "./serviceInventory";

interface Constants {
  image_prefix: string;
  reserved_ports: number[];
  site_min_port: number;
  floating_tags: string[];
  tag_pattern: string;
  paths: Record<string, string>;
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
