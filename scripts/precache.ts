import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const workerPath = join(dist, "sw.js");
const sourceStory = JSON.parse(readFileSync(new URL("../src/story/story.json", import.meta.url), "utf8")) as Record<string, unknown>;
const manifestPath = join(dist, "manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
if (typeof sourceStory.title === "string" && sourceStory.title.trim()) {
  manifest.name = sourceStory.title;
  manifest.short_name = sourceStory.title.length <= 12 ? sourceStory.title : `${sourceStory.title.slice(0, 11).trimEnd()}…`;
}
if (typeof sourceStory.description === "string" && sourceStory.description.trim()) {
  manifest.description = sourceStory.description;
}
if (typeof sourceStory.lang === "string" && sourceStory.lang.trim()) {
  manifest.lang = sourceStory.lang;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const files: string[] = [];
const versionFiles: string[] = [];

const walk = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (!entry.name.endsWith(".map") && entry.name !== "precache-manifest.json") {
      const relativePath = relative(dist, path).split(sep).join("/");
      files.push(`./${relativePath}`);
      if (relativePath !== "sw.js") versionFiles.push(path);
    }
  }
};

walk(dist);
files.sort();
versionFiles.sort();
const hash = createHash("sha256");
for (const path of versionFiles) {
  hash.update(relative(dist, path).split(sep).join("/")).update(readFileSync(path));
}
const version = hash.digest("hex").slice(0, 12);
const worker = readFileSync(workerPath, "utf8").replace(
  'const CACHE_NAME = "chat-story-static-v1";',
  `const CACHE_NAME = "chat-story-${version}";`,
);
writeFileSync(workerPath, worker);
writeFileSync(join(dist, "precache-manifest.json"), JSON.stringify({ version, files }, null, 2) + "\n");
console.log(`wrote dist/precache-manifest.json (${files.length} local files)`);
