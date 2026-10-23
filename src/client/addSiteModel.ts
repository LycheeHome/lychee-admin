// The add page's decisions, ported from the retired add-site block of
// public/app.js. No Node and no DOM: the components render what these return.
import type { SitePreview } from "../lib/sitePreview";

const STEP_MARKS: Record<string, string> = { ok: "✓", failed: "✗", skipped: "—", "not-run": "·" };
const STEP_MARK_CLASSES: Record<string, string> = {
  ok: "text-green-300",
  failed: "text-red-300",
  skipped: "text-stone-400",
  "not-run": "text-stone-400",
};

export type StepMark = { text: string; className: string };

// The field carries only the subdomain label. A pasted full hostname must not
// have the domain doubled onto it, and trailing dots from a pasted FQDN must
// not survive. The doubling check is case-insensitive; the label keeps its
// own casing, since the server normalizes case anyway.
export function composeHostname(label: string, domain: string): string {
  const trimmed = label.trim().replace(/\.+$/, "");
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const domainLower = domain.toLowerCase();
  return lower === domainLower || lower.endsWith(`.${domainLower}`) ? trimmed : `${trimmed}.${domain}`;
}

// null means the headline reads "Add a site".
export function headlineParts(
  hostname: string,
  domain: string,
): { label: string; suffix: string } | { whole: string } | null {
  if (!hostname) return null;
  const suffix = `.${domain}`;
  if (hostname.toLowerCase().endsWith(suffix.toLowerCase()) && hostname.length > suffix.length) {
    return {
      label: hostname.slice(0, hostname.length - suffix.length),
      suffix: hostname.slice(hostname.length - suffix.length),
    };
  }
  return { whole: hostname };
}

// The server's finished sentence, shown as is; the client adds no wording.
export function portMessage(port: string, owners: Record<string, string>): string | null {
  return Object.hasOwn(owners, port) && owners[port] ? owners[port] : null;
}

export function fieldVisibility(
  type: "static" | "reverse-proxy",
  framework: string,
): { port: boolean; healthcheck: boolean; nextjsDescription: boolean } {
  const isNextjs = framework === "nextjs";
  return { port: type === "reverse-proxy", healthcheck: isNextjs, nextjsDescription: isNextjs };
}

export function previewSections(
  preview: SitePreview,
): { path: string; lines: string[]; contextAfter: string | null }[] {
  const sections = [
    { path: preview.caddy.path, lines: preview.caddy.added, contextAfter: null as string | null },
    { path: preview.tunnel.path, lines: preview.tunnel.added, contextAfter: preview.tunnel.contextAfter },
  ];
  if (preview.files) sections.push({ path: preview.files.path, lines: preview.files.creates, contextAfter: null });
  return sections;
}

export function skipMarks(steps: { id: string; willRun: boolean }[]): Record<string, StepMark> {
  const marks: Record<string, StepMark> = {};
  for (const step of steps) {
    marks[step.id] = step.willRun
      ? { text: "", className: "" }
      : { text: STEP_MARKS.skipped, className: STEP_MARK_CLASSES.skipped };
  }
  return marks;
}

export function resultMarks(steps: { id: string; status: string }[]): Record<string, StepMark> {
  const marks: Record<string, StepMark> = {};
  for (const step of steps) {
    marks[step.id] = { text: STEP_MARKS[step.status] ?? "", className: STEP_MARK_CLASSES[step.status] ?? "" };
  }
  return marks;
}
