import "./env";
import { config } from "../config";
import { createApp } from "../app";
import type { Deps } from "../deps";
import { createBackup } from "../lib/backup";
import { createLogger } from "../lib/logger";
import { createFakes } from "./fakes";
import { applySeed } from "./seed";

const { fs, commands } = createFakes();
applySeed(fs);

const deps: Deps = {
  commands,
  fs,
  backup: createBackup(fs),
  logger: createLogger(fs),
};

createApp(deps).listen(config.port, config.host, () => {
  console.log(`lyly-admin (dev — in-memory, no host changes) on http://${config.host}:${config.port}`);
  console.log("Sign in with dev / dev. State resets on every restart.");
});
