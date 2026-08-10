import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { config } from "../config";
import { backupFile } from "../lib/backup";
import * as caddyfile from "../lib/caddyfile";
import * as tunnelConfig from "../lib/tunnelConfig";
import {
  CommandError,
  createSiteDirectory,
  reloadCaddy,
  restartCloudflared,
  validateCaddyfile,
  writeManagedConfig,
} from "../lib/exec";
import { getFrameworkScaffold } from "../lib/frameworkScaffold";
import { logAction } from "../lib/logger";
import { checkPortOpen } from "../lib/portStatus";
import { renderSiteDetail, renderSiteList, renderSiteNotFound } from "../views/html";

export const sitesRouter = Router();

// Caddy's built-in admin API — always on localhost:2019 regardless of
// what's in the Caddyfile, so it can't be caught by parsing existing sites.
const CADDY_ADMIN_PORT = 2019;

const hostnamePattern = new RegExp(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.${escapeRegex(config.domain)}$`, "i");

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidHostname(hostname: string): boolean {
  return hostnamePattern.test(hostname);
}

// Caddyfile blocks lyly-admin doesn't own (e.g. a manually added local-LAN
// block like lychee.local for admin access) must never show up as a managed
// site, since removing them here would still delete their local directory
// or tunnel ingress rule.
function isManagedHostname(hostname: string): boolean {
  return hostname === config.domain || isValidHostname(hostname);
}

const PLACEHOLDER_INDEX_HTML = (hostname: string) =>
  `<!doctype html>\n<html><head><title>${hostname}</title></head><body><h1>${hostname}</h1><p>Site created by lyly-admin. Replace this file with your content.</p></body></html>\n`;

sitesRouter.get("/", (req, res) => {
  const content = fs.readFileSync(config.caddyfilePath, "utf8");
  const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname));

  // Ports already spoken for, so the add-site form can flag a conflict
  // client-side as the user types instead of only on submit.
  const portOwners: Record<string, string> = {
    [String(config.port)]: "reserved (lyly-admin itself)",
    [String(CADDY_ADMIN_PORT)]: "reserved (Caddy admin API)",
  };
  for (const site of sites) {
    if (site.type === "reverse-proxy") portOwners[site.target] = site.hostname;
  }

  res.send(renderSiteList(sites, config.domain, config.sitesRoot, undefined, portOwners));
});

sitesRouter.get("/sites/:hostname", async (req, res) => {
  const hostname = req.params.hostname.toLowerCase();
  const content = fs.readFileSync(config.caddyfilePath, "utf8");
  const site = caddyfile.parseSites(content).find((s) => s.hostname === hostname && isManagedHostname(s.hostname));

  if (!site) {
    res.status(404).send(renderSiteNotFound(hostname));
    return;
  }

  if (site.type === "static") {
    res.send(renderSiteDetail(site, config.sitesRoot));
    return;
  }

  const respondingOnPort = await checkPortOpen(Number(site.target));
  const scaffold = site.framework ? getFrameworkScaffold(site.framework, site.target) : null;
  const scaffoldCommands = scaffold ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand } : undefined;

  res.send(renderSiteDetail(site, config.sitesRoot, respondingOnPort, scaffoldCommands));
});

sitesRouter.post("/sites", async (req, res) => {
  const hostname = String(req.body?.hostname ?? "").trim().toLowerCase();
  const type = req.body?.type === "reverse-proxy" ? "reverse-proxy" : "static";
  const port = String(req.body?.port ?? "").trim();
  const rawFramework = String(req.body?.framework ?? "").trim();
  const framework = type === "reverse-proxy" && rawFramework === "nextjs" ? "nextjs" : undefined;

  if (!isValidHostname(hostname)) {
    res.status(400).json({ error: `"${hostname}" must be a subdomain of ${config.domain}` });
    return;
  }

  if (type === "reverse-proxy" && (!port || Number(port) < 1 || Number(port) > 65535)) {
    res.status(400).json({ error: "A valid local port is required for a reverse proxy site" });
    return;
  }

  const sitePath = path.posix.join(config.sitesRoot, hostname);
  const target = type === "static" ? sitePath : port;

  // Captured so a validate/reload failure below can restore the pre-edit
  // content — see the equivalent rollback in the /delete handler.
  let caddyfileContent: string | undefined;
  let tunnelContent: string | undefined;
  let caddyReloaded = false;

  try {
    caddyfileContent = fs.readFileSync(config.caddyfilePath, "utf8");
    if (caddyfile.hostnameExists(caddyfileContent, hostname)) {
      throw new Error(`${hostname} already exists in the Caddyfile`);
    }

    if (type === "reverse-proxy") {
      const reservedPorts = new Set([config.port, CADDY_ADMIN_PORT]);
      if (reservedPorts.has(Number(port))) {
        throw new Error(`Port ${port} is reserved (used by lyly-admin itself or Caddy's admin API)`);
      }

      const conflictingSite = caddyfile
        .parseSites(caddyfileContent)
        .find((site) => site.type === "reverse-proxy" && site.target === port);
      if (conflictingSite) {
        throw new Error(`Port ${port} is already used by ${conflictingSite.hostname}`);
      }
    }

    tunnelContent = fs.readFileSync(config.tunnelConfigPath, "utf8");

    // 1. Back up both config files before touching either.
    backupFile(config.caddyfilePath);
    backupFile(config.tunnelConfigPath);

    // 2. Append the Caddyfile block.
    await writeManagedConfig(
      config.caddyfilePath,
      caddyfile.appendSite(caddyfileContent, { hostname, type, target, framework }),
    );

    // 3. Static sites get a directory + placeholder page; Next.js
    // reverse-proxy sites get a directory + Dockerfile/docker-compose
    // scaffold. Not covered by the rollback below if a later step fails —
    // same deliberate asymmetry that already applies to the static
    // placeholder file.
    if (type === "static") {
      await createSiteDirectory(hostname);
      fs.writeFileSync(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
    } else if (framework) {
      const scaffold = getFrameworkScaffold(framework, port);
      if (scaffold) {
        await createSiteDirectory(hostname);
        fs.writeFileSync(path.join(sitePath, "Dockerfile"), scaffold.dockerfile);
        fs.writeFileSync(path.join(sitePath, "docker-compose.yml"), scaffold.compose);
        fs.writeFileSync(path.join(sitePath, ".dockerignore"), scaffold.dockerignore);
      }
    }

    // 4. Append the tunnel ingress rule.
    await writeManagedConfig(
      config.tunnelConfigPath,
      tunnelConfig.addIngressRule(tunnelContent, hostname, "http://localhost:80"),
    );

    // 5. Validate before ever reloading — never reload a config we haven't checked.
    await validateCaddyfile(config.caddyfilePath);

    // 6. Reload Caddy, then restart cloudflared (ingress changes need a restart).
    await reloadCaddy();
    caddyReloaded = true;
    await restartCloudflared();

    logAction({
      action: "add-site",
      hostname,
      detail: `type=${type} target=${target}${framework ? ` framework=${framework}` : ""}`,
    });
    res.json({ added: true, hostname, type, target, framework: framework ?? "none", tunnelId: config.tunnelId });
  } catch (error) {
    const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
    logAction({ action: "add-site-failed", hostname, detail: message });

    // Only roll back if Caddy never actually reloaded with the edited
    // config — once it has, the live server already matches the edited
    // files, and restoring the old content would desync them the other way.
    if (!caddyReloaded && caddyfileContent !== undefined && tunnelContent !== undefined) {
      try {
        await writeManagedConfig(config.caddyfilePath, caddyfileContent);
        await writeManagedConfig(config.tunnelConfigPath, tunnelContent);
        logAction({ action: "add-site-rolled-back", hostname });
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof CommandError
            ? `${rollbackError.message}\n${rollbackError.stderr}`
            : String(rollbackError);
        logAction({ action: "add-site-rollback-failed", hostname, detail: rollbackMessage });
        res.status(500).json({
          error: `${message}\n\nAdditionally, restoring the original config failed: ${rollbackMessage}\n\nManual recovery needed — backups are in ${config.backupDir}.`,
        });
        return;
      }
    }

    res.status(500).json({
      error: `${message}\n\nBacked-up copies of the Caddyfile and tunnel config were saved to ${config.backupDir} before this attempt — review and restore manually if the configs were left in a bad state.`,
    });
  }
});

sitesRouter.post("/sites/:hostname/delete", async (req, res) => {
  const hostname = req.params.hostname.toLowerCase();
  const wantsFileDelete = req.body?.deleteFiles === "on";

  // Captured so a validate/reload failure below can restore the pre-edit
  // content — Caddy never actually reloaded in that case, so leaving the
  // edited-but-unapplied file on disk would desync the site list (which
  // reads straight off this file) from what's still actually being served.
  let caddyfileContent: string | undefined;
  let tunnelContent: string | undefined;
  let caddyReloaded = false;

  try {
    caddyfileContent = fs.readFileSync(config.caddyfilePath, "utf8");
    const existingSite = caddyfile.parseSites(caddyfileContent).find((site) => site.hostname === hostname);

    backupFile(config.caddyfilePath);
    backupFile(config.tunnelConfigPath);

    await writeManagedConfig(config.caddyfilePath, caddyfile.removeSite(caddyfileContent, hostname));

    tunnelContent = fs.readFileSync(config.tunnelConfigPath, "utf8");
    await writeManagedConfig(config.tunnelConfigPath, tunnelConfig.removeIngressRule(tunnelContent, hostname));

    await validateCaddyfile(config.caddyfilePath);
    await reloadCaddy();
    caddyReloaded = true;
    await restartCloudflared();

    logAction({ action: "remove-site", hostname });

    // Site file deletion is a separate, explicit request — never triggered
    // by the same request that removes the site from Caddy/tunnel config.
    const filesPath = existingSite ? caddyfile.computeFilesPath(existingSite, config.sitesRoot) : null;

    if (wantsFileDelete && filesPath) {
      res.json({ removed: true, needsFileConfirm: true, sitePath: filesPath });
      return;
    }

    res.json({ removed: true, needsFileConfirm: false });
  } catch (error) {
    const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
    logAction({ action: "remove-site-failed", hostname, detail: message });

    // Only roll back if Caddy never actually reloaded with the edited
    // config — once it has, the live server already matches the edited
    // files, and restoring the old content would desync them the other way.
    if (!caddyReloaded && caddyfileContent !== undefined && tunnelContent !== undefined) {
      try {
        await writeManagedConfig(config.caddyfilePath, caddyfileContent);
        await writeManagedConfig(config.tunnelConfigPath, tunnelContent);
        logAction({ action: "remove-site-rolled-back", hostname });
      } catch (rollbackError) {
        const rollbackMessage =
          rollbackError instanceof CommandError
            ? `${rollbackError.message}\n${rollbackError.stderr}`
            : String(rollbackError);
        logAction({ action: "remove-site-rollback-failed", hostname, detail: rollbackMessage });
        res.status(500).json({
          error: `${message}\n\nAdditionally, restoring the original config failed: ${rollbackMessage}\n\nManual recovery needed — backups are in ${config.backupDir}.`,
        });
        return;
      }
    }

    res.status(500).json({ error: message });
  }
});

sitesRouter.post("/sites/:hostname/delete-files", (req, res) => {
  const hostname = req.params.hostname.toLowerCase();

  if (!isValidHostname(hostname)) {
    res.status(400).json({ error: `"${hostname}" must be a subdomain of ${config.domain}` });
    return;
  }

  const sitePath = path.posix.join(config.sitesRoot, hostname);

  try {
    fs.rmSync(sitePath, { recursive: true, force: true });
    logAction({ action: "delete-site-files", hostname, detail: sitePath });
    res.json({ deleted: true });
  } catch (error) {
    const message = String(error);
    logAction({ action: "delete-site-files-failed", hostname, detail: message });
    res.status(500).json({ error: message });
  }
});
