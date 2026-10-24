import { describe, expect, test } from "bun:test";

import { RunGate } from "../src/engine/run-gate";

describe("RunGate", () => {
  test("a newer run invalidates an older run", () => {
    const gate = new RunGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  test("cancel invalidates pending work before a restarted run begins", () => {
    const gate = new RunGate();
    const oldRun = gate.begin();

    gate.cancel();
    expect(gate.isCurrent(oldRun)).toBe(false);

    const restartedRun = gate.begin();
    expect(gate.isCurrent(restartedRun)).toBe(true);
    expect(gate.isCurrent(oldRun)).toBe(false);
  });
});
