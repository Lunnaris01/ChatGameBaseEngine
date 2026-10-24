// Command-line story checker: `bun run check` runs this after the typecheck.
//
// It reads src/story/ straight from disk (no browser, no build) and reuses
// src/engine/story.ts, so the terminal output is exactly what the app shows in
// its story-problem banner.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildStory, type Issue } from "../src/engine/story";

const storyDir = fileURLToPath(new URL("../src/story", import.meta.url));
const charactersDir = join(storyDir, "characters");
const locationsDir = join(storyDir, "locations");
const assetsDir = join(storyDir, "assets");
const metaFile = join(storyDir, "story.json");
const soundConfigFile = join(assetsDir, "sounds", "sounds.json");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const jsonFiles = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

/** Character files are nested one folder per character, keyed by their path. */
const characterJsonFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".json")) found.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return found.sort();
};

/** Every sound file under assets/sounds/, by path. */
const soundFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...soundFiles(full));
    else if (/\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(entry.name)) found.push(full);
  }
  return found;
};

/** Every picture under assets/, including chapter subfolders (found by path). */
const pictureFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pictureFiles(full));
    else if (/\.(svg|png|jpe?g|webp|gif|avif)$/i.test(entry.name)) found.push(full);
  }
  return found;
};

const problems: Issue[] = [];

const characters: Record<string, unknown> = {};
for (const file of characterJsonFiles(charactersDir)) {
  try {
    characters[file] = readJson(join(charactersDir, file));
  } catch (error) {
    problems.push({
      file,
      where: file,
      level: "error",
      message: `this file is not valid JSON — ${(error as Error).message}`,
    });
  }
}

const places: Record<string, unknown> = {};
for (const file of jsonFiles(locationsDir)) {
  try {
    places[file] = readJson(join(locationsDir, file));
  } catch (error) {
    problems.push({
      file,
      where: file,
      level: "error",
      message: `this file is not valid JSON — ${(error as Error).message}`,
    });
  }
}

// Picture name = path inside assets/ without the extension, folders included.
const pictures = pictureFiles(assetsDir);
const assets: Record<string, string> = Object.fromEntries(
  pictures.map((path) => [
    relative(assetsDir, path).replace(/\.[^.]+$/, "").split(sep).join("/"),
    path,
  ]),
);

for (const path of pictures) {
  const bytes = statSync(path).size;
  if (bytes > 1_500_000) {
    problems.push({
      file: relative(storyDir, path).split(sep).join("/"),
      where: "asset",
      level: "warning",
      message: `this image is ${(bytes / 1_000_000).toFixed(1)} MB — optimize large phone images to keep the initial download small`,
    });
  }
}

// Sound name = path inside assets/ without the extension, e.g. "sounds/ding".
const sounds = soundFiles(join(assetsDir, "sounds")).map((path) =>
  relative(assetsDir, path).replace(/\.[^.]+$/, "").split(sep).join("/"),
);

let meta: unknown;
if (existsSync(metaFile)) {
  try {
    meta = readJson(metaFile);
  } catch (error) {
    problems.push({
      file: "story.json",
      where: "story.json",
      level: "error",
      message: `this file is not valid JSON — ${(error as Error).message}`,
    });
  }
}

let soundConfig: unknown;
if (existsSync(soundConfigFile)) {
  try {
    soundConfig = readJson(soundConfigFile);
  } catch (error) {
    problems.push({
      file: "assets/sounds/sounds.json",
      where: "assets/sounds/sounds.json",
      level: "error",
      message: `this file is not valid JSON — ${(error as Error).message}`,
    });
  }
}

const { issues, cast, balance, placeBalance } = buildStory(characters, places, assets, meta, sounds, soundConfig);
const all = [...problems, ...issues];
const errors = all.filter((i) => i.level === "error");
const warnings = all.filter((i) => i.level === "warning");

const line = (i: Issue): string =>
  `  ${i.file}${i.where && i.where !== i.file ? ` → ${i.where}` : ""}\n    ${i.message}`;

for (const [label, list] of [
  ["errors", errors],
  ["warnings", warnings],
] as const) {
  if (list.length === 0) continue;
  console.log(`\n${list.length} story ${label}:\n${list.map(line).join("\n")}`);
}

if (errors.length > 0) {
  console.log("\nFix these in src/story/ — the app refuses to load broken characters.\n");
  process.exit(1);
}

const names = cast.order.map((id) => cast.contacts[id].name);
const placeNames = cast.placeOrder.map((id) => cast.places[id].name);
const summary = `${names.length} character(s)${placeNames.length > 0 ? `, ${placeNames.length} place(s)` : ""}`;
console.log(warnings.length > 0 ? `\nstory ok (${warnings.length} warning) — ${summary}\n` : "");
if (warnings.length === 0) {
  console.log(
    names.length > 0
      ? `story ok — ${summary}: ${names.join(", ")}${placeNames.length > 0 ? ` · ${placeNames.join(", ")}` : ""}`
      : `story ok — no characters yet (add a file to src/story/characters/)`,
  );
}

// An indicative speaker split from one scripted pass; this is diagnostic
// context, not a quality threshold.
const pct = (share: number): string => `${Math.round(share * 100)}%`;
const splits = cast.order
  .map((id) => ({ name: cast.contacts[id].name, talk: balance[id] }))
  .filter((c) => c.talk && c.talk.them + c.talk.me > 0)
  .map((c) => {
    const total = c.talk.them + c.talk.me;
    return `${c.name} ${pct(c.talk.them / total)} character / ${pct(c.talk.me / total)} player`;
  });
if (splits.length > 0) {
  console.log(`conversation split (character / player): ${splits.join(" · ")}`);
}

const placeSplits: string[] = [];
for (const placeId of cast.placeOrder) {
  const place = cast.places[placeId];
  for (const chat of place.chats) {
    const talk = placeBalance[`${placeId}/${chat.id}`];
    if (!talk || talk.them + talk.me === 0) continue;
    const total = talk.them + talk.me;
    placeSplits.push(`${place.name} · ${chat.title} ${pct(talk.them / total)} room / ${pct(talk.me / total)} player`);
  }
}
if (placeSplits.length > 0) {
  console.log(`place conversation split (room / player): ${placeSplits.join(" · ")}`);
}
