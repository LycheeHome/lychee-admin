import express from "express";
import path from "node:path";
import { basicAuth } from "./middleware/auth";
import { createSitesRouter } from "./routes/sites";
import type { Deps } from "./deps";

export function createApp(deps: Deps): express.Express {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(basicAuth);
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.use(createSitesRouter(deps));

  return app;
}
