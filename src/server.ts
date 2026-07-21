import express from "express";
import path from "node:path";
import { config } from "./config";
import { basicAuth } from "./middleware/auth";
import { sitesRouter } from "./routes/sites";

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(basicAuth);
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(sitesRouter);

app.listen(config.port, config.host, () => {
  console.log(`lyly-admin listening on http://${config.host}:${config.port}`);
});
