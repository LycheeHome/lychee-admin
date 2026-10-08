import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "./fileSystem";

export interface AuditEntry {
  action:
    | "add-site"
    | "remove-site"
    | "add-site-failed"
    | "add-site-rolled-back"
    | "add-site-rollback-failed"
    | "remove-site-failed"
    | "remove-site-rolled-back"
    | "remove-site-rollback-failed"
    | "delete-site-files"
    | "delete-site-files-failed"
    | "deploy-service"
    | "deploy-service-failed"
    | "attach-site"
    | "attach-site-failed"
    | "detach-site"
    | "detach-site-failed"
    | "change-repository"
    | "change-repository-failed"
    | "prune-declaration"
    | "prune-declaration-failed"
    | "prune-declaration-refused";
  /** The site's hostname, or for a service action the declaration's name. */
  hostname: string;
  detail?: string;
}

export function createLogger(fs: FileSystem) {
  return {
    logAction(entry: AuditEntry): void {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
      fs.mkdir(path.dirname(config.logFile));
      fs.appendFile(config.logFile, line + "\n");
    },
  };
}
