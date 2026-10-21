import type { FileSystem } from "./lib/fileSystem";
import type { SystemCommands } from "./lib/systemCommands";
import type { createBackup } from "./lib/backup";
import type { createLogger } from "./lib/logger";
import type { ClientAssets } from "./views/clientShell";

/**
 * Everything the routes reach the outside world through. Assembled by
 * src/server.ts with real implementations, and by src/dev/server.ts with
 * in-memory fakes.
 */
export interface Deps {
  commands: SystemCommands;
  fs: FileSystem;
  backup: ReturnType<typeof createBackup>;
  logger: ReturnType<typeof createLogger>;
  /**
   * The built client bundle; null when it is missing. Production reads it
   * once at startup (a release never changes); the dev server re-reads it on
   * every use, so routes must read this per request, never cache it.
   */
  clientAssets?: ClientAssets | null;
}
