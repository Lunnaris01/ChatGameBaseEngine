import "../style.css";

import { discoverStory, type StoryFiles } from "./discover";
import { buildStory, type Issue } from "./story";
import type { Cast, Step } from "./types";
import bundledTheme from "../story/theme.css?raw";
import { registerOfflineSupport } from "./pwa";
import { requireElement, maybeElement } from "./dom";

registerOfflineSupport();

const folderInput = requireElement<HTMLInputElement>("folder-input");
const bundledLoad = requireElement<HTMLButtonElement>("bundled-load");
const fileSelect = requireElement<HTMLSelectElement>("file-select");
const editor = requireElement<HTMLTextAreaElement>("json-editor");
const downloadButton = requireElement<HTMLButtonElement>("download-file");
const studioStatus = requireElement<HTMLElement>("studio-status");
const validationSummary = requireElement<HTMLElement>("validation-summary");
const validationIssues = requireElement<HTMLUListElement>("validation-issues");
const flowMap = requireElement<HTMLElement>("flow-map");
const previewButton = requireElement<HTMLAnchorElement>("preview-story");
const previewStatus = requireElement<HTMLElement>("preview-status");

type Project = StoryFiles & { documents: Map<string, string>; urls: string[]; themeCss: string };
let project: Project = { characters: {}, places: {}, assets: {}, sounds: {}, documents: new Map(), urls: [], themeCss: "" };
let selectedPath = "";
let validationFrame = 0;

function clearProject(): void {
  for (const url of project.urls) URL.revokeObjectURL(url);
  project = { characters: {}, places: {}, assets: {}, sounds: {}, documents: new Map(), urls: [], themeCss: "" };
  selectedPath = "";
}

function registerDocument(path: string, text: string): void {
  project.documents.set(path, text);
}

function loadBundled(): void {
  clearProject();
  const bundled = discoverStory();
  project = { ...bundled, documents: new Map(), urls: [], themeCss: bundledTheme };
  for (const [path, value] of Object.entries(bundled.characters)) {
    registerDocument(`characters/${path}`, JSON.stringify(value, null, 2));
  }
  for (const [path, value] of Object.entries(bundled.places)) {
    registerDocument(`locations/${path}`, JSON.stringify(value, null, 2));
  }
  for (const [path, value] of Object.entries(bundled.enemies ?? {})) {
    registerDocument(`locations/forest/enemies/${path}.json`, JSON.stringify(value, null, 2));
  }
  if (bundled.meta !== undefined) registerDocument("story.json", JSON.stringify(bundled.meta, null, 2));
  if (bundled.soundsConfig !== undefined) {
    registerDocument("assets/sounds/sounds.json", JSON.stringify(bundled.soundsConfig, null, 2));
  }
  registerDocument("theme.css", bundledTheme);
  studioStatus.textContent = "Bundled story loaded. JSON edits remain in this tab until downloaded.";
  renderDocuments();
  validate();
}

function renderDocuments(): void {
  const paths = [...project.documents.keys()].sort();
  fileSelect.replaceChildren();
  for (const path of paths) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = path;
    fileSelect.appendChild(option);
  }
  selectedPath = paths[0] ?? "";
  fileSelect.value = selectedPath;
  editor.value = selectedPath ? (project.documents.get(selectedPath) ?? "") : "";
  editor.disabled = !selectedPath;
  downloadButton.disabled = !selectedPath;
}

function pathFor(file: File): string | null {
  const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
  const root = parts.findIndex((part) => ["characters", "locations", "assets", "story.json", "theme.css"].includes(part));
  return root < 0 ? null : parts.slice(root).join("/");
}

async function loadFolder(files: FileList | null): Promise<void> {
  if (!files?.length) return;
  clearProject();
  const entries = Array.from(files).flatMap((file) => {
    const path = pathFor(file);
    return path ? [{ file, path }] : [];
  });
  if (entries.length === 0) {
    studioStatus.textContent = "No story folders found. Select the src/story folder itself.";
    renderDocuments();
    validate();
    return;
  }

  const jsonReads = entries
    .filter(({ path }) => path.endsWith(".json"))
    .map(async ({ file, path }) => registerDocument(path, await file.text()));
  await Promise.all(jsonReads);
  const themeFile = entries.find(({ path }) => path === "theme.css");
  if (themeFile) {
    project.themeCss = await themeFile.file.text();
    registerDocument("theme.css", project.themeCss);
  }

  for (const { file, path } of entries) {
    if (!path.startsWith("assets/")) continue;
    const relativeAsset = path.slice("assets/".length);
    const image = /\.(svg|png|jpe?g|webp|gif|avif)$/i.test(relativeAsset);
    const sound = /^sounds\//.test(relativeAsset) && /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i.test(relativeAsset);
    if (!image && !sound) continue;
    const url = URL.createObjectURL(file);
    project.urls.push(url);
    const name = relativeAsset.replace(/\.[^.]+$/, "");
    if (image) project.assets[name] = url;
    else project.sounds[name] = url;
  }

  studioStatus.textContent = `Loaded ${entries.length} files. Select a JSON file, edit it, then download it back into the matching project folder.`;
  renderDocuments();
  validate();
}

function createFiles(): { files: StoryFiles; issues: Issue[] } {
  const characters: Record<string, unknown> = {};
  const places: Record<string, unknown> = {};
  const enemies: Record<string, unknown> = {};
  const issues: Issue[] = [];
  let meta: unknown;
  let soundsConfig: unknown;

  for (const [path, source] of project.documents) {
    if (path === "theme.css") continue;
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      issues.push({
        file: path,
        where: path,
        level: "error",
        message: `invalid JSON — ${(error as Error).message}`,
      });
      continue;
    }
    if (path === "story.json") meta = value;
    else if (path === "assets/sounds/sounds.json") soundsConfig = value;
    else if (path.startsWith("characters/")) characters[path.slice("characters/".length)] = value;
    else if (path.startsWith("locations/") && path.includes("/enemies/")) enemies[path.split("/").pop() ?? path] = value;
    else if (path.startsWith("locations/")) places[path.slice("locations/".length)] = value;
  }

  const files: StoryFiles = {
    characters,
    places,
    enemies,
    assets: project.assets,
    sounds: project.sounds,
    meta,
    soundsConfig,
  };
  return { files, issues };
}

function validate(): { files: StoryFiles; errors: Issue[] } {
  const { files, issues: jsonIssues } = createFiles();
  const result = buildStory(
    files.characters,
    files.places,
    files.assets,
    files.meta,
    Object.keys(files.sounds),
    files.soundsConfig,
    files.enemies,
  );
  renderFlow(result.cast);
  const issues = [...jsonIssues, ...result.issues];
  if (Object.keys(files.characters).length === 0) {
    issues.unshift({ file: "characters/", where: "", level: "error", message: "load at least one character profile and chapter" });
  }
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  validationSummary.textContent = errors.length === 0
    ? warnings.length === 0
      ? "Story files are valid."
      : `Story files are valid with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`
    : `${errors.length} error${errors.length === 1 ? "" : "s"} and ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`;
  validationIssues.replaceChildren();
  for (const issue of issues) {
    const row = document.createElement("li");
    row.className = "rounded-xl border border-chat-700 bg-chat-950 p-3";
    const level = document.createElement("strong");
    level.className = issue.level === "error" ? "text-red-300" : "text-gold-300";
    level.textContent = issue.level;
    const detail = document.createElement("span");
    detail.className = "ml-2 text-ink-100";
    detail.textContent = `${issue.file}${issue.where && issue.where !== issue.file ? ` → ${issue.where}` : ""}: ${issue.message}`;
    row.append(level, detail);
    validationIssues.appendChild(row);
  }
  previewButton.setAttribute("aria-disabled", String(errors.length > 0));
  return { files, errors };
}

function renderFlow(cast: Cast): void {
  flowMap.replaceChildren();
  if (cast.order.length === 0) {
    flowMap.textContent = "No playable character routes are available yet.";
    return;
  }

  const appendSteps = (list: HTMLOListElement | HTMLUListElement, steps: Step[]): void => {
    for (const step of steps) {
      const row = document.createElement("li");
      row.className = "rounded-lg border border-chat-700 bg-chat-950 px-3 py-2";
      if (step.t === "chapter") row.textContent = `Chapter ${step.number}${step.text ? ` · ${step.text}` : ""}`;
      else if (step.t === "choice") {
        row.textContent = `Choice · ${step.opts.length} replies`;
        const options = document.createElement("ul");
        options.className = "mt-2 space-y-2 border-l border-chat-700 pl-3";
        for (const option of step.opts) {
          const choice = document.createElement("li");
          choice.className = "text-ink-300";
          const label = document.createElement("p");
          label.className = "font-semibold text-ink-100";
          label.textContent = `${option.label}${option.requires ? " · gated" : ""}`;
          choice.appendChild(label);
          if (option.then.length > 0) {
            const nested = document.createElement("ol");
            nested.className = "mt-1 space-y-1 border-l border-chat-700 pl-3";
            appendSteps(nested, option.then);
            choice.appendChild(nested);
          }
          options.appendChild(choice);
        }
        row.appendChild(options);
      } else if (step.t === "gate") {
        row.textContent = "Stat branch · success / alternate";
        const branches = document.createElement("ul");
        branches.className = "mt-2 grid gap-2 sm:grid-cols-2";
        for (const [label, nestedSteps] of [["Pass", step.then], ["Otherwise", step.otherwise ?? []]] as const) {
          const branch = document.createElement("li");
          branch.className = "text-ink-300";
          branch.textContent = label;
          const nested = document.createElement("ol");
          nested.className = "mt-1 space-y-1 border-l border-chat-700 pl-3";
          appendSteps(nested, nestedSteps);
          branch.appendChild(nested);
          branches.appendChild(branch);
        }
        row.appendChild(branches);
      } else if (step.t === "if") {
        row.textContent = `Remembered-value condition · ${step.key}`;
        if (step.then.length > 0) {
          const nested = document.createElement("ol");
          nested.className = "mt-2 space-y-1 border-l border-chat-700 pl-3";
          appendSteps(nested, step.then);
          row.appendChild(nested);
        }
      } else if (step.t === "quiz") row.textContent = `Quiz · ${step.questions.length} question${step.questions.length === 1 ? "" : "s"}`;
      else if (step.t === "append") row.textContent = `Append ${step.steps.length} step${step.steps.length === 1 ? "" : "s"} to ${step.chat}`;
      else if (step.t === "ending") row.textContent = `Ending marker · ${step.kind}`;
      else if (step.t === "msg") row.textContent = step.from === "me" ? "Scripted player message" : "Character message";
      else if (step.t === "img") row.textContent = "Photo";
      else if (step.t === "ask") row.textContent = `Typed reply · ${step.key}`;
      else row.textContent = `Engine step · ${step.t}`;
      list.appendChild(row);
    }
  };

  for (const id of cast.order) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.className = "font-bold text-tick-400";
    heading.textContent = cast.contacts[id].name;
    const outline = document.createElement("ol");
    outline.className = "mt-2 space-y-2";
    appendSteps(outline, cast.contacts[id].script);
    section.append(heading, outline);
    flowMap.appendChild(section);
  }
  for (const placeId of cast.placeOrder) {
    const place = cast.places[placeId];
    for (const chat of place.chats) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.className = "font-bold text-tick-400";
      heading.textContent = `${place.name} · ${chat.title}`;
      const outline = document.createElement("ol");
      outline.className = "mt-2 space-y-2";
      appendSteps(outline, chat.script);
      section.append(heading, outline);
      flowMap.appendChild(section);
    }
  }
}

function updateSelectedDocument(): void {
  selectedPath = fileSelect.value;
  editor.value = project.documents.get(selectedPath) ?? "";
  downloadButton.disabled = !selectedPath;
  validate();
}

fileSelect.addEventListener("change", updateSelectedDocument);
editor.addEventListener("input", () => {
  if (!selectedPath) return;
  project.documents.set(selectedPath, editor.value);
  if (selectedPath === "theme.css") project.themeCss = editor.value;
  if (validationFrame) cancelAnimationFrame(validationFrame);
  validationFrame = requestAnimationFrame(() => {
    validationFrame = 0;
    validate();
  });
});

downloadButton.addEventListener("click", () => {
  if (!selectedPath) return;
  const json = selectedPath.endsWith(".json");
  const content = editor.value.endsWith("\n") ? editor.value : `${editor.value}\n`;
  const blob = new Blob([content], { type: json ? "application/json" : "text/css" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = selectedPath.replaceAll("/", "__");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  studioStatus.textContent = `Downloaded ${selectedPath}. Move it to that path in your story folder.`;
});

folderInput.addEventListener("change", () => {
  void loadFolder(folderInput.files).catch((error: unknown) => {
    studioStatus.textContent = `Could not read the selected folder: ${error instanceof Error ? error.message : "unknown error"}`;
    renderDocuments();
    validate();
  });
});
bundledLoad.addEventListener("click", loadBundled);

previewButton.addEventListener("click", (event) => {
  if (previewButton.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
    return;
  }
  const { files, errors } = validate();
  if (errors.length > 0) {
    event.preventDefault();
    return;
  }
  try {
    sessionStorage.setItem("sr-studio-preview", JSON.stringify({ ...files, themeCss: project.themeCss }));
  } catch {
    event.preventDefault();
    previewStatus.textContent = "This browser blocked the temporary preview data. Allow session storage and try again.";
    return;
  }
  previewStatus.textContent = "Preview opened in a separate tab. This preview has isolated progress.";
});

loadBundled();
