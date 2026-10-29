import { config } from "../config";
import type { FileSystem } from "./fileSystem";

/** One line of the audit log, as `createLogger` writes it. */
export interface AuditLine {
  timestamp: string;
  action: string;
  hostname?: string;
  detail?: string;
  // host-action lines
  caller?: string;
  unit?: string;
  hostAction?: string;
  outcome?: string;
}

const OPTIONAL = ["hostname", "detail", "caller", "unit", "hostAction", "outcome"] as const;

/** The last `n` well-formed lines of the audit log, oldest first. A line that
 *  is not a JSON object with a string `timestamp` and `action` is skipped and
 *  does not count toward `n`. `null` when the log cannot be read. */
export function readAuditTail(fs: FileSystem, n: number, path: string = config.logFile): AuditLine[] | null {
  let text: string;
  try {
    text = fs.readFile(path);
  } catch {
    return null;
  }
  const lines: AuditLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const o = value as Record<string, unknown>;
    if (typeof o.timestamp !== "string" || typeof o.action !== "string") continue;
    const line: AuditLine = { timestamp: o.timestamp, action: o.action };
    for (const key of OPTIONAL) {
      const v = o[key];
      if (typeof v === "string") line[key] = v;
    }
    lines.push(line);
  }
  return n <= 0 ? [] : lines.slice(-n);
}
