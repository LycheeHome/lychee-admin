import fs from "node:fs";

/**
 * The filesystem operations lyly-admin performs, narrowed to exactly what
 * the app uses. Injected rather than imported directly so the dev entry
 * point can substitute an in-memory implementation — see src/dev/fakes.ts.
 *
 * Every method is synchronous, matching the call sites it replaces:
 * logAction() and backupFile() are called from synchronous positions inside
 * async route handlers, and making these async would change error timing in
 * the add/remove rollback paths.
 *
 * mkdir is always recursive and rmRecursive always forces, because that is
 * what every existing call site passes. The options are not parameterized.
 */
export interface FileSystem {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string): void;
  appendFile(path: string, content: string): void;
  copyFile(source: string, destination: string): void;
  rmRecursive(path: string): void;
  exists(path: string): boolean;
}

export const realFileSystem: FileSystem = {
  readFile: (p) => fs.readFileSync(p, "utf8"),
  writeFile: (p, content) => {
    fs.writeFileSync(p, content);
  },
  mkdir: (p) => {
    fs.mkdirSync(p, { recursive: true });
  },
  appendFile: (p, content) => {
    fs.appendFileSync(p, content);
  },
  copyFile: (source, destination) => {
    fs.copyFileSync(source, destination);
  },
  rmRecursive: (p) => {
    fs.rmSync(p, { recursive: true, force: true });
  },
  exists: (p) => fs.existsSync(p),
};
