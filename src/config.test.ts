import { test } from "node:test";
import assert from "node:assert/strict";

// config.ts runs required() when it is evaluated, so these must be set before
// the dynamic import below.
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = "x";
process.env.DOMAIN = "lychee.land";

test("parseHostnameList trims, lowercases and drops empty entries", async () => {
  const { parseHostnameList } = await import("./config");
  assert.deepEqual(parseHostnameList("Admin.lychee.land, other.lychee.land,,"), [
    "admin.lychee.land",
    "other.lychee.land",
  ]);
  assert.deepEqual(parseHostnameList(undefined), []);
  assert.deepEqual(parseHostnameList(""), []);
});
