import { config } from "./config";
import { createApp } from "./app";
import type { Deps } from "./deps";
import { createBackup } from "./lib/backup";
import { createLogger } from "./lib/logger";
import { realFileSystem } from "./lib/fileSystem";
import { realSystemCommands } from "./lib/systemCommands";

const deps: Deps = {
  commands: realSystemCommands,
  fs: realFileSystem,
  backup: createBackup(realFileSystem),
  logger: createLogger(realFileSystem),
};

createApp(deps).listen(config.port, config.host, () => {
  console.log(`lyly-admin listening on http://${config.host}:${config.port}`);
});
