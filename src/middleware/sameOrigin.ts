import type { RequestHandler } from "express";
import type { createLogger } from "../lib/logger";

type Logger = ReturnType<typeof createLogger>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The Origin's host[:port], or null when it is `null` or does not parse. */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Refuses cross-site requests that could change something. Basic auth is
 * attached by the browser to any request it makes to this origin, so without
 * this a page on another site could POST to a mutating route.
 *
 * Hosts are compared, not schemes: `admin.lychee.land` reaches Express as
 * plain HTTP behind Caddy, with the Host header preserved, so the Origin's
 * `https://` would never equal the request's own scheme. Requests carrying
 * neither header (curl, scripts) are not browser-driven and pass.
 */
export function sameOrigin(logger: Logger): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const site = header(req.headers["sec-fetch-site"]);
    const origin = header(req.headers.origin);
    const host = header(req.headers.host)?.toLowerCase();

    let allowed: boolean;
    if (site !== undefined) {
      allowed = site === "same-origin" || site === "none";
    } else if (origin !== undefined) {
      const parsed = originHost(origin);
      allowed = parsed !== null && host !== undefined && parsed === host;
    } else {
      allowed = true;
    }
    if (allowed) return next();

    logger.logAction({
      action: "refused-cross-site",
      hostname: host ?? "",
      detail: `${req.method} ${req.path} Sec-Fetch-Site=${site ?? "-"} Origin=${origin ?? "-"} Host=${host ?? "-"}`,
    });
    res.status(403).type("text/plain").send("Cross-site request refused");
  };
}
