import { describe, expect, it } from "vitest";
import { withKeyLock } from "../keyedLock.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("withKeyLock", () => {
  it("runs work for the same key one at a time, in order", async () => {
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
      return name;
    };
    const results = await Promise.all([withKeyLock("k", job("a")), withKeyLock("k", job("b"))]);
    expect(results).toEqual(["a", "b"]);
    expect(log).toEqual(["a start", "a end", "b start", "b end"]);
  });

  it("lets different keys run side by side", async () => {
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
    };
    await Promise.all([withKeyLock("x", job("a")), withKeyLock("y", job("b"))]);
    expect(log.slice(0, 2)).toEqual(["a start", "b start"]);
  });

  it("a failure doesn't block the next caller", async () => {
    await expect(withKeyLock("k2", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(withKeyLock("k2", async () => "ok")).resolves.toBe("ok");
  });
});
