// Finds the story files at build time.
//
// Vite resolves these globs when the app is bundled, so dropping a file into a
// character folder or anywhere under src/story/assets/ is all it takes to add
// content — and deleting the file is all it takes to remove it. There is no
// registration list anywhere.

export type StoryFiles = {
  /** Path inside characters/ (e.g. `alex/chapter1.json`) -> parsed JSON. */
  characters: Record<string, unknown>;
  /** File name (e.g. `cafe.json`) -> parsed JSON. */
  places: Record<string, unknown>;
  /** Path inside assets/ without extension (e.g. `alex/chapter1/photo`) -> bundled URL. */
  assets: Record<string, string>;
  /** Path inside assets/sounds/ without extension (e.g. `them_chime`) -> bundled URL. */
  sounds: Record<string, string>;
  /** Parsed src/story/assets/sounds/sounds.json, if that file exists. */
  soundsConfig?: unknown;
  /** Parsed src/story/story.json, if that file exists. */
  meta?: unknown;
};

const CHARACTER_ROOT = "../story/characters/";
const ASSET_ROOT = "../story/assets/";
const baseName = (path: string): string => path.split("/").pop() ?? path;
const assetName = (path: string): string =>
  path.replace(ASSET_ROOT, "").replace(/\.[^.]+$/, "");
const characterName = (path: string): string =>
  path.replace(CHARACTER_ROOT, "").split("\\").join("/");

export function discoverStory(): StoryFiles {
  const characterFiles = import.meta.glob("../story/characters/**/*.json", {
    eager: true,
    import: "default",
  }) as Record<string, unknown>;

  const placeFiles = import.meta.glob("../story/locations/*.json", {
    eager: true,
    import: "default",
  }) as Record<string, unknown>;

  const assetFiles = import.meta.glob("../story/assets/**/*.{svg,png,jpg,jpeg,webp,gif,avif}", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>;

  // Sound files live in their own folder under assets/, so the picture glob
  // never sees them. The config that maps events to files sits beside them.
  const soundFiles = import.meta.glob("../story/assets/sounds/**/*.{mp3,ogg,wav,m4a,aac,flac,opus}", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>;

  const soundConfigFiles = import.meta.glob("../story/assets/sounds/sounds.json", {
    eager: true,
    import: "default",
  }) as Record<string, unknown>;

  const metaFiles = import.meta.glob("../story/story.json", {
    eager: true,
    import: "default",
  }) as Record<string, unknown>;

  const characters: Record<string, unknown> = {};
  for (const [path, data] of Object.entries(characterFiles)) characters[characterName(path)] = data;

  const places: Record<string, unknown> = {};
  for (const [path, data] of Object.entries(placeFiles)) places[baseName(path)] = data;

  const assets: Record<string, string> = {};
  for (const [path, url] of Object.entries(assetFiles)) {
    assets[assetName(path)] = url;
  }

  const sounds: Record<string, string> = {};
  for (const [path, url] of Object.entries(soundFiles)) {
    sounds[path.replace(ASSET_ROOT, "").replace(/\.[^.]+$/, "")] = url;
  }

  return {
    characters,
    places,
    assets,
    sounds,
    soundsConfig: Object.values(soundConfigFiles)[0],
    meta: Object.values(metaFiles)[0],
  };
}
