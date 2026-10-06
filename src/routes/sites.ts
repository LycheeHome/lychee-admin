import path from "node:path";
import { Router } from "express";
import { config } from "../config";
import * as caddyfile from "../lib/caddyfile";
import * as tunnelConfig from "../lib/tunnelConfig";
import { CommandError } from "../lib/systemCommands";
import { claimedPorts } from "../lib/siteResource";
import { getFrameworkScaffold } from "../lib/frameworkScaffold";
import { checkPortOpen } from "../lib/portStatus";
import { ADD_STEPS, REMOVE_STEPS, createStepReport } from "../lib/stepReport";
import {
  isManagedHostname,
  isValidHostname,
  readSiteInput,
  validateAgainstExisting,
  validateSiteInput,
  type SiteEnv,
} from "../lib/siteValidation";
import { buildSitePreview } from "../lib/sitePreview";
import { renderAddSite, renderSiteDetail, renderSiteList, renderSiteNotFound } from "../views/html";
import type { SiteStatus } from "../lib/siteDisplay";
import type { UnitState } from "../lib/unitState";
import type { Site } from "../lib/caddyfile";
import type { Deps } from "../deps";

// Caddy's built-in admin API — always on localhost:2019 regardless of
// what's in the Caddyfile, so it can't be caught by parsing existing sites.
const CADDY_ADMIN_PORT = 2019;

const SITE_ENV: SiteEnv = {
  domain: config.domain,
  sitesRoot: config.sitesRoot,
  caddyfilePath: config.caddyfilePath,
  tunnelConfigPath: config.tunnelConfigPath,
  reservedPorts: [config.port, CADDY_ADMIN_PORT],
};

const PLACEHOLDER_INDEX_HTML = (hostname: string) =>
  `<!doctype html>\n<html><head><title>${hostname}</title></head><body><h1>${hostname}</h1><p>Site created by lyly-admin. Replace this file with your content.</p></body></html>\n`;

// Ports already spoken for, so the add-site form can flag a conflict
// client-side as the user types instead of only on submit.
function computePortOwners(sites: Site[]): Record<string, string> {
  const portOwners: Record<string, string> = {
    [String(config.port)]: "reserved (lyly-admin itself)",
    [String(CADDY_ADMIN_PORT)]: "reserved (Caddy admin API)",
  };
  for (const site of sites) {
    if (site.type === "reverse-proxy") portOwners[site.target] = site.hostname;
  }
  return portOwners;
}

/**
 * Status for the list page. Reverse-proxy sites only: static sites have no
 * check today and gain none here. Concurrent, so the page costs the slowest
 * check rather than their sum — and every call is bounded, because
 * checkContainerStatus carries its own timeout and checkPortOpen a 500ms one.
 */
async function computeStatuses(sites: Site[], deps: Deps): Promise<Record<string, SiteStatus>> {
  const entries = await Promise.all(
    sites
      .filter((site) => site.type === "reverse-proxy")
      .map(async (site): Promise<[string, SiteStatus]> => {
        if (site.framework) {
          return [site.hostname, { kind: "container", ...(await deps.commands.checkContainerStatus(site.hostname)) }];
        }
        const port = Number(site.target);
        return [site.hostname, { kind: "tcp", responding: port >= 1 && port <= 65535 ? await checkPortOpen(port) : false }];
      }),
  );
  return Object.fromEntries(entries);
}

export function createSitesRouter(deps: Deps): Router {
  const sitesRouter = Router();

  // Called once per request, by both POST /sites and POST /sites/preview, so
  // the two can never disagree about which ports are claimed. An unreadable
  // clone degrades to no claims: the writer re-checks at declaration time.
  async function readDeclaredPorts(): Promise<Map<number, string>> {
    try {
      return claimedPorts(await deps.commands.readDeclarations());
    } catch {
      return new Map();
    }
  }
  const { backupFile } = deps.backup;
  const { logAction } = deps.logger;

  sitesRouter.get("/", async (req, res) => {
    // A fact about a removal that already completed, independent of whether
    // the Caddyfile happens to be readable on this particular request — so
    // it's computed once and threaded into both the success and error
    // renders below, rather than only the happy path.
    const removed = typeof req.query.removed === "string" ? req.query.removed : undefined;
    const notice = removed
      ? `Removed ${removed}. Remember to remove the DNS record in Cloudflare manually.`
      : undefined;

    try {
      const content = deps.fs.readFile(config.caddyfilePath);
      const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname, config.domain));

      res.send(renderSiteList(sites, await computeStatuses(sites, deps), config.domain, undefined, { page: "sites" }, notice));
    } catch (error) {
      const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
      res.status(500).send(renderSiteList([], {}, config.domain, message, { page: "sites" }, notice));
    }
  });

  // Registered above /sites/:hostname deliberately: Express matches in
  // registration order, so if this were below, "new" would be captured as
  // :hostname, fail isManagedHostname, and 404 instead of rendering the form.
  sitesRouter.get("/sites/new", (req, res) => {
    const content = deps.fs.readFile(config.caddyfilePath);
    const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname, config.domain));
    res.send(
      renderAddSite(sites, config.domain, computePortOwners(sites), {
        caddyfilePath: config.caddyfilePath,
        tunnelConfigPath: config.tunnelConfigPath,
      }),
    );
  });

  sitesRouter.get("/sites/:hostname", async (req, res) => {
    const hostname = req.params.hostname.toLowerCase();
    const created = req.query.created === "1";

    try {
      const content = deps.fs.readFile(config.caddyfilePath);
      const sites = caddyfile.parseSites(content).filter((s) => isManagedHostname(s.hostname, config.domain));
      const site = sites.find((s) => s.hostname === hostname);

      // Read for display only, so an unreadable tunnel config must not take the
      // page down — the DNS step falls back to dashboard instructions.
      let tunnelId = "";
      try {
        tunnelId = tunnelConfig.readTunnelId(deps.fs.readFile(config.tunnelConfigPath));
      } catch {
        tunnelId = "";
      }

      if (!site) {
        res.status(404).send(renderSiteNotFound(hostname));
        return;
      }

      // The tunnel and Caddy hops' live state: one read for both units, run
      // alongside the per-site check below. A failed read degrades to {} (both
      // hops render `unknown`) rather than taking the page down.
      const unitStatesRead = (async (): Promise<Record<string, UnitState>> => {
        try {
          return await deps.commands.readUnitStates(["caddy.service", "cloudflared-sites.service"]);
        } catch {
          return {};
        }
      })();

      if (site.type === "static") {
        const unitStates = await unitStatesRead;
        res.send(
          renderSiteDetail(site, {
            sitesRoot: config.sitesRoot,
            domain: config.domain,
            tunnelId,
            tunnelConfigPath: config.tunnelConfigPath,
            caddyfilePath: config.caddyfilePath,
            unitStates,
            sites,
            created,
          }),
        );
        return;
      }

      // Guard against a hand-edited Caddyfile block with an out-of-range port
      // (caddyfile.parseSites only checks the target is digits, not a valid
      // port number) — treat it as simply "not responding" rather than
      // letting an invalid value reach net.connect inside checkPortOpen.
      const port = Number(site.target);
      const [status, unitStates] = await Promise.all([
        (async (): Promise<SiteStatus> =>
          site.framework
            ? { kind: "container", ...(await deps.commands.checkContainerStatus(hostname)) }
            : { kind: "tcp", responding: port >= 1 && port <= 65535 ? await checkPortOpen(port) : false })(),
        unitStatesRead,
      ]);
      // site.healthcheckPath is unvalidated on this read path (only POST /sites validates it);
      // safe here only because scaffold.dockerfile is discarded below and never rendered.
      const scaffold = site.framework
        ? getFrameworkScaffold(site.framework, site.healthcheckPath ?? "/")
        : null;
      const scaffoldCommands = scaffold
        ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand }
        : undefined;

      res.send(
        renderSiteDetail(site, {
          sitesRoot: config.sitesRoot,
          domain: config.domain,
          tunnelId,
          tunnelConfigPath: config.tunnelConfigPath,
          caddyfilePath: config.caddyfilePath,
          status,
          scaffold: scaffoldCommands,
          unitStates,
          sites,
          created,
        }),
      );
    } catch (error) {
      const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
      // Unlike GET /'s own fallback, this page's URL is /sites/<hostname> —
      // marking "sites" current here would violate the header's own rule
      // that an item's destination never changes with location.
      res.status(500).send(renderSiteList([], {}, config.domain, message, {}));
    }
  });

  sitesRouter.post("/sites", async (req, res) => {
    const input = readSiteInput(req.body);
    const { hostname, type, port, framework, healthcheckPath } = input;

    const validation = validateSiteInput(input, SITE_ENV);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const sitePath = path.posix.join(config.sitesRoot, hostname);
    const target = type === "static" ? sitePath : port;

    // Captured so a validate/reload failure below can restore the pre-edit
    // content — see the equivalent rollback in the /delete handler.
    let caddyfileContent: string | undefined;
    let tunnelContent: string | undefined;
    let caddyReloaded = false;

    const report = createStepReport(ADD_STEPS);

    try {
      caddyfileContent = deps.fs.readFile(config.caddyfilePath);
      const existing = validateAgainstExisting(input, caddyfileContent, SITE_ENV, await readDeclaredPorts());
      if (!existing.ok) throw new Error(existing.error);

      tunnelContent = deps.fs.readFile(config.tunnelConfigPath);

      await report.run("backup", async () => {
        backupFile(config.caddyfilePath);
        backupFile(config.tunnelConfigPath);
      });

      await report.run("caddyfile", () =>
        deps.commands.writeManagedConfig(
          config.caddyfilePath,
          caddyfile.appendSite(caddyfileContent!, { hostname, type, target, framework, healthcheckPath }),
        ),
      );

      // Only static sites get a directory + placeholder page. A Next.js site
      // is a container resource declared elsewhere, and its scaffold is for
      // the site's own repository, so the host gets nothing; a plain proxy
      // has no directory either. Both are skips, not steps that never ran.
      // Not covered by the rollback below if a later step fails — same
      // deliberate asymmetry that already applies to the placeholder file.
      if (type === "static") {
        await report.run("files", async () => {
          await deps.commands.createSiteDirectory(hostname);
          deps.fs.writeFile(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
        });
      } else {
        report.skip("files");
      }

      await report.run("tunnel", () =>
        deps.commands.writeManagedConfig(
          config.tunnelConfigPath,
          tunnelConfig.addIngressRule(tunnelContent!, hostname, "http://localhost:80"),
        ),
      );

      // Validate before ever reloading — never reload a config we haven't checked.
      await report.run("caddy", async () => {
        await deps.commands.validateCaddyfile(config.caddyfilePath);
        await deps.commands.reloadCaddy();
        caddyReloaded = true;
      });

      await report.run("cloudflared", () => deps.commands.restartCloudflared());

      logAction({
        action: "add-site",
        hostname,
        detail: `type=${type} target=${target}${framework ? ` framework=${framework}` : ""}`,
      });
      res.json({
        added: true,
        hostname,
        type,
        target,
        framework: framework ?? "none",
        tunnelId: tunnelConfig.readTunnelId(tunnelContent),
        steps: report.steps(),
      });
    } catch (error) {
      // Plain Error here means a thrown validator error — its .message is
      // already the validator's own string. String(error) would prepend
      // "Error: ", which the preview route (reporting the same validator's
      // .error directly, never through throw/catch) never adds; extracting
      // .message keeps POST /sites and POST /sites/preview byte-identical
      // for the same rejected input.
      const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : error instanceof Error ? error.message : String(error);
      logAction({ action: "add-site-failed", hostname, detail: message });

      // Only roll back if Caddy never actually reloaded with the edited
      // config — once it has, the live server already matches the edited
      // files, and restoring the old content would desync them the other way.
      if (!caddyReloaded && caddyfileContent !== undefined && tunnelContent !== undefined) {
        try {
          await deps.commands.writeManagedConfig(config.caddyfilePath, caddyfileContent);
          await deps.commands.writeManagedConfig(config.tunnelConfigPath, tunnelContent);
          logAction({ action: "add-site-rolled-back", hostname });
        } catch (rollbackError) {
          const rollbackMessage =
            rollbackError instanceof CommandError
              ? `${rollbackError.message}\n${rollbackError.stderr}`
              : String(rollbackError);
          logAction({ action: "add-site-rollback-failed", hostname, detail: rollbackMessage });
          res.status(500).json({
            error: `${message}\n\nAdditionally, restoring the original config failed: ${rollbackMessage}\n\nManual recovery needed — backups are in ${config.backupDir}.`,
            steps: report.steps(),
          });
          return;
        }
      }

      // The backup sentence must only appear when the backup step actually
      // ran: every pre-step failure (duplicate hostname, reserved port, port
      // conflict, either readFile) throws before report.run("backup", ...)
      // ever executes, and asserting backups exist in that case would tell
      // the operator root-owned configs might be in a bad state when nothing
      // was ever touched.
      const backupRan = report.steps().find((step) => step.id === "backup")?.status === "ok";
      const backupNote = backupRan
        ? `\n\nBacked-up copies of the Caddyfile and tunnel config were saved to ${config.backupDir} before this attempt — review and restore manually if the configs were left in a bad state.`
        : "";
      res.status(500).json({
        error: `${message}${backupNote}`,
        steps: report.steps(),
      });
    }
  });

  /**
   * What POST /sites would write, without writing it. Reads the two config
   * files and calls the same validators and the same appendSite /
   * addIngressRule the add handler does, so the panel it feeds cannot drift
   * from what actually lands on disk.
   *
   * Always 200. A half-typed form is not a client error, and a 4xx per
   * keystroke would fill the console with failures that are merely early.
   */
  sitesRouter.post("/sites/preview", async (req, res) => {
    const input = readSiteInput(req.body);
    if (!input.hostname) {
      res.json({ ready: false });
      return;
    }

    const validation = validateSiteInput(input, SITE_ENV);
    if (!validation.ok) {
      res.json({ ready: false, error: validation.error });
      return;
    }

    // Async handler: a throw here would hang the request and crash the
    // process under Express 4, so an unreadable config becomes an error the
    // panel can show, in the same shape as any other rejection.
    try {
      const caddyfileContent = deps.fs.readFile(config.caddyfilePath);
      const tunnelContent = deps.fs.readFile(config.tunnelConfigPath);

      const existing = validateAgainstExisting(input, caddyfileContent, SITE_ENV, await readDeclaredPorts());
      if (!existing.ok) {
        res.json({ ready: false, error: existing.error });
        return;
      }

      res.json({ ready: true, preview: buildSitePreview(input, { caddyfileContent, tunnelContent }, SITE_ENV) });
    } catch (error) {
      res.json({ ready: false, error: error instanceof Error ? error.message : String(error) });
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

    const report = createStepReport(REMOVE_STEPS);
    let rolledBack = false;

    try {
      caddyfileContent = deps.fs.readFile(config.caddyfilePath);
      const existingSite = caddyfile.parseSites(caddyfileContent).find((site) => site.hostname === hostname);
      // Read up front, beside caddyfileContent — not after the Caddyfile
      // write — so the rollback guard below (which requires both contents)
      // can never be half-satisfied. A read failure here now aborts before
      // anything is mutated, rather than leaving the Caddyfile
      // edited-but-unapplied with no rollback and nothing to report it.
      tunnelContent = deps.fs.readFile(config.tunnelConfigPath);

      backupFile(config.caddyfilePath);
      backupFile(config.tunnelConfigPath);

      await report.run("caddyfile", () =>
        deps.commands.writeManagedConfig(config.caddyfilePath, caddyfile.removeSite(caddyfileContent!, hostname)),
      );

      await report.run("tunnel", () =>
        deps.commands.writeManagedConfig(
          config.tunnelConfigPath,
          tunnelConfig.removeIngressRule(tunnelContent!, hostname),
        ),
      );

      await report.run("caddy", async () => {
        await deps.commands.validateCaddyfile(config.caddyfilePath);
        await deps.commands.reloadCaddy();
        caddyReloaded = true;
      });

      await report.run("cloudflared", () => deps.commands.restartCloudflared());

      logAction({ action: "remove-site", hostname });

      // Site file deletion is a separate, explicit request — never triggered
      // by the same request that removes the site from Caddy/tunnel config.
      const filesPath = existingSite ? caddyfile.computeFilesPath(existingSite, config.sitesRoot) : null;

      if (wantsFileDelete && filesPath) {
        res.json({ removed: true, needsFileConfirm: true, sitePath: filesPath, steps: report.steps() });
        return;
      }

      res.json({ removed: true, needsFileConfirm: false, steps: report.steps() });
    } catch (error) {
      const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
      logAction({ action: "remove-site-failed", hostname, detail: message });

      // Only roll back if Caddy never actually reloaded with the edited
      // config — once it has, the live server already matches the edited
      // files, and restoring the old content would desync them the other way.
      if (!caddyReloaded && caddyfileContent !== undefined && tunnelContent !== undefined) {
        try {
          await deps.commands.writeManagedConfig(config.caddyfilePath, caddyfileContent);
          await deps.commands.writeManagedConfig(config.tunnelConfigPath, tunnelContent);
          logAction({ action: "remove-site-rolled-back", hostname });
          rolledBack = true;
        } catch (rollbackError) {
          const rollbackMessage =
            rollbackError instanceof CommandError
              ? `${rollbackError.message}\n${rollbackError.stderr}`
              : String(rollbackError);
          logAction({ action: "remove-site-rollback-failed", hostname, detail: rollbackMessage });
          res.status(500).json({
            error: `${message}\n\nAdditionally, restoring the original config failed: ${rollbackMessage}\n\nManual recovery needed — backups are in ${config.backupDir}.`,
            steps: report.steps(),
            rolledBack: false,
          });
          return;
        }
      }

      res.status(500).json({ error: message, steps: report.steps(), rolledBack });
    }
  });

  sitesRouter.post("/sites/:hostname/delete-files", (req, res) => {
    const hostname = req.params.hostname.toLowerCase();

    if (!isValidHostname(hostname, config.domain)) {
      res.status(400).json({ error: `"${hostname}" must be a subdomain of ${config.domain}` });
      return;
    }

    const sitePath = path.posix.join(config.sitesRoot, hostname);

    try {
      deps.fs.rmRecursive(sitePath);
      logAction({ action: "delete-site-files", hostname, detail: sitePath });
      res.json({ deleted: true });
    } catch (error) {
      const message = String(error);
      logAction({ action: "delete-site-files-failed", hostname, detail: message });
      res.status(500).json({ error: message });
    }
  });

  return sitesRouter;
}
