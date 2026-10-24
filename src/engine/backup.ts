import { isGameStorageKey } from "./storage";

export type GameBackup = {
  format: "chat-story-local-backup";
  version: 1;
  exportedAt: string;
  story: string;
  data: Record<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const STEP_TYPES = new Set([
  "chapter", "divider", "msg", "choice", "milestone", "ask", "presence", "rename", "unlock",
  "unlockPlace", "set", "reveal", "if", "addStats", "gate", "append", "ending", "img", "wait", "sound", "quiz",
]);
const STAT_KEYS = new Set(["trust", "feelings", "attraction", "bond"]);

function validStats(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([key, amount]) =>
    STAT_KEYS.has(key) && typeof amount === "number" && Number.isFinite(amount),
  );
}

function validSteps(value: unknown, depth = 0): boolean {
  if (!Array.isArray(value) || depth > 32) return false;
  return value.every((step) => validStep(step, depth));
}

function validStep(value: unknown, depth: number): boolean {
  if (!isRecord(value) || typeof value.t !== "string" || !STEP_TYPES.has(value.t)) return false;
  if (value.nsfw !== undefined && typeof value.nsfw !== "boolean") return false;
  const optionalText = (key: string): boolean => value[key] === undefined || typeof value[key] === "string";
  const optionalNumber = (key: string): boolean => value[key] === undefined || (typeof value[key] === "number" && Number.isFinite(value[key]));
  switch (value.t) {
    case "chapter":
      return Number.isInteger(value.number) && typeof value.text === "string" && typeof value.time === "string" && optionalNumber("at");
    case "divider":
      return typeof value.text === "string" && (value.style === "divider" || value.style === "fade") && optionalNumber("at");
    case "msg":
      return (value.from === "them" || value.from === "me" || value.from === "sys") && typeof value.text === "string" &&
        optionalText("speaker") && optionalText("time") && optionalNumber("typing") && optionalNumber("pause") &&
        optionalNumber("duration") && optionalNumber("at");
    case "choice":
      return Array.isArray(value.opts) && value.opts.every((option) =>
        isRecord(option) && typeof option.label === "string" && typeof option.say === "string" &&
        validSteps(option.then, depth + 1) && (option.effects === undefined || validStats(option.effects)) &&
        (option.requires === undefined || isRecord(option.requires)),
      );
    case "milestone":
      return typeof value.id === "string";
    case "ask":
      return typeof value.key === "string" && typeof value.placeholder === "string" &&
        (value.effects === undefined || validStats(value.effects));
    case "presence":
      return typeof value.value === "string";
    case "rename":
      return typeof value.name === "string" && typeof value.initial === "string";
    case "unlock":
      return typeof value.chat === "string";
    case "unlockPlace":
      return typeof value.place === "string" && typeof value.chat === "string";
    case "set":
      return typeof value.key === "string" && typeof value.value === "string" && optionalText("chat");
    case "reveal":
      return ["age", "birthday", "interests", "likes", "dislikes"].includes(String(value.fact)) && optionalText("value");
    case "if": {
      const conditions = ["is", "any", "not", "none"].filter((key) => value[key] !== undefined);
      return typeof value.key === "string" && conditions.length === 1 && validSteps(value.then, depth + 1) &&
        optionalText("is") && optionalText("not") &&
        (value.any === undefined || (Array.isArray(value.any) && value.any.every((item) => typeof item === "string"))) &&
        (value.none === undefined || (Array.isArray(value.none) && value.none.every((item) => typeof item === "string")));
    }
    case "addStats":
      return validStats(value.stats);
    case "gate":
      return validStats(value.min) && validSteps(value.then, depth + 1) &&
        (value.otherwise === undefined || validSteps(value.otherwise, depth + 1)) &&
        (value.any === undefined || (Array.isArray(value.any) && value.any.every(validStats)));
    case "append":
      return typeof value.chat === "string" && validSteps(value.steps, depth + 1);
    case "ending":
      return (value.kind === "pause" || value.kind === "finale" || value.kind === "wait") && optionalText("waitFor");
    case "img":
      return (value.from === "them" || value.from === "me") && typeof value.name === "string" && typeof value.alt === "string" &&
        optionalText("caption") && optionalText("nsfwVersion");
    case "wait":
      return typeof value.time === "number" && Number.isFinite(value.time) && value.time > 0;
    case "sound":
      return typeof value.sound === "string";
    case "quiz":
      return typeof value.id === "string" && Array.isArray(value.questions) && value.questions.every((question) =>
        isRecord(question) && typeof question.q === "string" && Array.isArray(question.answers) && question.answers.every((answer) =>
          isRecord(answer) && typeof answer.text === "string" && typeof answer.reply === "string" &&
          (answer.effects === undefined || validStats(answer.effects)),
        ),
      ) && validSteps(value.pass, depth + 1);
    default:
      return false;
  }
}

function validThread(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const transcript = value.transcript;
  const queue = value.queue;
  const state = value.state;
  const stats = value.stats;
  const validItems = transcript === undefined || (
    Array.isArray(transcript) && transcript.every((item) =>
      isRecord(item) &&
      (item.from === "them" || item.from === "me" || item.from === "sys") &&
      typeof item.text === "string" &&
      (item.time === undefined || typeof item.time === "string") &&
      (item.speaker === undefined || typeof item.speaker === "string") &&
      (item.chapter === undefined || (
        isRecord(item.chapter) && typeof item.chapter.number === "number" &&
        typeof item.chapter.title === "string" && typeof item.chapter.time === "string"
      )) &&
      (item.divider === undefined || (isRecord(item.divider) && typeof item.divider.text === "string")) &&
      (item.img === undefined || (
        isRecord(item.img) && typeof item.img.name === "string" && typeof item.img.alt === "string" &&
        (item.img.nsfwVersion === undefined || typeof item.img.nsfwVersion === "string")
      ))
    )
  );
  const validQueue = queue === undefined || (
    validSteps(queue)
  );
  const validState = state === undefined || (isRecord(state) && Object.values(state).every((item) => typeof item === "string"));
  const validStats = stats === undefined || (isRecord(stats) && Object.values(stats).every((item) => typeof item === "number" && Number.isFinite(item)));
  return (
    validItems && validQueue && validState && validStats &&
    (value.clock === undefined || (typeof value.clock === "number" && Number.isFinite(value.clock)))
  );
}

function validStoredValue(key: string, value: string): boolean {
  if (key.startsWith("sr-chat-") || key.startsWith("sr-place-")) {
    try {
      return validThread(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (key.startsWith("sr-save-")) {
    try {
      const save: unknown = JSON.parse(value);
      return (
        isRecord(save) &&
        save.version === 1 &&
        typeof save.savedAt === "string" &&
        isRecord(save.threads) &&
        Object.values(save.threads).every(validThread)
      );
    } catch {
      return false;
    }
  }
  return true;
}

export function makeBackup(data: Record<string, string>, story: string, now = new Date()): GameBackup {
  const safeData = Object.fromEntries(
    Object.entries(data).filter(([key]) => isGameStorageKey(key)),
  );
  return {
    format: "chat-story-local-backup",
    version: 1,
    exportedAt: now.toISOString(),
    story,
    data: safeData,
  };
}

export function parseBackup(text: string): { backup: GameBackup } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "That file is not valid JSON." };
  }
  if (
    !isRecord(raw) ||
    raw.format !== "chat-story-local-backup" ||
    raw.version !== 1 ||
    typeof raw.exportedAt !== "string" ||
    typeof raw.story !== "string" ||
    !isRecord(raw.data)
  ) {
    return { error: "This is not a supported Chat Story backup." };
  }

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.data)) {
    if (!isGameStorageKey(key) || typeof value !== "string" || !validStoredValue(key, value)) {
      return { error: `The backup contains invalid or unsupported data for "${key}".` };
    }
    data[key] = value;
  }

  return {
    backup: {
      format: raw.format,
      version: raw.version,
      exportedAt: raw.exportedAt,
      story: raw.story,
      data,
    },
  };
}
