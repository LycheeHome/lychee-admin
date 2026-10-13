// Emits the declaration writer's real output into .contract-out/ so the
// contract's own validator can judge it (npm run test:contract). The writer
// runs against a throwaway clone with a git runner that succeeds without
// effect; nothing here touches the network or a real repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  for (const f of fs.readdirSync(clonePath).filter((n) => n.endsWith(".yml")).sort()) {
    fs.copyFileSync(path.join(clonePath, f), path.join(outDir, f));
    console.log(`emitted ${f}`);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
