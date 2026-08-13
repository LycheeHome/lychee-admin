import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "./fileSystem";

/**
 * Copies filePath into config.backupDir with a timestamp suffix before any
 * mutating edit. Must be called before every Caddyfile / tunnel config write.
 */
export function createBackup(fs: FileSystem) {
  return {
    backupFile(filePath: string): string {
      fs.mkdir(config.backupDir);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(config.backupDir, `${path.basename(filePath)}.bak.${timestamp}`);
      fs.copyFile(filePath, backupPath);
      return backupPath;
    },
  };
}
