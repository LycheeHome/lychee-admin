import fs from "node:fs";
import path from "node:path";

/** Reads a file of the fetched lychee-contract (`.contract/<relPath>`). Tests only. */
export function loadContractJson<T>(relPath: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".contract", relPath), "utf8")) as T;
}

/** Lists the file names in a directory of the fetched lychee-contract, sorted. Tests only. */
export function listContractDir(relDir: string): string[] {
  return fs.readdirSync(path.join(process.cwd(), ".contract", relDir)).sort();
}

/** Reads a file of the fetched lychee-contract as raw text. Tests only. */
export function loadContractText(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), ".contract", relPath), "utf8");
}
