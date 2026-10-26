import { describe, expect, test } from "bun:test";
import { createRng } from "../src/engine/rng";

describe("rng", () => {
  test("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test("different seeds differ", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });
});
