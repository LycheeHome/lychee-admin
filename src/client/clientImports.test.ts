import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/*
 * The client bundle carries only browser code. A module the client reaches
 * through a value import must not import js-yaml or a node: built-in: Vite
 * bundles the first whole (js-yaml was about 43 kB of the minified bundle
 * before src/lib/siteNames.ts split the name helpers out of siteResource.ts)
 * and only sometimes drops the second. This reads the source, not the build,
 * because CI runs the tests before it builds.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENTRY = path.join(ROOT, "src/client/main.tsx");
const FORBIDDEN = (spec: string) => spec === "js-yaml" || spec.startsWith("js-yaml/") || spec.startsWith("node:");

/** The specifiers a module value-imports or re-exports. Type-only forms carry nothing into the bundle. */
function valueImports(source: string): string[] {
  const specs: string[] = [];
  const fromRe = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of source.matchAll(fromRe)) {
    if (m[2]) continue;
    specs.push(m[3]!);
  }
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

/** Every forbidden import the client reaches, as the chain of files that reaches it. */
function forbiddenChains(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const here = [...chain, path.relative(ROOT, file)];
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      if (FORBIDDEN(spec)) found.push(`${here.join(" -> ")} -> ${spec}`);
      const next = resolveLocal(file, spec);
      if (next) walk(next, here);
    }
  };
  walk(entry, []);
  return found;
}

test("nothing the client imports reaches js-yaml or a node: built-in", () => {
  assert.deepEqual(forbiddenChains(ENTRY), []);
});

test("the walker sees through re-exports and skips type-only imports", () => {
  assert.deepEqual(valueImports('import type { A } from "js-yaml";\nexport type { B } from "node:path";'), []);
  assert.deepEqual(valueImports('import { load } from "js-yaml";'), ["js-yaml"]);
  assert.deepEqual(valueImports('export { a } from "./x";\nimport "./side";'), ["./x", "./side"]);
  assert.deepEqual(valueImports('import {\n  a,\n  type B,\n} from "./multi";'), ["./multi"]);
});
