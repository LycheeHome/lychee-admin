import type { RequestHandler } from "express";

/**
 * Sends a GET or HEAD for `/services/` (or `/sites/x/?a=1`) to the same path
 * without its trailing slashes, query kept. Express routes are not strict, so
 * the server would answer `/services/` with the page document, but the
 * client's routes are, and the page rendered nothing under the right shell.
 * One redirect here means the client never sees a path it cannot match.
 *
 * Mounted after express.static, which answers `/client/` itself (a redirect
 * to `/client` here would loop with its redirect back), and after basic auth.
 * A 308 keeps the method. A path whose stripped form starts with `//` or `/\`
 * is left alone: as a Location it would be protocol-relative, an open
 * redirect to another host.
 */
export const trailingSlash: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const { path } = req;
  if (path.length <= 1 || !path.endsWith("/")) return next();
  const stripped = path.replace(/\/+$/, "");
  if (stripped === "" || stripped.startsWith("//") || stripped.startsWith("/\\")) return next();
  const q = req.originalUrl.indexOf("?");
  res.redirect(308, stripped + (q >= 0 ? req.originalUrl.slice(q) : ""));
};
