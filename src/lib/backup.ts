import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

/**
 * Copies filePath into config.backupDir with a timestamp suffix before any
 * mutating edit. Must be called before every Caddyfile / tunnel config write.
 */
export function backupFile(filePath: string): string {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(config.backupDir, `${path.basename(filePath)}.bak.${timestamp}`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}
