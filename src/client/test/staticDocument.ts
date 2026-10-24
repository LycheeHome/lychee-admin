import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RailPayload } from "../../shared/rail";

/*
 * The document every client route is served, for the router tests: the real
 * index.html at the repo root, read here rather than retyped, so a test's
 * body is exactly what a browser starts from (only `#react-root`).
 */

const SOURCE = readFileSync(path.join(__dirname, "..", "..", "..", "index.html"), "utf8");

/** index.html's <title>, which the document carries until a page sets its own. */
export const STATIC_TITLE = SOURCE.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";

/** index.html's `<body>` classes: the grid that splits the rail and the content from 900px. */
export const STATIC_BODY_CLASS = SOURCE.match(/<body class="([^"]*)">/)?.[1] ?? "";

/**
 * index.html's body, without the entry script (happy-dom would try to load
 * it). Asserts the body holds only the root, so a test cannot quietly mount
 * over anything else.
 */
export function staticBody(): string {
  const inner = SOURCE.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1];
  assert.ok(inner !== undefined, "index.html has no <body> — the anchor is stale");
  const body = inner.replace(/<script\b[^>]*><\/script>/g, "").trim();
  assert.equal(body, '<div id="react-root" class="contents"></div>');
  return body;
}

/** Loads the static document's body and title into the current happy-dom document. */
export function loadStaticDocument(doc: Document = document): void {
  doc.title = STATIC_TITLE;
  doc.body.innerHTML = staticBody();
}

/** `GET /api/rail`'s answer for the dev seed's sites. */
export function railPayload(sites: RailPayload["sites"]): RailPayload {
  return { sites, hostAvailable: true, domain: "lychee.land" };
}
