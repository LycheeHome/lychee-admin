import fs from "node:fs";
import path from "node:path";
import { layout } from "./shell";
import type { Nav } from "./shell";
import { escapeHtml } from "./shared";

/** The built client bundle's files, relative to /client/. */
export type ClientAssets = { script: string; styles: string[] };

const ENTRY = "src/client/main.tsx";

/**
 * Reads Vite's manifest from `<publicDir>/client/.vite/manifest.json`. Never
 * throws: a missing, unparsable or entry-less manifest is null, and the
 * migrated routes answer 500 rather than the app failing to start.
 */
export function readClientManifest(publicDir: string): ClientAssets | null {
  try {
    const raw = fs.readFileSync(path.join(publicDir, "client", ".vite", "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, { file?: unknown; css?: unknown } | undefined>;
    const entry = manifest[ENTRY];
    if (!entry || typeof entry.file !== "string") return null;
    const styles = Array.isArray(entry.css) ? entry.css.filter((c): c is string => typeof c === "string") : [];
    return { script: entry.file, styles };
  } catch {
    return null;
  }
}

/** The shared shell around an empty mount point the client renders into. */
export function renderClientPage(title: string, page: string, nav: Nav, assets: ClientAssets): string {
  const head = assets.styles
    .map((href) => `<link rel="stylesheet" href="/client/${escapeHtml(href)}" />`)
    .join("\n  ");
  return layout(title, `<div id="app-root" data-page="${escapeHtml(page)}"></div>`, {
    nav,
    head,
    bodyEnd: `<script type="module" src="/client/${escapeHtml(assets.script)}"></script>`,
  });
}
