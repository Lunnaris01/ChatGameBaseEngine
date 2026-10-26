// Entry point, referenced by src/index.html and src/about.html.
//
//   1. find the story files          (engine/discover.ts)
//   2. turn them into engine objects (engine/story.ts, with readable errors)
//   3. run the app                   (engine/app.ts)
//
// Nothing here, and nothing in this folder, needs to change to write a story —
// see src/story/README.md.

import "../style.css";
import { startApp } from "./app";
import { discoverStory, type StoryFiles } from "./discover";
import { buildStory } from "./story";
import { applyTranslations } from "./i18n";
import { registerOfflineSupport } from "./pwa";

registerOfflineSupport();

window.addEventListener("error", (event) => {
  console.error("Runtime error:", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isStoryFiles(value: unknown): value is StoryFiles {
  return (
    isRecord(value) &&
    isRecord(value.characters) &&
    isRecord(value.places) &&
    isRecord(value.assets) &&
    Object.values(value.assets).every((item) => typeof item === "string") &&
    isRecord(value.sounds) &&
    Object.values(value.sounds).every((item) => typeof item === "string")
  );
}

type StudioPreview = StoryFiles & { themeCss?: string };
function isStudioPreview(value: unknown): value is StudioPreview {
  return isStoryFiles(value) && (!("themeCss" in value) || typeof value.themeCss === "string");
}

const bundled = discoverStory();
let files = bundled;
let previewTheme = "";
if (new URLSearchParams(window.location.search).has("studio-preview")) {
  try {
    const source = sessionStorage.getItem("sr-studio-preview");
    if (source) {
      const preview: unknown = JSON.parse(source);
      if (isStudioPreview(preview)) {
        files = preview;
        previewTheme = preview.themeCss ?? "";
      } else {
        console.warn("Story Studio preview data was not recognized; using the bundled story.");
      }
    }
  } catch {
    console.warn("Story Studio preview data could not be loaded; using the bundled story.");
  }
  window.opener = null;
}

const { characters, places, assets, sounds, soundsConfig, meta, enemies } = files as any;
const { cast, issues, story } = buildStory(characters, places, assets, meta, Object.keys(sounds), soundsConfig, enemies);

const title = story.title ?? "Your Story";
const isAboutPage = window.location.pathname.endsWith("/about.html");
document.documentElement.lang = story.lang ?? "en";
document.title = isAboutPage ? `How to play — ${title}` : title;
const heading = document.querySelector("h1");
if (heading && !isAboutPage) heading.textContent = title;
if (!isAboutPage && story.description) {
  document.querySelector('meta[name="description"]')?.setAttribute("content", story.description);
}
const storyTitle = document.getElementById("story-title");
if (storyTitle) storyTitle.textContent = title;
if (previewTheme) {
  const theme = /@theme\s*\{([^}]*)\}/s.exec(previewTheme)?.[1] ?? "";
  for (const match of theme.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2].trim();
    if (/^--(?:color-|font-|text-)/.test(name) && !/[{};]/.test(value)) {
      document.documentElement.style.setProperty(name, value);
    }
  }
}
applyTranslations(document, story.ui);

startApp(cast, issues, story, { files: sounds, config: soundsConfig });
