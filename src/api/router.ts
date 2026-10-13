// The per-client API: the only routes a client socket serves, and served
// nowhere else. Kept a separate Express app from createApp so a route on one
// can never appear on the other — no Basic auth (the socket is the caller), no
// pages, no static files, no site, deploy or services routes. createApp has
// no /v1 for the same reason.

import express from "express";
import type { Deps } from "../deps";
import { type Caller, readActionState, requestAction } from "../lib/hostOperations";
import { HOST_ACTIONS, type HostAction, opUnitName } from "../lib/platform";
import { readInventory } from "../lib/serviceInventory";

const ROUTE = "/v1/units/:unit/actions/:action";

type Refusal = { status: 403 | 404; error: string };

function isHostAction(action: string): action is HostAction {
  return (HOST_ACTIONS as readonly string[]).includes(action);
}

/** The same checks requestAction makes, in the same order, for a read: the
 *  action is a host action, the inventory lists it for an entry of that bare
 *  name, and a client is granted it. A client never reads the state or log of
 *  an action it could not request. */
function checkRead(deps: Deps, unit: string, action: HostAction, caller: Caller): Refusal | null {
  const entry = readInventory(deps.fs).entries.find((e) => e.name === unit);
  if (!entry || entry.kind !== "unit") return { status: 404, error: `no unit named ${unit}` };
  if (!(entry.actions ?? []).includes(action)) return { status: 404, error: `${unit} has no action ${action}` };
  if (caller.kind === "client") {
    const granted = Object.hasOwn(caller.grants, unit) ? caller.grants[unit] : [];
    if (!granted.includes(action)) return { status: 403, error: `client:${caller.name} is not granted ${action} on ${unit}` };
  }
  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    if (!isHostAction(action)) return res.status(404).json({ error: `no action ${action}` });
    try {
      const refusal = checkRead(deps, unit, action, caller);
      if (refusal) return res.status(refusal.status).json({ error: refusal.error });
      // readActionState throws for two reasons; tell them apart here rather
      // than from its message: a name opUnitName refuses is 404, and anything
      // after that is systemd not answering, 502.
      try {
        opUnitName(unit, action);
      } catch {
        return res.status(404).json({ error: `${unit} is not a valid unit name` });
      }
      let state;
      try {
        state = await readActionState(deps, unit, action);
      } catch (error) {
        return res.status(502).json({ error: `could not read ${unit}'s actions: ${errorText(error)}` });
      }
      return res.json(state);
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
    console.error("lychee-admin api: unexpected error:", error);
    res.status(500).json({ error: "internal error" });
  });
  return app;
}
