import path from "node:path";
import { Router } from "express";
import { config } from "../config";
import * as caddyfile from "../lib/caddyfile";
import * as tunnelConfig from "../lib/tunnelConfig";
import { CommandError } from "../lib/systemCommands";
import { claimedPorts, normalizeRepo, resourceNameFor, type DeclarationSummary } from "../lib/siteResource";
import { getFrameworkScaffold, getScaffoldFiles } from "../lib/frameworkScaffold";
import { readInventory, type InventoryEntry } from "../lib/serviceInventory";
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
import {
  renderAddSite,
  renderSiteDetail,
  renderSiteList,
  renderSiteNotFound,
  type SiteResourceView,
} from "../views/html";
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

const IMAGE_PREFIX = "ghcr.io/lycheehome/";

/** `ghcr.io/lycheehome/<repo>[:tag]` -> `<repo>`; null for any other image. */
function repoFromImage(image: string): string | null {
  if (!image.startsWith(IMAGE_PREFIX)) return null;
  const rest = image.slice(IMAGE_PREFIX.length).replace(/:[^:/]*$/, "");
  return rest && !rest.includes("/") ? rest : null;
}

/** What the reconciler side knows, read once per request and shared across sites. */
interface ResourceSources {
  /** null when the local clone could not be read: "could not tell", not "none". */
  declarations: DeclarationSummary[] | null;
  entries: InventoryEntry[];
}

async function readResourceSources(deps: Deps): Promise<ResourceSources> {
  // Both reads degrade rather than failing the page: an unreadable clone is
  // null (the real read never rejects; a rejection means the same thing), a
  // missing inventory no entries.
  const declarations = await deps.commands.readDeclarations().catch(() => null);
  return { declarations, entries: readInventory(deps.fs).entries };
}

/**
 * Pulls the local clone before a page reads it, so a declaration pruned or
 * added on GitHub by hand is seen. Bounded and non-throwing by contract; the
 * catch is for the contract failing, because a stale clone is never a reason
 * to fail a page.
 */
async function refreshClone(deps: Deps): Promise<void> {
  await deps.commands.refreshDeclarations().catch(() => undefined);
}

interface NextjsState {
  status: SiteStatus;
  resource?: SiteResourceView;
  detached: boolean;
}

const NOT_DEPLOYED: SiteStatus = { kind: "container", state: "not-created" };

/**
 * A Next.js site's state, decided from its declaration and its inventory entry.
 *
 * Attached means a declaration that is not `absent`, or — only when the clone
 * could not be read at all (null) — an inventory entry. The declaration wins
 * whenever it exists, because the inventory has no notion of `absent`: a
 * retired declaration must never read as awaiting, whatever the reconciler
 * last published. And a readable clone with no declaration wins over the
 * inventory too: the reconciler removes a pruned site's status file only once
 * it proves the site down, so its entry can outlive the declaration, and
 * trusting it would show a site that was pruned and re-added as attached, with no Attach to offer and a
 * Remove that retires a declaration that does not exist.
 *
 * A declaration with no inventory entry is the reconciler not having ticked
 * since the attach. That is still attached (awaiting image), so reloading the
 * page after attaching never offers Attach a second time.
 *
 * Only an installed version means a container exists to ask about; before that
 * the site is awaiting its first image, or — when the reconciler tried to
 * deploy it and could not — failed. The legacy /var/www container is never
 * consulted.
 */
async function resolveNextjsSite(site: Site, sources: ResourceSources, deps: Deps): Promise<NextjsState> {
  const name = resourceNameFor(site.hostname, config.domain);
  if (!name) return { status: NOT_DEPLOYED, detached: false };

  const declaration = sources.declarations?.find((d) => d.name === name);
  const entry = sources.entries.find((e) => e.kind === "container" && e.name === name);
  if (declaration?.state === "absent") return { status: NOT_DEPLOYED, detached: true };
  // An entry stands in for the declaration only when the clone was unreadable.
  if (!declaration && (sources.declarations !== null || !entry)) return { status: NOT_DEPLOYED, detached: false };

  const resource: SiteResourceView = {
    name,
    repo: declaration ? repoFromImage(declaration.image) : null,
    ...(entry?.available !== undefined ? { available: entry.available } : {}),
    ...(entry?.version !== undefined ? { version: entry.version } : {}),
    ...(entry?.result !== undefined ? { result: entry.result } : {}),
    ...(entry?.target !== undefined ? { target: entry.target } : {}),
    ...(entry?.gate !== undefined ? { gate: entry.gate } : {}),
    ...(entry?.failedStep !== undefined ? { failedStep: entry.failedStep } : {}),
  };
  if (!resource.version) {
    return { status: { kind: resource.result === "failed" ? "failed" : "awaiting-image" }, resource, detached: false };
  }

  const container = await deps.commands
    .checkResourceContainerStatus(name)
    .catch(() => ({ state: "unknown" as const }));
  return { status: { kind: "container", ...container }, resource, detached: false };
}

/**
 * Status for the list page. Reverse-proxy sites only: static sites have no
 * check today and gain none here. Concurrent, so the page costs the slowest
 * check rather than their sum — and every call is bounded, because
 * checkResourceContainerStatus carries its own timeout and checkPortOpen a
 * 500ms one. The list does not refresh the clone: it is the five-second
 * glance, and a git pull per view would make it the slowest page.
 */
async function computeStatuses(sites: Site[], deps: Deps): Promise<Record<string, SiteStatus>> {
  const proxies = sites.filter((site) => site.type === "reverse-proxy");
  const sources = proxies.some((site) => site.framework) ? await readResourceSources(deps) : null;
  const entries = await Promise.all(
    proxies
      .map(async (site): Promise<[string, SiteStatus]> => {
        // The same resolution as the detail page, so the list's pill and the
        // site's own page can never describe one site two ways.
        if (site.framework && sources) {
          return [site.hostname, (await resolveNextjsSite(site, sources, deps)).status];
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
  // clone (null) degrades to no claims: the writer re-checks at declaration
  // time. Neither route refreshes the clone (the add page's GET did), so the
  // two always read the same one.
  async function readDeclaredPorts(): Promise<Map<number, string>> {
    try {
      return claimedPorts((await deps.commands.readDeclarations()) ?? []);
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
  sitesRouter.get("/sites/new", async (req, res) => {
    // Async handler: an unguarded throw hangs the request and crashes the
    // process under Express 4, so a read failure becomes an ordinary 500, the
    // same as GET /.
    try {
      // For the preview and submit this page sends: neither refreshes, so the
      // port claims they check are as fresh as this page load.
      await refreshClone(deps);
      const content = deps.fs.readFile(config.caddyfilePath);
      const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname, config.domain));
      res.send(
        renderAddSite(sites, config.domain, computePortOwners(sites), {
          caddyfilePath: config.caddyfilePath,
          tunnelConfigPath: config.tunnelConfigPath,
        }),
      );
    } catch (error) {
      const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
      // The URL is /sites/new, not / — same reasoning as the detail page's
      // fallback: no header item is marked current.
      res.status(500).send(renderSiteList([], {}, config.domain, message, {}));
    }
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
            filesExist: deps.fs.exists(path.posix.join(config.sitesRoot, site.hostname)),
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
      const [nextjs, unitStates] = await Promise.all([
        (async (): Promise<NextjsState> =>
          site.framework
            ? resolveNextjsSite(site, await refreshClone(deps).then(() => readResourceSources(deps)), deps)
            : {
                status: { kind: "tcp", responding: port >= 1 && port <= 65535 ? await checkPortOpen(port) : false },
                detached: false,
              })(),
        unitStatesRead,
      ]);
      // site.healthcheckPath is unvalidated on this read path (only POST /sites
      // validates it), and the Dockerfile it lands in is rendered for copying.
      // That is HTML-safe because every file is escaped at render; the
      // Caddyfile it comes from is root-owned and written only through add-site.
      const scaffold = site.framework
        ? getFrameworkScaffold(site.framework, site.healthcheckPath ?? "/")
        : null;
      const scaffoldCommands = scaffold
        ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand }
        : undefined;
      const scaffoldFiles = site.framework ? getScaffoldFiles(site.framework, site.healthcheckPath ?? "/") : null;
      const filesPath = caddyfile.computeFilesPath(site, config.sitesRoot);

      res.send(
        renderSiteDetail(site, {
          sitesRoot: config.sitesRoot,
          domain: config.domain,
          tunnelId,
          tunnelConfigPath: config.tunnelConfigPath,
          caddyfilePath: config.caddyfilePath,
          status: nextjs.status,
          scaffold: scaffoldCommands,
          ...(scaffoldFiles ? { scaffoldFiles } : {}),
          ...(nextjs.resource ? { resource: nextjs.resource } : {}),
          detached: nextjs.detached,
          filesExist: filesPath !== null && deps.fs.exists(filesPath),
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
      if (!existing.ok) {
        // Input conflict, answered before any step runs: nothing to report.
        res.status(400).json({ error: existing.error });
        return;
      }

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
      // ran: every pre-step failure that still throws (either readFile, the
      // declared-ports read) throws before report.run("backup", ...)
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

  /**
   * Attaches a Next.js site to its repository by writing a tagless
   * declaration to lychee-resources. The port is the site's own, read from its
   * Caddyfile block — never from the request, so the declaration can only
   * claim the port Caddy already proxies this hostname to. The writer refuses
   * an existing file (naming the prune when it is retired), a claimed port and
   * a port below 1024; the ports this app reserves for itself it cannot know
   * about, so they are refused here.
   */
  sitesRouter.post("/sites/:hostname/attach", async (req, res) => {
    const hostname = req.params.hostname.toLowerCase();
    try {
      const site = caddyfile
        .parseSites(deps.fs.readFile(config.caddyfilePath))
        .find((s) => s.hostname === hostname && isManagedHostname(s.hostname, config.domain));
      const name = site ? resourceNameFor(hostname, config.domain) : null;
      if (!site || site.type !== "reverse-proxy" || site.framework !== "nextjs" || !name) {
        res.status(404).json({ ok: false, reason: `No Next.js site named ${hostname} to attach.` });
        return;
      }

      const repo = normalizeRepo(String(req.body?.repo ?? ""));
      if (!repo.ok) {
        res.status(400).json({ ok: false, reason: repo.reason });
        return;
      }

      const port = Number(site.target);
      if (SITE_ENV.reservedPorts.includes(port)) {
        res.status(400).json({ ok: false, reason: `Port ${port} is reserved and cannot be declared.` });
        return;
      }

      // Never throws by contract; the catch below is for the contract failing.
      const result = await deps.commands.createSiteDeclaration(name, repo.repo, port);
      if (!result.ok) {
        logAction({ action: "attach-site-failed", hostname, detail: `${name} ${repo.repo}: ${result.reason}` });
        res.status(502).json({ ok: false, reason: result.reason });
        return;
      }
      logAction({ action: "attach-site", hostname, detail: `${name} image=${IMAGE_PREFIX}${repo.repo} port=${port}` });
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAction({ action: "attach-site-failed", hostname, detail: message });
      res.status(502).json({ ok: false, reason: `Could not attach the repository: ${message}` });
    }
  });

  /**
   * Points an attached site's tagless declaration at a different repository:
   * the fix for a typo at Attach, which otherwise leaves the site awaiting an
   * image that will never exist. The resource name comes from the hostname and
   * nothing but `repo` is read from the request.
   *
   * 409 when the declaration already carries a tag — the writer decides that
   * after its own pull, so a page that loaded before a Deploy cannot slip a
   * change past it. Every other refusal is a 502 with the writer's reason, as
   * for Attach.
   */
  sitesRouter.post("/sites/:hostname/repository", async (req, res) => {
    const hostname = req.params.hostname.toLowerCase();
    try {
      const site = caddyfile
        .parseSites(deps.fs.readFile(config.caddyfilePath))
        .find((s) => s.hostname === hostname && isManagedHostname(s.hostname, config.domain));
      const name = site ? resourceNameFor(hostname, config.domain) : null;
      if (!site || site.type !== "reverse-proxy" || site.framework !== "nextjs" || !name) {
        res.status(404).json({ ok: false, reason: `No Next.js site named ${hostname} to change.` });
        return;
      }

      const repo = normalizeRepo(String(req.body?.repo ?? ""));
      if (!repo.ok) {
        res.status(400).json({ ok: false, reason: repo.reason });
        return;
      }

      // Never throws by contract; the catch below is for the contract failing.
      const result = await deps.commands.changeSiteRepository(name, repo.repo);
      if (!result.ok) {
        logAction({ action: "change-repository-failed", hostname, detail: `${name} ${repo.repo}: ${result.reason}` });
        res.status(result.code === "tagged" ? 409 : 502).json({ ok: false, reason: result.reason });
        return;
      }
      logAction({ action: "change-repository", hostname, detail: `${name} image=${IMAGE_PREFIX}${repo.repo}` });
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAction({ action: "change-repository-failed", hostname, detail: message });
      res.status(502).json({ ok: false, reason: `Could not change the repository: ${message}` });
    }
  });

  /**
   * Retires a site's container declaration by setting it to `state: absent`,
   * which is what has the reconciler take the container down. Always its own
   * request, sent by the client only after /delete succeeded — never part of
   * the Caddy/tunnel removal.
   *
   * It requires a declaration, not a site in the Caddyfile: by the time this
   * runs the Caddy block is already gone, and a retry after a failed write has
   * to find the declaration with nothing else left to look at.
   *
   * 404 only when the clone is readable and has no such declaration. An
   * unreadable clone (readDeclarations returns null) is a 502 that says so:
   * the app cannot tell whether the site is declared, and the client treats it
   * as a failed step and offers Retry. The catch's 502 is for the read
   * rejecting, which the production implementation never does.
   */
  sitesRouter.post("/sites/:hostname/detach", async (req, res) => {
    const hostname = req.params.hostname.toLowerCase();
    const name = resourceNameFor(hostname, config.domain);
    if (!name) {
      res.status(404).json({ ok: false, reason: `No declaration for ${hostname} to retire.` });
      return;
    }
    try {
      const declarations = await deps.commands.readDeclarations();
      if (declarations === null) {
        const reason = `Could not read the local lychee-resources clone, so ${name}.yml could not be found to retire.`;
        logAction({ action: "detach-site-failed", hostname, detail: `${name}: ${reason}` });
        res.status(502).json({ ok: false, reason });
        return;
      }
      if (!declarations.some((d) => d.name === name)) {
        res.status(404).json({ ok: false, reason: `No declaration named ${name}.yml in lychee-resources.` });
        return;
      }
      // Never throws by contract; the catch below is for the contract failing.
      const result = await deps.commands.setDeclarationState(name, "absent");
      if (!result.ok) {
        logAction({ action: "detach-site-failed", hostname, detail: `${name}: ${result.reason}` });
        res.status(502).json({ ok: false, reason: result.reason });
        return;
      }
      logAction({ action: "detach-site", hostname, detail: `${name} state=absent` });
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAction({ action: "detach-site-failed", hostname, detail: `${name}: ${message}` });
      res.status(502).json({ ok: false, reason: `Could not retire ${name}.yml: ${message}` });
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
