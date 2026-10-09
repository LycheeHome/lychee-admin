import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { normalizeRepo, parseDeclaration, claimedPorts, siteSuffixFor, type DeclarationSummary } from "./siteResource";
import { siteNamePatternFor } from "./siteValidation";

/**
 * `code: "tagged"` marks the one refusal a caller must tell apart from a failed
 * write: changeSiteRepository on a declaration that already carries a tag. It
 * is decided after the pull, so it is the remote's answer, not the page's.
 * pruneSiteDeclaration adds two of the same kind: "not-absent" (the declaration
 * is not retired) and "missing" (no such file), each also the remote's answer,
 * and reuses "tagged" when asked for a tagless declaration and given a tagged one.
 */
export type WriteResult = { ok: true } | { ok: false; reason: string; code?: "tagged" | "not-absent" | "missing" };

export type GitRunner = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

export const RESOURCES_CLONE = "/var/lib/lyly-admin/lychee-resources";
export const RESOURCES_KEY = "/etc/lyly-admin/id_lychee_resources";
// Not ~/.ssh/known_hosts, which is where ssh would look and where a reader will
// want to put it: lyly-admin was created without a home directory, so $HOME is
// not something to depend on. Without a known_hosts file ssh's default
// StrictHostKeyChecking=ask fails non-interactively with "Host key verification
// failed", which reads like a network or auth fault. /etc/lyly-admin is 0700 and
// owned by the app user, so the file can be written there regardless of $HOME.
export const RESOURCES_KNOWN_HOSTS = "/etc/lyly-admin/known_hosts";
const RESOURCES_REMOTE = "git@github.com:LycheeHome/lychee-resources.git";

// A tag this app writes must be a tag. This is the app's own invariant, not a
// copy of the reconciler's image rule: holding it here means a bad tag is
// refused at the click instead of surfacing minutes later as a blocked service.
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Group 1 ends at the FINAL colon of the image reference, so only the tag is
// ever replaced. Changing the registry or repository is deliberately
// unreachable from writeDeclarationTag. The one path that changes a repository
// is changeSiteRepository, which is bounded differently: tagless declarations
// only, and checked against the parsed YAML value, not just this line's text.
const IMAGE_LINE_RE = /^(\s*image:\s*["']?[^\s"'#]*:)([^:\s"'#]+)(.*)$/;

// A site declaration is created tagless and gets its first tag from Deploy.
// Group 1 cannot contain a colon, so a tagless line is completed by appending
// `:<tag>` inside any closing quote; the registry is pinned to ghcr.io and the
// repository is carried over untouched, so this path cannot change either one.
const TAGLESS_IMAGE_LINE_RE = /^(\s*image:\s*["']?ghcr\.io\/[^\s"'#:]+)(["']?)(.*)$/;

// A tagless image under the one org this app writes, split so that only the
// repository (group 2) is replaced: the prefix, any closing quote and anything
// after it — a trailing comment — are carried over byte for byte.
const SITE_TAGLESS_IMAGE_RE = /^(\s*image:\s*["']?ghcr\.io\/lycheehome\/)([^\s"'#:/]+)(["']?)(.*)$/;

// A site's resource name: a DNS-label-shaped site label plus the domain's
// suffix (siteNamePatternFor), capped at 63 like every resource name. Narrower
// than NAME_RE on purpose: creating and retiring are reachable only for sites,
// never for a declaration such as palsave-api that this app did not write.
const MAX_NAME_LENGTH = 63;

// One `state:` line with a bare or quoted word and an optional comment. The
// value is the only thing replaced, so the comment survives.
const STATE_LINE_RE = /^(\s*state:[ \t]*)(["']?[A-Za-z_-]+["']?)([ \t]*(?:#.*)?)$/;

const IMAGE_PREFIX = "ghcr.io/lycheehome/";

// Below 1024 is refused here because the reconciler's validator refuses it,
// and one rejected declaration freezes every resource on the host for that tick.
const MIN_SITE_PORT = 1024;
const MAX_PORT = 65535;

// lyly-admin's own PORT and Caddy's admin API. Mirrors RESERVED_PORTS in
// lychee-ops' validate_declarations.py, for the same reason as MIN_SITE_PORT:
// this is the last guard before a declaration the validator would refuse, and
// a refused declaration freezes the whole set for the tick, not just this site.
const RESERVED_PORTS: readonly number[] = [8787, 2019];

export interface WriterOptions {
  git: GitRunner;
  /** The managed domain; decides which names are sites and what hostname a
   *  site's name stands for. */
  domain: string;
  clonePath?: string;
  keyPath?: string;
  /** Kills each git call after this long. Unset for writes, which wait; set
   *  by refreshDeclarations, which runs on a page load. */
  timeoutMs?: number;
}

export function isSiteName(name: string, domain: string): boolean {
  return name.length <= MAX_NAME_LENGTH && siteNamePatternFor(domain).test(name);
}

/** What a write callback hands back: the file it changed and the commit message. */
type Change = { file: string; message: string; remove?: boolean };

function describe(error: unknown): string {
  const err = error as { stderr?: string; message?: string };
  const detail = (err.stderr ?? "").trim() || err.message || String(error);
  return detail.split("\n").slice(0, 4).join(" ").slice(0, 400);
}

// Every write in this process takes its turn on the one clone. Without this,
// a double-click or a Deploy during an Attach could pull, edit and reset
// underneath each other. In-process only: this app is a single process.
let cloneQueue: Promise<unknown> = Promise.resolve();

type Edit = (clonePath: string) => Promise<Change | WriteResult> | Change | WriteResult;

/**
 * Every write's shared half: a usable clone, freshly pulled; then, if `edit`
 * changed a file, add/commit/push. `edit` runs after the pull, so any check it
 * makes is against the remote's current state, and it returns either the file
 * it changed with a commit message, or a WriteResult that ends the write with
 * nothing committed (`{ ok: true }` for "already so").
 *
 * Never throws and never forces. A rejected push is an ordinary outcome and is
 * reported; retrying or force-pushing would turn a bounded request-writer into
 * something that can overwrite history.
 *
 * Runs after any earlier write in this process has finished (see cloneQueue).
 */
function withClone(opts: WriterOptions, edit: Edit): Promise<WriteResult> {
  const turn = cloneQueue.then(() => withCloneUnqueued(opts, edit));
  cloneQueue = turn.catch(() => undefined);
  return turn;
}

async function withCloneUnqueued(
  { git, clonePath = RESOURCES_CLONE, keyPath = RESOURCES_KEY, timeoutMs }: WriterOptions,
  edit: Edit,
): Promise<WriteResult> {
  if (!fs.existsSync(keyPath)) {
    return { ok: false, reason: `Deploy key not found at ${keyPath}.` };
  }

  // IdentitiesOnly is load-bearing: root's ssh config has a github.com block,
  // and without it another valid deploy key is offered and GitHub answers
  // "Repository not found", which reads as a missing repo, not a wrong key.
  // StrictHostKeyChecking=yes: GitHub's host keys are declared in lychee-ops
  // (/etc/lyly-admin/known_hosts), so there is no first-contact window to
  // accommodate and an unknown or changed host key is a real anomaly that must
  // fail. accept-new would not have pinned anything here anyway: the service
  // cannot write that directory, so ssh could never record a key it learned.
  const env = {
    ...process.env,
    GIT_SSH_COMMAND: [
      `ssh -i ${keyPath}`,
      "-o IdentitiesOnly=yes",
      `-o UserKnownHostsFile=${RESOURCES_KNOWN_HOSTS}`,
      "-o StrictHostKeyChecking=yes",
    ].join(" "),
  };
  const inClone = (args: string[]) =>
    git(args, { cwd: clonePath, env, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

  try {
    // Healthy means readable AND clean. A clone left dirty by a failed write
    // (an untracked file from a failed add survives reset --hard) would
    // otherwise show a phantom declaration, claim its port, and be pushed whole
    // by the next write that runs `git add` on that name, skipping the port
    // check. A stale index.lock would wedge every later write. Both are cured
    // the same way as an unreadable clone: throw it away.
    let healthy = false;
    if (fs.existsSync(path.join(clonePath, ".git")) && !fs.existsSync(path.join(clonePath, ".git", "index.lock"))) {
      try {
        await inClone(["rev-parse", "--git-dir"]);
        const { stdout } = await inClone(["status", "--porcelain"]);
        healthy = stdout.trim() === "";
      } catch {
        healthy = false;
      }
    }
    if (!healthy) {
      // Disposable by design: nothing here is the only copy of anything.
      fs.rmSync(clonePath, { recursive: true, force: true });
      fs.mkdirSync(clonePath, { recursive: true });
      await inClone(["clone", RESOURCES_REMOTE, "."]);
    } else {
      await inClone(["pull", "--ff-only"]);
    }

    const change = await edit(clonePath);
    if ("ok" in change) return change;

    try {
      await inClone(change.remove ? ["rm", "--", change.file] : ["add", "--", change.file]);
      await inClone([
        "-c", "user.name=lyly-admin",
        "-c", "user.email=lyly-admin@lychee.local",
        "commit", "-m", change.message,
      ]);
    } catch (error) {
      // Same recovery as a rejected push: the edited file must not linger in
      // the clone, or the next pull or create trips over it.
      await inClone(["reset", "--hard", "@{upstream}"]).catch(() => undefined);
      return { ok: false, reason: describe(error) };
    }
    try {
      await inClone(["push", "origin", "HEAD"]);
    } catch (error) {
      // Drop the unpushed commit so the next attempt starts from the remote,
      // not from a clone that has diverged and can no longer fast-forward.
      await inClone(["reset", "--hard", "@{upstream}"]).catch(() => undefined);
      return { ok: false, reason: `Push was rejected: ${describe(error)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
}

/**
 * Rewrites the tag of one declaration's `image:` line and pushes it, or, for a
 * site created tagless, completes the line with its first tag. The file is
 * edited as text, not parsed and re-dumped: the declarations carry long
 * comments recording why they are the way they are, and a YAML round-trip
 * would drop every one of them with nothing failing.
 *
 * Never throws and never forces (see withClone).
 */
export async function writeDeclarationTag(name: string, tag: string, opts: WriterOptions): Promise<WriteResult> {
  if (!TAG_RE.test(tag)) {
    return { ok: false, reason: `"${tag}" is not a valid image tag.` };
  }
  if (!NAME_RE.test(name)) {
    return { ok: false, reason: `"${name}" is not a valid declaration name.` };
  }
  return withClone(opts, (clonePath) => {
    const file = `${name}.yml`;
    const target = path.join(clonePath, file);
    if (!fs.existsSync(target)) {
      return { ok: false, reason: `No declaration named ${file} in lychee-resources.` };
    }
    const original = fs.readFileSync(target, "utf8");
    const lines = original.split("\n");
    // A tagged line is matched first; a line is tagless only if it is not
    // tagged and nothing follows the repository but a quote, space or comment.
    const kind = (line: string): "tagged" | "tagless" | null => {
      if (IMAGE_LINE_RE.test(line)) return "tagged";
      const m = TAGLESS_IMAGE_LINE_RE.exec(line);
      return m && !m[3].startsWith(":") ? "tagless" : null;
    };
    const hits = lines.flatMap((line, i) => (kind(line) ? [i] : []));
    if (hits.length !== 1) {
      return { ok: false, reason: `${file} has ${hits.length} image lines; expected exactly one.` };
    }
    const index = hits[0];
    lines[index] =
      kind(lines[index]) === "tagged"
        ? lines[index].replace(IMAGE_LINE_RE, (_m, head: string, _old: string, rest: string) => `${head}${tag}${rest}`)
        : lines[index].replace(
            TAGLESS_IMAGE_LINE_RE,
            (_m, head: string, quote: string, rest: string) => `${head}:${tag}${quote}${rest}`,
          );
    const updated = lines.join("\n");
    if (updated === original) {
      return { ok: true };
    }
    fs.writeFileSync(target, updated);
    return { file, message: `${name}: set image tag to ${tag}` };
  });
}

/**
 * Writes a new site declaration: exactly name, a tagless image, state running,
 * port and a loopback bind. No other field is ever written. Refuses, after the
 * pull and before writing, when the file exists or any declaration (of any
 * state) already claims the port.
 */
export async function createSiteDeclaration(
  name: string,
  repo: string,
  port: number,
  opts: WriterOptions,
): Promise<WriteResult> {
  if (!isSiteName(name, opts.domain)) {
    return { ok: false, reason: `"${name}" is not a valid site resource name.` };
  }
  const normalized = normalizeRepo(repo);
  if (!normalized.ok) return normalized;
  if (!Number.isInteger(port) || port > MAX_PORT) {
    return { ok: false, reason: `${port} is not a valid port (${MIN_SITE_PORT}–${MAX_PORT}).` };
  }
  if (port < MIN_SITE_PORT) {
    return { ok: false, reason: `Sites may not use privileged ports; ${port} is below ${MIN_SITE_PORT}.` };
  }
  if (RESERVED_PORTS.includes(port)) {
    return { ok: false, reason: `Port ${port} is reserved (lyly-admin itself or Caddy's admin API) and cannot be declared.` };
  }
  const image = `${IMAGE_PREFIX}${normalized.repo}`;
  const hostname = `${name.slice(0, -siteSuffixFor(opts.domain).length)}.${opts.domain}`;

  return withClone(opts, (clonePath) => {
    const file = `${name}.yml`;
    const target = path.join(clonePath, file);
    if (fs.existsSync(target)) {
      const existing = parseDeclaration(name, fs.readFileSync(target, "utf8"));
      if (existing?.state === "absent") {
        return {
          ok: false,
          reason: `${file} already exists with state: absent; prune it from lychee-resources before attaching ${hostname} again.`,
        };
      }
      return { ok: false, reason: `A declaration named ${file} already exists in lychee-resources.` };
    }
    const claimant = claimedPorts(readDeclarations(clonePath) ?? []).get(port);
    if (claimant !== undefined) {
      return { ok: false, reason: `Port ${port} is already claimed by ${claimant}.` };
    }
    fs.writeFileSync(
      target,
      [
        `# Written by lyly-admin for ${hostname}.`,
        "# The image stays tagless until the first Deploy writes a tag.",
        `name: ${name}`,
        `image: ${image}`,
        "state: running",
        `port: ${port}`,
        "bind: 127.0.0.1",
        "",
      ].join("\n"),
    );
    return { file, message: `${name}: attach ${image}` };
  });
}

/**
 * Retires a site declaration by rewriting its one `state:` line to `absent`,
 * as text, so the line's comment survives. Refuses unless there is exactly one
 * such line. Site names only.
 */
export async function setDeclarationState(name: string, state: "absent", opts: WriterOptions): Promise<WriteResult> {
  if (state !== "absent") {
    return { ok: false, reason: `"${String(state)}" is not a state this app writes.` };
  }
  if (!isSiteName(name, opts.domain)) {
    return { ok: false, reason: `"${name}" is not a valid site resource name.` };
  }
  return withClone(opts, (clonePath) => {
    const file = `${name}.yml`;
    const target = path.join(clonePath, file);
    if (!fs.existsSync(target)) {
      return { ok: false, reason: `No declaration named ${file} in lychee-resources.` };
    }
    const original = fs.readFileSync(target, "utf8");
    const lines = original.split("\n");
    const hits = lines.flatMap((line, i) => (/^\s*state:/.test(line) ? [i] : []));
    if (hits.length !== 1 || !STATE_LINE_RE.test(lines[hits[0]])) {
      return { ok: false, reason: `${file} has ${hits.length} state lines; expected exactly one.` };
    }
    const index = hits[0];
    lines[index] = lines[index].replace(STATE_LINE_RE, (_m, head: string, _old: string, rest: string) => `${head}${state}${rest}`);
    const updated = lines.join("\n");
    if (updated === original) {
      return { ok: true };
    }
    fs.writeFileSync(target, updated);
    return { file, message: `${name}: set state to ${state}` };
  });
}

/** A parsed image with no tag or digest: its last path component has neither ":" nor "@". */
function isTaglessImage(image: unknown): boolean {
  return typeof image === "string" && image !== "" && !/[:@]/.test(image.slice(image.lastIndexOf("/") + 1));
}

/** A declaration's whole parsed mapping, or null for anything else. Never throws. */
function parsedFields(content: string): Record<string, unknown> | null {
  try {
    const doc = load(content);
    return doc !== null && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Points a site's tagless declaration at a different repository, for the one
 * mistake that otherwise strands a site: a typo at Attach, which leaves it
 * awaiting an image that will never exist. Only the repository part of the one
 * `image:` line is rewritten, as text, so comments and every other line
 * survive; the registry stays ghcr.io/lycheehome.
 *
 * The line is found by pattern, but the decision is made on the parsed value:
 * the old line must parse to exactly ghcr.io/lycheehome/<the repo it shows>,
 * and the new file must parse to the new image with every other field equal.
 *
 * Tagless only, checked after the pull. A tag means Deploy has run and the
 * reconciler may be running that image, so changing the repository under it
 * would swap one app for another under the same name and port; that is Remove
 * and Attach, not an edit. Refused with `code: "tagged"`.
 *
 * Never throws and never forces (see withClone).
 */
export async function changeSiteRepository(name: string, repo: string, opts: WriterOptions): Promise<WriteResult> {
  if (!isSiteName(name, opts.domain)) {
    return { ok: false, reason: `"${name}" is not a valid site resource name.` };
  }
  const normalized = normalizeRepo(repo);
  if (!normalized.ok) return normalized;
  const image = `${IMAGE_PREFIX}${normalized.repo}`;

  return withClone(opts, (clonePath) => {
    const file = `${name}.yml`;
    const target = path.join(clonePath, file);
    if (!fs.existsSync(target)) {
      return { ok: false, reason: `No declaration named ${file} in lychee-resources.` };
    }
    const original = fs.readFileSync(target, "utf8");
    if (parseDeclaration(name, original)?.state === "absent") {
      return { ok: false, reason: `${file} is retired (state: absent); its repository can't be changed.` };
    }
    const lines = original.split("\n");
    if (lines.some((line) => IMAGE_LINE_RE.test(line))) {
      return {
        ok: false,
        code: "tagged",
        reason: `${file} already has a tag: deployed images can't change repository; remove the site instead.`,
      };
    }
    const hits = lines.flatMap((line, i) => (/^\s*image:/.test(line) ? [i] : []));
    if (hits.length !== 1 || !SITE_TAGLESS_IMAGE_RE.test(lines[hits[0]])) {
      return {
        ok: false,
        reason: `${file} needs exactly one tagless ${IMAGE_PREFIX}<repo> image line; it has ${hits.length} image lines.`,
      };
    }
    const index = hits[0];
    // The regexes above are lexical, and YAML is not: a quoted escape such as
    // "ghcr.io/lycheehome/foo\x3a1.0" reads as tagless here while YAML (and the
    // reconciler) parse it as tagged, and a nested path would have only its
    // first component replaced. So the line must parse to exactly the
    // repository it appears to name, or nothing is written.
    const before = parsedFields(original);
    const shown = SITE_TAGLESS_IMAGE_RE.exec(lines[index])?.[2] ?? "";
    if (!before || before.image !== `${IMAGE_PREFIX}${shown}`) {
      return {
        ok: false,
        reason: `${file}'s image line does not parse as a plain ${IMAGE_PREFIX}<repo>; edit it in lychee-resources by hand.`,
      };
    }
    lines[index] = lines[index].replace(
      SITE_TAGLESS_IMAGE_RE,
      (_m, head: string, _old: string, quote: string, rest: string) => `${head}${normalized.repo}${quote}${rest}`,
    );
    const updated = lines.join("\n");
    if (updated === original) {
      return { ok: true };
    }
    // And the rewrite must parse to the new image with every other field as it was.
    const after = parsedFields(updated);
    const withoutImage = (fields: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "image"));
    if (!after || after.image !== image || !isDeepStrictEqual(withoutImage(before), withoutImage(after))) {
      return { ok: false, reason: `Rewriting ${file} would change more than its image; nothing was written.` };
    }
    fs.writeFileSync(target, updated);
    return { file, message: `${name}: change repository to ${image}` };
  });
}

/**
 * Deletes a retired site's declaration from lychee-resources: `git rm`, one
 * commit, pushed. The only thing this app ever deletes there, and only when
 * the file's PARSED `state` is `absent`, decided after the pull, so a quoted
 * or commented value still counts and a declaration someone revived on the
 * remote is refused. Refusals carry `code: "not-absent"` or `code: "missing"`.
 * Site names only.
 *
 * `requireTagless` also refuses, with `code: "tagged"`, a declaration whose
 * PARSED image carries a tag (or digest) after the pull. The prune route sets
 * it when the inventory says `awaiting-image`, which is also what a running,
 * never-deployed site publishes: if Deploy wrote a tag and a reconcile is
 * bringing it up while the inventory still shows the previous tick, only the
 * tag shows it. A tagless declaration can never have been brought up, and no
 * writer in this app removes a tag, so a tagless file closes that race.
 *
 * Never throws and never forces (see withClone).
 */
export async function pruneSiteDeclaration(
  name: string,
  opts: WriterOptions,
  { requireTagless = false }: { requireTagless?: boolean } = {},
): Promise<WriteResult> {
  if (!isSiteName(name, opts.domain)) {
    return { ok: false, reason: `"${name}" is not a valid site resource name.` };
  }
  return withClone(opts, (clonePath) => {
    const file = `${name}.yml`;
    const target = path.join(clonePath, file);
    if (!fs.existsSync(target)) {
      return { ok: false, code: "missing", reason: `No declaration named ${file} in lychee-resources.` };
    }
    const fields = parsedFields(fs.readFileSync(target, "utf8"));
    if (fields?.state !== "absent") {
      return { ok: false, code: "not-absent", reason: `${file} is not retired (state is not absent); it can't be pruned.` };
    }
    if (requireTagless && !isTaglessImage(fields.image)) {
      return {
        ok: false,
        code: "tagged",
        reason: `${file} has an image tag, so a reconcile may still be bringing it up; it can't be pruned yet.`,
      };
    }
    return { file, message: `${name}: prune retired declaration`, remove: true };
  });
}

/**
 * Brings the local clone up to date with the remote, so a declaration pruned
 * or added on GitHub by hand is seen without waiting for this app's next
 * write. The same pull a write does (or the same re-clone, for an unhealthy
 * clone), on the same queue, so it can never run underneath a write.
 *
 * Never throws and never writes: every failure (no key, no network, a
 * timeout) leaves the clone as the failed step left it, and the page reads
 * whatever is there. A failed pull changes nothing; a failed re-clone leaves
 * no clone, which readDeclarations reports as null rather than as empty.
 */
export async function refreshDeclarations(opts: WriterOptions): Promise<void> {
  await withClone(opts, () => ({ ok: true })).catch(() => undefined);
}

/**
 * Every declaration in the local clone, as last pulled. No git: this is a
 * read for display and is as fresh as the last write, clone or refresh.
 * Unparseable files are skipped. Never throws.
 *
 * `null` means "could not tell": the clone is absent, unreadable, or a
 * directory with no `.git` (what a failed re-clone leaves). `[]` means the
 * clone is readable and declares nothing. Callers must not conflate them: a
 * site with no declaration in a readable clone is not attached, whatever the
 * inventory still says about it, while a site the app cannot see may be.
 */
export function readDeclarations(clonePath: string = RESOURCES_CLONE): DeclarationSummary[] | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(clonePath);
  } catch {
    return null;
  }
  if (!entries.includes(".git")) return null;
  return entries.flatMap((entry) => {
    if (!entry.endsWith(".yml")) return [];
    try {
      const summary = parseDeclaration(entry.slice(0, -".yml".length), fs.readFileSync(path.join(clonePath, entry), "utf8"));
      return summary ? [summary] : [];
    } catch {
      return [];
    }
  });
}
