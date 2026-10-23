import fs from "node:fs";
import path from "node:path";
import { layout } from "./shell";
import type { Banner, ShellData } from "./shell";
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

/** The pages the client renders, by the name their mount point carries. */
export type ClientPage = "sites" | "services" | "reconciler" | "infrastructure";

/**
 * The shared shell around an empty mount point the client renders into. The
 * bundle's tags come from layout(), which emits them on every page from
 * `shell.assets`; a migrated route answers 500 before calling this when that
 * is null, because the page has nothing else to show. `title` is the one the
 * client sets again on every in-app navigation to this page, so the two are
 * read from the same constant.
 *
 * `banner` is layout()'s `#page-notice`, rendered by the server above the
 * mount point and outside it (today only the list's `?removed`); the client
 * removes it on the first in-app move away. Omitted, the page is unchanged.
 */
export function renderClientPage(title: string, page: ClientPage, shell: ShellData, banner?: Banner): string {
  // `contents`: the mount point generates no box, so what React renders into
  // it takes part in <main>'s flex column (and its gap) exactly as a server
  // page's body sections do. A box here would hold the sites list's error and
  // its section in a plain block, 24px closer together than on the server.
  return layout(
    title,
    `<div id="app-root" class="contents" data-page="${escapeHtml(page)}"></div>`,
    banner ? { shell, banner } : { shell },
  );
}
