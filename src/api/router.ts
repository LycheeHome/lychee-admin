// The per-client API: the only routes a client socket serves, and served
// nowhere else. Kept a separate Express app from createApp so a route on one
// can never appear on the other — no Basic auth (the socket is the caller), no
// pages, no static files, no site, deploy or services routes. createApp has
// no /v1 for the same reason.

import express from "express";
import type { Deps } from "../deps";
import { type Caller, isHostAction, readCheckedActionState, requestAction } from "../lib/hostOperations";

const ROUTE = "/v1/units/:unit/actions/:action";

export function createApiRouter(deps: Deps, caller: Caller): express.Router {
  const router = express.Router();

  router.post(ROUTE, async (req, res, next) => {
    const { unit, action } = req.params;
    // The raw string is checked before anything else reads it.
    if (!isHostAction(action)) return res.status(404).json({ error: `no action ${action}` });
    try {
      const result = await requestAction(deps, unit, action, caller);
      if (!result.ok) return res.status(result.status).json({ error: result.message });
      return res.status(202).json(result.state);
    } catch (error) {
      return next(error);
    }
  });

  router.get(ROUTE, async (req, res, next) => {
    const { unit, action } = req.params;
    try {
      const result = await readCheckedActionState(deps, unit, action, caller);
      if (!result.ok) return res.status(result.status).json({ error: result.message });
      return res.json(result.state);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

/** The whole app a client socket serves: the API router and JSON for
 *  everything else. Never a page, and never a stack trace. */
export function createApiApp(deps: Deps, caller: Caller): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(createApiRouter(deps, caller));
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "not found" });
  });
  // Express recognises an error handler by its four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Express's param decoder throws a URIError with status 400 for a
    // malformed percent-escape: the client's fault, and not worth a log line.
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 400) return res.status(400).json({ error: "bad request" });
    console.error("lychee-admin api: unexpected error:", error);
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
