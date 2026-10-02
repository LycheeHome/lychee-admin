import express from "express";
import path from "node:path";
import { basicAuth } from "./middleware/auth";
import { createSitesRouter } from "./routes/sites";
import { createServicesRouter } from "./routes/services";
import type { Deps } from "./deps";

export function createApp(deps: Deps): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(createSitesRouter(deps));
  app.use(createServicesRouter(deps));

  return app;
}
