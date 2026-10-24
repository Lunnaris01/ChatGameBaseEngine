import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTranslator, UI_MESSAGES } from "../src/engine/i18n";
import { buildStory } from "../src/engine/story";

describe("story UI translations", () => {
  test("falls back to English and interpolates translated labels", () => {
    const translate = createTranslator({
      "chat.replyCount": "{count} Antworten verfügbar.",
    });

    expect(translate("nav.chats")).toBe(UI_MESSAGES["nav.chats"]);
    expect(translate("chat.replyCount", { count: 3 })).toBe("3 Antworten verfügbar.");
  });

  test("validates translation keys in story.json", () => {
    const { issues, story } = buildStory({}, {}, {}, {
      title: "Localized sample",
      lang: "de",
      ui: { "nav.chats": "Gespräche", "not-a-key": "ignored" },
    });

    expect(story.lang).toBe("de");
    expect(story.ui?.["nav.chats"]).toBe("Gespräche");
    expect(issues.some((issue) => issue.level === "error" && issue.message.includes("unknown interface key"))).toBe(true);
  });

  test("all static page translation hooks have a default string", () => {
    const root = join(import.meta.dir, "../src");
    for (const page of ["index.html", "about.html"]) {
      const html = readFileSync(join(root, page), "utf8");
      const keys = [...html.matchAll(/data-ui(?:-aria|-placeholder)?="([^"]+)"/g)].map((match) => match[1]);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(Object.hasOwn(UI_MESSAGES, key)).toBe(true);
    }
  });
});
