import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import type { Deps } from "../deps";

/** What every client route answers when the static document is absent. */
export const CLIENT_DOCUMENT_MISSING = "client bundle missing; run npm run build";

/**
 * Reads the Vite-built static document, `<publicDir>/client/index.html`.
 * Never throws: a missing or unreadable file is null, and the client routes
 * answer 500 rather than the app failing to start.
 */
export function readClientDocument(publicDir: string): string | null {
  try {
    return fs.readFileSync(path.join(publicDir, "client", "index.html"), "utf8");
  } catch {
    return null;
  }
}

/**
 * Sends the static document with `status`, or 500 with the missing-bundle
 * text when there is none. `deps.clientDocument` is read once per call: the
 * dev server's getter re-reads the file, so a rebuild shows on the next
 * request.
 */
export function sendClientDocument(res: Response, deps: Deps, status = 200): void {
  const document = deps.clientDocument ?? null;
  if (document === null) {
    res.status(500).type("text/plain").send(CLIENT_DOCUMENT_MISSING);
    return;
  }
  res.status(status).type("html").send(document);
}
