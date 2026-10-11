import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";

process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = "unused";
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.CADDYFILE_PATH = "/etc/caddy/Caddyfile";
process.env.TUNNEL_CONFIG_PATH = "/etc/cloudflared/sites-config.yml";
process.env.SITES_ROOT = "/var/www";

test("an unauthenticated request is challenged with the lychee-admin realm", async () => {
  const { basicAuth } = await import("./auth");
  const headers: Record<string, string> = {};
  let status = 0;
  const res = {
    setHeader: (k: string, v: string) => void (headers[k] = v),
    status: (c: number) => {
      status = c;
      return { send: () => undefined };
    },
  } as unknown as Response;
  basicAuth({ headers: {} } as Request, res, (() => assert.fail("next called")) as NextFunction);
  assert.equal(status, 401);
  assert.equal(headers["WWW-Authenticate"], 'Basic realm="lychee-admin"');
});
