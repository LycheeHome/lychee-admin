import "./env";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../config";
import { createApp } from "../app";
import type { Deps } from "../deps";
import { createBackup } from "../lib/backup";
import { createLogger } from "../lib/logger";
import { type ClientConfig, startClientSockets } from "../lib/clients";
import { readClientManifest } from "../views/clientShell";
import { createFakes } from "./fakes";
import { applySeed, SEEDED_DECLARATIONS } from "./seed";

const { fs, commands } = createFakes({}, { declarations: SEEDED_DECLARATIONS });
applySeed(fs);

const deps: Deps = {
  commands,
  fs,
  backup: createBackup(fs),
  logger: createLogger(fs),
  clientAssets: readClientManifest(path.join(__dirname, "..", "..", "public")),
};

createApp(deps).listen(config.port, config.host, () => {
  console.log(`lychee-admin (dev — in-memory, no host changes) on http://${config.host}:${config.port}`);
  console.log("Sign in with dev / dev. State resets on every restart.");
});

// The client sockets, in a temp directory instead of /run/lychee-admin, with
// one dev client granted everything on the seeded Palworld unit. Try:
//   curl --unix-socket <printed path> http://x/v1/units/palworld-palchuds/actions/restart
const DEV_CLIENTS: ClientConfig[] = [
  { name: "swee", grants: { "palworld-palchuds": ["start", "stop", "restart", "update"] } },
];
const socketRoot = nodeFs.mkdtempSync(path.join(os.tmpdir(), "lychee-admin-"));
for (const client of DEV_CLIENTS) nodeFs.mkdirSync(path.join(socketRoot, client.name));
const socketPathFor = (client: string) => path.join(socketRoot, client, "api.sock");
void startClientSockets(deps, DEV_CLIENTS, socketPathFor)
  .then((servers) => {
    for (const client of DEV_CLIENTS) console.log(`client ${client.name}: ${socketPathFor(client.name)}`);
    console.log(`(${servers.length} client socket(s) serving)`);
  })
  .catch((error: unknown) => console.error("client sockets failed to start:", error));
