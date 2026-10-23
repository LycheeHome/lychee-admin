import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Deps } from "../deps";
import { cachedRead, clearReadCaches } from "./readCache";

const depsWith = (fs: object): Deps => ({ fs }) as unknown as Deps;

describe("cachedRead", () => {
  test("two calls within 5s make one read", async () => {
    const deps = depsWith({});
    let reads = 0;
    const read = () => Promise.resolve(++reads);
    let t = 1000;
    assert.equal(await cachedRead("a", deps, read, () => t), 1);
    t += 4_999;
    assert.equal(await cachedRead("a", deps, read, () => t), 1);
    assert.equal(reads, 1);
  });

  test("a fresh read after 5s", async () => {
    const deps = depsWith({});
    let reads = 0;
    const read = () => Promise.resolve(++reads);
    let t = 1000;
    await cachedRead("a", deps, read, () => t);
    t += 5_000;
    assert.equal(await cachedRead("a", deps, read, () => t), 2);
  });

  test("concurrent callers share the in-flight read", async () => {
    const deps = depsWith({});
    let reads = 0;
    const read = () => Promise.resolve(++reads);
    const [x, y] = await Promise.all([cachedRead("a", deps, read), cachedRead("a", deps, read)]);
    assert.equal(x, y);
    assert.equal(reads, 1);
  });

  test("a rejected read is evicted", async () => {
    const deps = depsWith({});
    let reads = 0;
    const read = () => (++reads === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(reads));
    await assert.rejects(cachedRead("a", deps, read), /boom/);
    await new Promise((r) => setImmediate(r));
    assert.equal(await cachedRead("a", deps, read), 2);
  });

  test("clearReadCaches forces a new read", async () => {
    const deps = depsWith({});
    let reads = 0;
    const read = () => Promise.resolve(++reads);
    await cachedRead("a", deps, read);
    clearReadCaches();
    assert.equal(await cachedRead("a", deps, read), 2);
  });

  test("different names and different fs objects do not share", async () => {
    const one = depsWith({});
    const two = depsWith({});
    let reads = 0;
    const read = () => Promise.resolve(++reads);
    await cachedRead("a", one, read);
    await cachedRead("a", two, read);
    await cachedRead("b", one, read);
    assert.equal(reads, 3);
    await cachedRead("a", one, read);
    assert.equal(reads, 3);
  });
});
