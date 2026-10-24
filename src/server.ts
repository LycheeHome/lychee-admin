import path from "node:path";
import { config } from "./config";
import { readClientDocument } from "./routes/clientDocument";
import { createApp } from "./app";
import type { Deps } from "./deps";
import { createBackup } from "./lib/backup";
import { createLogger } from "./lib/logger";
import { realFileSystem } from "./lib/fileSystem";
import { realSystemCommands } from "./lib/systemCommands";
import { readClients, startClientSockets } from "./lib/clients";
import { clientSocketPath } from "./lib/platform";

const deps: Deps = {
  commands: realSystemCommands,
  fs: realFileSystem,
  backup: createBackup(realFileSystem),
  logger: createLogger(realFileSystem),
  // The same public directory app.ts serves, for dist/ and tsx-run src alike.
  // Read once: a release never changes.
  clientDocument: readClientDocument(path.join(__dirname, "..", "public")),
};

createApp(deps).listen(config.port, config.host, () => {
  console.log(`lychee-admin listening on http://${config.host}:${config.port}`);
});

// One socket per client in clients.json, read once: lychee-ops restarts the
// app when it changes. A client that cannot be served is logged and skipped;
// the network app above is already listening either way.
void startClientSockets(deps, readClients(realFileSystem), clientSocketPath)
  .then((servers) => {
    console.log(`lychee-admin: serving ${servers.length} client socket(s)`);
  })
  .catch((error: unknown) => console.error("lychee-admin: client sockets failed to start:", error));
