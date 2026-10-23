import type { Deps } from "../deps";

const READ_CACHE_MS = 5_000;

interface Entry {
  at: number;
  gen: number;
  promise: Promise<unknown>;
}

// Keyed by deps.fs, not by deps: /api/health hands its readers a per-request
// wrapper whose identity differs on every call, but it spreads the same fs, so
// fs is the one object every endpoint shares. A WeakMap keeps each test's app
// (and its fake fs) isolated.
const caches = new WeakMap<object, Map<string, Entry>>();
// Clearing bumps a generation instead of emptying the maps (a WeakMap cannot
// be emptied), so one call invalidates every app's entries.
let generation = 0;

/** Drops every cached read. Every write route calls it (through clearBoardCache) before answering. */
export function clearReadCaches(): void {
  generation++;
}

/**
 * One read, shared for 5s per (deps.fs, name). Concurrent callers share the
 * in-flight promise; a rejection is evicted so it is never served.
 */
export function cachedRead<T>(
  name: string,
  deps: Deps,
  read: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  let entries = caches.get(deps.fs);
  if (!entries) {
    entries = new Map();
    caches.set(deps.fs, entries);
  }
  const at = now();
  const hit = entries.get(name);
  if (hit && hit.gen === generation && at - hit.at < READ_CACHE_MS) return hit.promise as Promise<T>;
  const promise = read();
  const entry: Entry = { at, gen: generation, promise };
  entries.set(name, entry);
  const map = entries;
  promise.catch(() => {
    if (map.get(name) === entry) map.delete(name);
  });
  return promise;
}
