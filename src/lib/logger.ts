import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

export interface AuditEntry {
  action:
    | "add-site"
    | "remove-site"
    | "add-site-failed"
    | "remove-site-failed"
    | "remove-site-rolled-back"
    | "remove-site-rollback-failed"
    | "delete-site-files"
    | "delete-site-files-failed";
  hostname: string;
  detail?: string;
}

export function logAction(entry: AuditEntry): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
  fs.appendFileSync(config.logFile, line + "\n");
}
