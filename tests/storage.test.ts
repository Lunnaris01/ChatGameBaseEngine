import { describe, expect, test } from "bun:test";

import { makeBackup, parseBackup } from "../src/engine/backup";
import { createGameStorage, createMemoryStorage } from "../src/engine/storage";

describe("game storage", () => {
  test("clears only game-owned keys and keeps other site data", () => {
    const backing = createMemoryStorage();
    backing.setItem("unrelated", "keep me");
    backing.setItem("sr-chat-mai", "{}");
    backing.setItem("sr-studio-preview", "{} ");
    const storage = createGameStorage(backing);

    storage.clear();

    expect(backing.getItem("unrelated")).toBe("keep me");
    expect(backing.getItem("sr-chat-mai")).toBeNull();
    expect(backing.getItem("sr-studio-preview")).toBe("{} ");
  });

  test("preview data uses an isolated namespace", () => {
    const backing = createMemoryStorage();
    backing.setItem("sr-chat-mai", "real");
    const preview = createGameStorage(backing, "sr-studio-game:");
    preview.setItem("sr-chat-mai", "preview");

    expect(preview.getItem("sr-chat-mai")).toBe("preview");
    expect(backing.getItem("sr-chat-mai")).toBe("real");
  });
});

describe("local backups", () => {
  test("round-trips only supported app data", () => {
    const data = {
      "sr-chat-mai": JSON.stringify({ transcript: [], queue: [], state: {}, stats: {} }),
      "sr-text-speed": "quick",
      unrelated: "must not be included",
    };
    const backup = makeBackup(data, "Mai's Test", new Date("2026-10-24T12:00:00.000Z"));
    const parsed = parseBackup(JSON.stringify(backup));

    expect("backup" in parsed).toBe(true);
    if ("backup" in parsed) {
      expect(parsed.backup.story).toBe("Mai's Test");
      expect(parsed.backup.data.unrelated).toBeUndefined();
      expect(parsed.backup.data["sr-chat-mai"]).toBe(data["sr-chat-mai"]);
    }
  });

  test("rejects malformed or unsupported progress before import", () => {
    const invalid = {
      format: "chat-story-local-backup",
      version: 1,
      exportedAt: "2026-10-24T12:00:00.000Z",
      story: "Sample",
      data: { "sr-chat-mai": "not json" },
    };
    const parsed = parseBackup(JSON.stringify(invalid));

    expect("error" in parsed).toBe(true);
  });

  test("rejects a backup queue that could crash a story step", () => {
    const invalid = {
      format: "chat-story-local-backup",
      version: 1,
      exportedAt: "2026-10-24T12:00:00.000Z",
      story: "Sample",
      data: {
        "sr-chat-mai": JSON.stringify({ transcript: [], queue: [{ t: "img" }], state: {}, stats: {} }),
      },
    };

    expect("error" in parseBackup(JSON.stringify(invalid))).toBe(true);
  });
});
