import type { FileSystem } from "./lib/fileSystem";
import type { SystemCommands } from "./lib/systemCommands";
import type { createBackup } from "./lib/backup";
import type { createLogger } from "./lib/logger";

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
}
