import path from "node:path";
import { appendSite } from "./caddyfile";
import { addIngressRule } from "./tunnelConfig";
import { getScaffoldFiles } from "./frameworkScaffold";
import { ADD_STEPS } from "./stepReport";
import type { SiteEnv, SiteInput } from "./siteValidation";

export interface SitePreview {
  hostname: string;
  caddy: { path: string; added: string[] };
  tunnel: { path: string; added: string[]; contextAfter: string | null };
  files: { path: string; creates: string[] } | null;
  steps: { id: string; label: string; willRun: boolean }[];
}

/**
 * The lines present in `after` but not `before`, assuming one contiguous
 * insertion — which is all appendSite and addIngressRule ever make.
 *
 * Deliberately a diff rather than re-rendering the block here: the panel's
 * whole claim is that it shows what will actually be written, so the text
 * must come out of the real writers. The tunnel config is re-serialized whole
 * by yaml.dump, so if that round-trip ever reformats a line the app did not
 * mean to touch, this surfaces it instead of hiding it.
 *
 * The head walk is capped before the tail walk so an append at the end of the
 * file is attributed to the end and not mistaken for a shorter insertion that
 * happens to share its closing lines.
 */
export function diffInserted(before: string, after: string): { added: string[]; contextAfter: string | null } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  let head = 0;
  while (head < beforeLines.length && head < afterLines.length && beforeLines[head] === afterLines[head]) {
    head++;
  }

  let tail = 0;
  while (
    tail < beforeLines.length - head &&
    tail < afterLines.length - head &&
    beforeLines[beforeLines.length - 1 - tail] === afterLines[afterLines.length - 1 - tail]
  ) {
    tail++;
  }

  const added = afterLines.slice(head, afterLines.length - tail);
  while (added.length > 0 && added[0] === "") added.shift();
  while (added.length > 0 && added[added.length - 1] === "") added.pop();

  const context = afterLines[afterLines.length - tail];
  return { added, contextAfter: context === undefined || context === "" ? null : context };
}

/**
 * What POST /sites would write for this input, without writing any of it.
 * Every string here is produced by the same function the add handler calls.
 */
export function buildSitePreview(
  input: SiteInput,
  existing: { caddyfileContent: string; tunnelContent: string },
  env: SiteEnv,
): SitePreview {
  const sitePath = path.posix.join(env.sitesRoot, input.hostname);
  const target = input.type === "static" ? sitePath : input.port;

  const caddyAfter = appendSite(existing.caddyfileContent, {
    hostname: input.hostname,
    type: input.type,
    target,
    framework: input.framework,
    healthcheckPath: input.healthcheckPath,
  });
  const caddyDiff = diffInserted(existing.caddyfileContent, caddyAfter);

  const tunnelAfter = addIngressRule(existing.tunnelContent, input.hostname, "http://localhost:80");
  const tunnelDiff = diffInserted(existing.tunnelContent, tunnelAfter);

  const scaffold = input.framework
    ? getScaffoldFiles(input.framework, input.port, input.healthcheckPath ?? "/")
    : null;

  // Mirrors the add handler's three cases exactly: a static site gets a
  // directory and a placeholder, a scaffolded proxy gets a directory and its
  // scaffold, and a plain proxy has no directory to create at all.
  const files =
    input.type === "static"
      ? { path: sitePath, creates: ["index.html"] }
      : scaffold
        ? { path: sitePath, creates: scaffold.map((file) => file.name) }
        : null;

  return {
    hostname: input.hostname,
    caddy: { path: env.caddyfilePath, added: caddyDiff.added },
    tunnel: { path: env.tunnelConfigPath, added: tunnelDiff.added, contextAfter: tunnelDiff.contextAfter },
    files,
    steps: ADD_STEPS.map((step) => ({ ...step, willRun: step.id === "files" ? files !== null : true })),
  };
}
