import { describe, expect, test } from "bun:test";

import { messageDelays } from "../src/engine/pacing";

describe("message-length pacing", () => {
  test("longer messages get longer typing and reply beats", () => {
    const short = messageDelays("Hi.");
    const long = messageDelays("I found the old map and thought we could follow the river together this weekend.");

    expect(long.typing).toBeGreaterThan(short.typing);
    expect(long.pause).toBeGreaterThan(short.pause);
  });

  test("delays stay sensible at empty and very long boundaries", () => {
    const empty = messageDelays("  ");
    const long = messageDelays("a ".repeat(500));

    expect(empty.typing).toBe(350);
    expect(empty.pause).toBe(180);
    expect(long.typing).toBe(3_200);
    expect(long.pause).toBe(1_200);
  });
});
