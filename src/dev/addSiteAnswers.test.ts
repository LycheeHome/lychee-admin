import assert from "node:assert/strict";
import { describe, test } from "node:test";
import bcrypt from "bcrypt";
// Imported before anything loads config: it pins the settings an answer depends on.
import { ADD_SITE_REQUESTS, recordAddSiteAnswers, requestKey } from "./addSiteAnswers";
import recorded from "../client/test/addSiteAnswers.json";

// The dev user's password, hashed cheaply: src/dev/env.ts only fills it in
// when unset, and the recorder signs in on every request.
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("dev", 4);

// The add page's parity run (AddSiteParity.test.tsx) answers the React page
// from addSiteAnswers.json and compares it with the frozen reference in
// src/dev/fixtures/add-site/, which was recorded against these same answers.
// The answers can still drift from the app (a seed, validator or preview
// change), so they are re-recorded here on every run. A drifted file is a
// signal, not a chore: the frozen reference was answered from the old file,
// so a re-record that changes what a step's request receives can no longer
// be compared with it, and needs a reason in the review.

const RERECORD = "re-record: npx tsx src/dev/addSiteAnswers.ts > src/client/test/addSiteAnswers.json";

describe("the add page's recorded answers", () => {
  test("are what the seeded dev app answers now", async () => {
    assert.deepEqual(Object.keys(recorded), ADD_SITE_REQUESTS.map(requestKey), RERECORD);
    assert.deepEqual(await recordAddSiteAnswers(), recorded, RERECORD);
  });
});
