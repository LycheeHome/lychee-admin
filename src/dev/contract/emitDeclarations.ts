// Emits the declaration writer's real output into .contract-out/ so the
// contract's own validator can judge it (npm run test:contract). The writer
// runs against a throwaway clone with a git runner that succeeds without
// effect; nothing here touches the network or a real repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  changeSiteRepository,
  createSiteDeclaration,
  setDeclarationState,
  writeDeclarationTag,
  type GitRunner,
  type WriteResult,
  type WriterOptions,
} from "../../lib/declarationWriter";

const outDir = path.join(process.cwd(), ".contract-out");
const constants = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), ".contract", "constants.json"), "utf8"),
) as { domain: string };

const EXPECTED_FILES = ["app-lychee-land.yml", "blog-lychee-land.yml", "old-lychee-land.yml"];

const git: GitRunner = async () => ({ stdout: "", stderr: "" });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lychee-contract-"));
const clonePath = path.join(scratch, "clone");
const keyPath = path.join(scratch, "key");
fs.mkdirSync(path.join(clonePath, ".git"), { recursive: true });
fs.writeFileSync(keyPath, "unused\n");

const opts: WriterOptions = { git, domain: constants.domain, clonePath, keyPath };

function must(label: string, result: WriteResult): void {
  if (!result.ok) throw new Error(`${label} failed: ${result.reason}`);
}

async function main(): Promise<void> {
  must("create blog", await createSiteDeclaration("blog-lychee-land", "blog", 3100, opts));
  must("tag blog", await writeDeclarationTag("blog-lychee-land", "1.0.0", opts));
  must("create app", await createSiteDeclaration("app-lychee-land", "app", 3200, opts));
  must("repoint app", await changeSiteRepository("app-lychee-land", "app2", opts));
  must("create old", await createSiteDeclaration("old-lychee-land", "old", 3300, opts));
  must("retire old", await setDeclarationState("old-lychee-land", "absent", opts));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const emitted = fs.readdirSync(clonePath).filter((n) => n.endsWith(".yml")).sort();
  for (const f of emitted) {
    fs.copyFileSync(path.join(clonePath, f), path.join(outDir, f));
    console.log(`emitted ${f}`);
  }
  if (JSON.stringify(emitted) !== JSON.stringify(EXPECTED_FILES)) {
    throw new Error(`emitted ${JSON.stringify(emitted)}, expected ${JSON.stringify(EXPECTED_FILES)}`);
  }

  const read = (f: string) => yaml.load(fs.readFileSync(path.join(outDir, f), "utf8")) as Record<string, unknown>;
  const blog = read("blog-lychee-land.yml");
  if (typeof blog.image !== "string" || !blog.image.endsWith(":1.0.0")) {
    throw new Error(`blog image should end with :1.0.0, got ${String(blog.image)}`);
  }
  const app = read("app-lychee-land.yml");
  if (app.image !== "ghcr.io/lycheehome/app2") {
    throw new Error(`app image should name repo app2, got ${String(app.image)}`);
  }
  const old = read("old-lychee-land.yml");
  if (old.state !== "absent") {
    throw new Error(`old state should be absent, got ${String(old.state)}`);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
