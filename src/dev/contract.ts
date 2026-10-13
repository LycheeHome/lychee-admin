import fs from "node:fs";
import path from "node:path";

/** Reads a file of the fetched lychee-contract (`.contract/<relPath>`). Tests only. */
export function loadContractJson<T>(relPath: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".contract", relPath), "utf8")) as T;
}
