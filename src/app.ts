import express from "express";
import path from "node:path";
import { basicAuth } from "./middleware/auth";
import { sameOrigin } from "./middleware/sameOrigin";
import { trailingSlash } from "./middleware/trailingSlash";
import { createSitesRouter } from "./routes/sites";
import { createServicesRouter } from "./routes/services";
import { createHealthRouter } from "./routes/health";
import { createRailRouter } from "./routes/rail";
import type { Deps } from "./deps";

export function createApp(deps: Deps): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(basicAuth);
  app.use(sameOrigin(deps.logger));
  // `redirect: false`: static's own add-a-slash redirect for a directory
  // (/client/assets → /client/assets/) would loop with trailingSlash's
  // remove-it redirect on any public/ directory without an index.html.
  app.use(express.static(path.join(__dirname, "..", "public"), { redirect: false }));
  app.use(trailingSlash);
  app.use(createSitesRouter(deps));
  app.use(createServicesRouter(deps));
  app.use(createHealthRouter(deps));
  app.use(createRailRouter(deps));

  return app;
}
