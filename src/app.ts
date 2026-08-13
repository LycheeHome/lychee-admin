import express from "express";
import path from "node:path";
import { basicAuth } from "./middleware/auth";
import { createSitesRouter } from "./routes/sites";
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

export function createApp(deps: Deps): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(createSitesRouter(deps));

  return app;
}
