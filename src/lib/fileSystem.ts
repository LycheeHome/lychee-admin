import fs from "node:fs";

/**
 * The filesystem operations lychee-admin performs, narrowed to exactly what
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
  /** At most the last `maxBytes` bytes of a file, decoded as UTF-8. Reads
   *  only that much: an action's log can grow without bound. */
  readTail(path: string, maxBytes: number): string;
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
  readTail: (p, maxBytes) => {
    const fd = fs.openSync(p, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, size - length);
      return buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  },
};
