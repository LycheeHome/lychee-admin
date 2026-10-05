import fs from "node:fs";
import path from "node:path";

export type WriteResult = { ok: true } | { ok: false; reason: string };

export type GitRunner = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

export const RESOURCES_CLONE = "/var/lib/lyly-admin/lychee-resources";
export const RESOURCES_KEY = "/etc/lyly-admin/id_lychee_resources";
const RESOURCES_REMOTE = "git@github.com:LycheeHome/lychee-resources.git";

// A tag this app writes must be a tag. This is the app's own invariant, not a
// copy of the reconciler's image rule: holding it here means a bad tag is
// refused at the click instead of surfacing minutes later as a blocked service.
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Group 1 ends at the FINAL colon of the image reference, so only the tag is
// ever replaced. Changing the registry or repository is a different, unbounded
// capability and is deliberately unreachable from here.
const IMAGE_LINE_RE = /^(\s*image:\s*["']?[^\s"'#]*:)([^:\s"'#]+)(.*)$/;

export interface WriterOptions {
  git: GitRunner;
  clonePath?: string;
  keyPath?: string;
}

function describe(error: unknown): string {
  const err = error as { stderr?: string; message?: string };
  const detail = (err.stderr ?? "").trim() || err.message || String(error);
  return detail.split("\n").slice(0, 4).join(" ").slice(0, 400);
}

/**
 * Rewrites the tag of one declaration's `image:` line and pushes it. The file
 * is edited as text, not parsed and re-dumped: the declarations carry long
 * comments recording why they are the way they are, and a YAML round-trip would
 * drop every one of them with nothing failing.
 *
 * Never throws and never forces. A rejected push is an ordinary outcome and is
 * reported; retrying or force-pushing would turn a bounded request-writer into
 * something that can overwrite history.
 */
export async function writeDeclarationTag(
  name: string,
  tag: string,
  { git, clonePath = RESOURCES_CLONE, keyPath = RESOURCES_KEY }: WriterOptions,
): Promise<WriteResult> {
  if (!TAG_RE.test(tag)) {
    return { ok: false, reason: `"${tag}" is not a valid image tag.` };
  }
  if (!NAME_RE.test(name)) {
    return { ok: false, reason: `"${name}" is not a valid declaration name.` };
  }
  if (!fs.existsSync(keyPath)) {
    return { ok: false, reason: `Deploy key not found at ${keyPath}.` };
  }

  // IdentitiesOnly is load-bearing: root's ssh config has a github.com block,
  // and without it another valid deploy key is offered and GitHub answers
  // "Repository not found", which reads as a missing repo, not a wrong key.
  const env = {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes`,
  };
  const inClone = (args: string[]) => git(args, { cwd: clonePath, env });

  try {
    let healthy = false;
    if (fs.existsSync(path.join(clonePath, ".git"))) {
      try {
        await inClone(["rev-parse", "--git-dir"]);
        healthy = true;
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

    const file = `${name}.yml`;
    const target = path.join(clonePath, file);
    if (!fs.existsSync(target)) {
      return { ok: false, reason: `No declaration named ${file} in lychee-resources.` };
    }
    const original = fs.readFileSync(target, "utf8");
    const lines = original.split("\n");
    const hits = lines.flatMap((line, i) => (IMAGE_LINE_RE.test(line) ? [i] : []));
    if (hits.length !== 1) {
      return { ok: false, reason: `${file} has ${hits.length} image lines with a tag; expected exactly one.` };
    }
    const index = hits[0];
    lines[index] = lines[index].replace(IMAGE_LINE_RE, (_m, head: string, _old: string, rest: string) => `${head}${tag}${rest}`);
    const updated = lines.join("\n");
    if (updated === original) {
      return { ok: true };
    }
    fs.writeFileSync(target, updated);

    await inClone(["add", "--", file]);
    await inClone([
      "-c", "user.name=lyly-admin",
      "-c", "user.email=lyly-admin@lychee.local",
      "commit", "-m", `${name}: set image tag to ${tag}`,
    ]);
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
