import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { buildStory } from "../src/engine/story";
import { matchesIfCondition, type Step } from "../src/engine/types";
import { makeBackup, parseBackup } from "../src/engine/backup";

const root = join(import.meta.dir, "../src/story");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function walkFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(dir);
  return found;
}

function loadStory() {
  const characters: Record<string, unknown> = {};
  for (const path of walkFiles(join(root, "characters")).filter((file) => file.endsWith(".json"))) {
    characters[relative(join(root, "characters"), path).split(sep).join("/")] = readJson(path);
  }

  const places: Record<string, unknown> = {};
  for (const path of walkFiles(join(root, "locations")).filter((file) => file.endsWith(".json") && !file.includes(`${sep}enemies${sep}`))) {
    places[path.split(sep).pop() ?? path] = readJson(path);
  }

  const enemies: Record<string, unknown> = {};
  for (const path of walkFiles(join(root, "locations")).filter((file) => file.endsWith(".json") && file.includes(`${sep}enemies${sep}`))) {
    enemies[path.split(sep).pop() ?? path] = readJson(path);
  }

  const assetsDir = join(root, "assets");
  const pictures: Record<string, string> = {};
  const sounds: string[] = [];
  for (const path of walkFiles(assetsDir)) {
    const name = relative(assetsDir, path).replace(/\.[^.]+$/, "").split(sep).join("/");
    if (/\.(svg|png|jpe?g|webp|gif|avif)$/i.test(path)) pictures[name] = path;
    if (/\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(path)) sounds.push(name);
  }

  return buildStory(
    characters,
    places,
    pictures,
    readJson(join(root, "story.json")),
    sounds,
    undefined,
    enemies,
  );
}

function nestedTypes(steps: Step[], found = new Set<string>()): Set<string> {
  for (const step of steps) {
    found.add(step.t);
    if (step.t === "choice") for (const option of step.opts) nestedTypes(option.then, found);
    else if (step.t === "if" || step.t === "gate") {
      nestedTypes(step.then, found);
      if (step.t === "gate" && step.otherwise) nestedTypes(step.otherwise, found);
    } else if (step.t === "quiz") nestedTypes(step.pass, found);
    else if (step.t === "append") nestedTypes(step.steps, found);
  }
  return found;
}

describe("sample story", () => {
  test("validates the fantasy starter story", () => {
    const { cast, issues } = loadStory();
    const errors = issues.filter((issue) => issue.level === "error");

    expect(errors).toEqual([]);
    expect(cast.contacts.tutorial).toBeDefined();
    expect(cast.contacts.receptionist).toBeDefined();
    expect(cast.order).toEqual(["tutorial", "receptionist"]);
    expect(cast.contacts.tutorial.startUnlocked).toBe(true);
    expect(cast.contacts.receptionist.startUnlocked).toBe(false);
    expect(cast.places.forest).toBeDefined();
    expect(cast.enemies["goblin-spy"]).toBeDefined();
    expect(cast.placeOrder).toEqual(["forest"]);
    expect(cast.places.forest.chats).toHaveLength(1);
  });

  test("the starter story validates", () => {
    const { issues } = loadStory();
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  test("starter route unlocks receptionist then forest and includes combat", () => {
    const { cast } = loadStory();
    const tutorialSteps = JSON.stringify(cast.contacts.tutorial.script);
    expect(tutorialSteps).toContain('"t":"unlock","chat":"receptionist"');
    const receptionistSteps = JSON.stringify(cast.contacts.receptionist.script);
    expect(receptionistSteps).toContain('"t":"unlockPlace"');
    expect(receptionistSteps).toContain('"place":"forest"');
    const forestSteps = JSON.stringify(cast.places.forest.chats[0].script);
    expect(forestSteps).toContain('"t":"combat"');
    expect(cast.enemies["goblin-spy"]).toBeDefined();
  });

  test("the forest scene validates", () => {
    const { cast, issues } = loadStory();
    const errors = issues.filter((issue) => issue.level === "error");
    expect(errors).toEqual([]);
    const scene = cast.places.forest.chats[0];
    expect(scene).toBeDefined();
  });

  test("the bundled character and Place queues fit the local backup schema", () => {
    const { cast } = loadStory();
    const data = {
      "sr-chat-tutorial": JSON.stringify({
        transcript: [],
        queue: cast.contacts.tutorial.script,
        state: {},
        stats: cast.contacts.tutorial.data.stats,
      }),
      "sr-place-forest-arrive": JSON.stringify({
        transcript: [],
        queue: cast.places.forest.chats[0].script,
        state: {},
        stats: cast.places.forest.chats[0].data.stats,
        unlocked: true,
        visited: true,
      }),
    };
    const parsed = parseBackup(JSON.stringify(makeBackup(data, "A Map to Somewhere")));
    expect("backup" in parsed).toBe(true);
  });

  test("automatically places assets under misc/ in the General Gallery folder", () => {
    const result = buildStory(
      {
        "mai/mai.json": { name: "Mai" },
        "mai/chapter1.json": [
          { type: "chapter", number: 1, text: "", time: "", at: "14:00" },
          { type: "photo", name: "misc/sunset", alt: "A sunset over distant hills" },
          { type: "chapter-end" },
        ],
      },
      {},
      { "misc/sunset": "/assets/sunset.png" },
    );

    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.cast.gallery.find((category) => category.id === "misc")?.images.some((image) => image.name === "misc/sunset")).toBe(true);
  });
});

describe("remembered-value conditions", () => {
  test("missing values only match not/none conditions", () => {
    expect(matchesIfCondition({ t: "if", key: "plan", is: "tea", then: [] }, undefined)).toBe(false);
    expect(matchesIfCondition({ t: "if", key: "plan", not: "tea", then: [] }, undefined)).toBe(true);
    expect(matchesIfCondition({ t: "if", key: "plan", none: ["tea", "coffee"], then: [] }, undefined)).toBe(true);
  });

  test("rejects a waitSeconds gate that has no milestone to time", () => {
    const { issues } = buildStory(
      {
        "mai/mai.json": { name: "Mai" },
        "mai/chapter1.json": [
          { type: "chapter", number: 1, text: "", time: "", at: "14:00" },
          {
            type: "choice",
            options: [
              { label: "Wait", needs: { waitSeconds: 3, hint: "Wait first." }, then: [] },
              { label: "Continue", then: [] },
            ],
          },
        ],
      },
      {},
      {},
    );

    expect(issues.some((issue) => issue.level === "error" && issue.message.includes("requires \"needs.milestone\""))).toBe(true);
  });

  test("warns when a gated reply names a milestone that no route declares", () => {
    const { issues } = buildStory(
      {
        "mai/mai.json": { name: "Mai" },
        "mai/chapter1.json": [
          { type: "chapter", number: 1, text: "", time: "", at: "14:00" },
          {
            type: "choice",
            options: [
              { label: "Locked", needs: { milestone: "never-set", hint: "Not yet." }, then: [] },
              { label: "Continue", then: [] },
            ],
          },
          { type: "chapter-end" },
        ],
      },
      {},
      {},
    );

    expect(issues.some((issue) => issue.level === "warning" && issue.message.includes("no milestone \"never-set\""))).toBe(true);
  });

  test("rejects invalid sound levels and event values", () => {
    const { issues } = buildStory({}, {}, {}, undefined, [], {
      volume: 1.5,
      events: { them: 42 },
    });

    expect(issues.some((issue) => issue.level === "error" && issue.message.includes("volume must be a number from 0 to 1"))).toBe(true);
    expect(issues.some((issue) => issue.level === "error" && issue.message.includes("sound must be a built-in voice"))).toBe(true);
  });

  test("preserves explicit message-delay overrides and rejects invalid values", () => {
    const result = buildStory(
      {
        "mai/mai.json": { name: "Mai" },
        "mai/chapter1.json": [
          { type: "chapter", number: 1, text: "", time: "", at: "14:00" },
          { type: "them", text: "A deliberate pause.", typing: 0, pause: 900 },
          { type: "me", text: "I needed a moment.", pause: 700 },
          { type: "chapter-end" },
        ],
      },
      {},
      {},
    );
    const errors = result.issues.filter((issue) => issue.level === "error");

    expect(errors).toEqual([]);
    const explicitPause = result.cast.contacts.mai.script.find((step) => step.t === "msg" && step.from === "me");
    expect(explicitPause?.t === "msg" ? explicitPause.pause : undefined).toBe(700);

    const invalid = buildStory(
      {
        "mai/mai.json": { name: "Mai" },
        "mai/chapter1.json": [
          { type: "chapter", number: 1, text: "", time: "", at: "14:00" },
          { type: "me", text: "Too fast.", pause: -1 },
          { type: "chapter-end" },
        ],
      },
      {},
      {},
    );
    expect(invalid.issues.some((issue) => issue.level === "error" && issue.message.includes("milliseconds from 0 to 60000"))).toBe(true);
  });

  test("requires exactly one remembered-value comparison in a gate", () => {
    const { issues } = buildStory(
      {
        "mai/mai.json": { name: "Mai" },
        "mai/chapter1.json": [
          { type: "chapter", number: 1, text: "", time: "", at: "14:00" },
          {
            type: "choice",
            options: [
              { label: "Ambiguous", needs: { key: "plan", is: "park", not: "museum", hint: "Choose a plan." }, then: [] },
              { label: "Continue", then: [] },
            ],
          },
          { type: "chapter-end" },
        ],
      },
      {},
      {},
    );

    expect(issues.some((issue) => issue.level === "error" && issue.message.includes("exactly one of \"needs.is\" or \"needs.not\""))).toBe(true);
  });
});
