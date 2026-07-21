import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcrypt";
import { config } from "../config";

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;
  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const credentials = parseBasicAuth(req.headers.authorization);

  const isValid =
    credentials !== null &&
    credentials.username === config.adminUsername &&
    bcrypt.compareSync(credentials.password, config.adminPasswordHash);

  if (!isValid) {
    res.setHeader("WWW-Authenticate", 'Basic realm="lyly-admin"');
    res.status(401).send("Authentication required");
    return;
  }

  next();
}
