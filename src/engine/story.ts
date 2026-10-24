// Turns the JSON files in src/story/ into the engine's Cast.
//
// This is the only place where the story format is defined, and it doubles as
// the validator: every problem is collected as a readable Issue instead of
// throwing, so a broken story file can never take the app down. Story authors
// see the issues in the app (chat-list banner) and via `bun run check`.
//
// The creator-facing reference lives in src/story/README.md — keep the two in
// sync when the format changes.

import type {
  Cast,
  ChoiceOpt,
  Contact,
  GalleryCategory,
  GalleryImage,
  Gate,
  Place,
  PlaceChat,
  Profile,
  QuizQ,
  RevealFact,
  Stats,
  Step,
} from "./types";
import { REVEAL_FACTS, STAT_NAMES, STAT_START, isStat, matchesIfCondition } from "./types";
import { VOICES } from "./sounds";
import { UI_MESSAGES, type UiKey, type UiOverrides } from "./i18n";

export type Issue = {
  file: string;
  /** Where inside the file, e.g. `chat[3] ("choice")`. */
  where: string;
  level: "error" | "warning";
  message: string;
};

type Raw = Record<string, unknown>;
type Ctx = {
  file: string;
  issues: Issue[];
  ids: Set<string>;
  assets: Set<string>;
  /** Sound names that exist: built-in voices and files in assets/sounds/. */
  sounds?: Set<string>;
  /** Local sound files only; ambience cannot name a synthesized voice. */
  soundFiles?: Set<string>;
  placeIds?: Set<string>;
  placeChats?: Map<string, Set<string>>;
  /** Parsing a place chat: fewer steps, extra speakers, no stats or profile. */
  scene?: boolean;
};

const DEFAULT_COLOR = "#7c3aed";

/** The built-in voices, for the message that lists what a story may name. */
const VOICE_NAMES = Object.keys(VOICES).sort();

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function report(ctx: Ctx, where: string, level: Issue["level"], message: string): void {
  ctx.issues.push({ file: ctx.file, where, level, message });
}

/** "did you mean"-style hint for typos in field names. */
function nearest(key: string, known: Iterable<string>): string {
  let best = "";
  let bestScore = 4;
  for (const candidate of known) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  return best ? ` — did you mean "${best}"?` : "";
}

function editDistance(a: string, b: string): number {
  const row = [...b].map((_, i) => i + 1);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Checks the fields of one JSON object against the names the format knows. */
function fields(ctx: Ctx, where: string, raw: Raw, required: string[], optional: string[]): boolean {
  const known = new Set([...required, ...optional]);
  let ok = true;
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      report(ctx, where, "error", `unknown field "${key}"${nearest(key, known)}`);
      ok = false;
    }
  }
  for (const key of required) {
    if (raw[key] === undefined) {
      report(ctx, where, "error", `missing "${key}"`);
      ok = false;
    }
  }
  return ok;
}

// ---- shared readers --------------------------------------------------------

/** Reads the stat numbers sitting directly on a step or choice option. */
function takeStats(ctx: Ctx, where: string, raw: Raw): Partial<Stats> {
  const out: Partial<Stats> = {};
  for (const key of Object.keys(raw)) {
    if (!isStat(key)) continue;
    const value = raw[key];
    if (!isNum(value)) {
      report(ctx, where, "error", `"${key}" must be a number (it is ${typeof value})`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Reads a `needs` block into an engine gate. */
function takeGate(ctx: Ctx, where: string, raw: unknown, needsHint = true): Gate | undefined {
  if (raw === undefined) return undefined;
  const gate: Gate = { stat: {} };
  if (!isObj(raw)) {
    report(ctx, where, "error", `"needs" must be an object like { "trust": 6, "hint": "…" }`);
    return undefined;
  }
  fields(ctx, where, raw, [], ["milestone", "inChat", "waitSeconds", "key", "is", "not", "hint", ...STAT_NAMES]);
  const hint = isText(raw.hint) ? raw.hint : "";

  const stats = takeStats(ctx, where, raw);
  if (Object.keys(stats).length > 0) {
    gate.stat = stats;
    if (ctx.scene) {
      report(ctx, where, "warning", `a stat gate cannot open in a place chat — place chats do not award stats`);
    }
  } else {
    delete gate.stat;
  }

  if (raw.milestone !== undefined) {
    if (!isText(raw.milestone)) report(ctx, where, "error", `"needs.milestone" must be the id of a milestone`);
    else gate.milestone = raw.milestone;
  }
  if (raw.inChat !== undefined) {
    if (!isText(raw.inChat)) report(ctx, where, "error", `"needs.inChat" must be a character folder id`);
    else if (!ctx.ids.has(raw.inChat)) checkId(ctx, where, raw.inChat);
    else gate.chat = raw.inChat;
    if (raw.milestone === undefined) {
      report(ctx, where, "error", `"needs.inChat" scopes a milestone check and must be used with "needs.milestone"`);
    }
  }
  if (raw.waitSeconds !== undefined) {
    if (!isNum(raw.waitSeconds) || !Number.isInteger(raw.waitSeconds) || raw.waitSeconds <= 0) {
      report(ctx, where, "error", `"needs.waitSeconds" must be a positive whole number of seconds`);
    } else {
      gate.seconds = raw.waitSeconds;
    }
    if (raw.milestone === undefined) {
      report(ctx, where, "error", `"needs.waitSeconds" requires "needs.milestone"`);
    }
  }
  if (raw.key !== undefined) {
    if (!isText(raw.key)) report(ctx, where, "error", `"needs.key" must be text`);
    else {
      const hasIs = raw.is !== undefined;
      const hasNot = raw.not !== undefined;
      if (hasIs === hasNot) {
        report(ctx, where, "error", `"needs.key" requires exactly one of "needs.is" or "needs.not"`);
      }
      if (raw.is !== undefined && !isText(raw.is)) report(ctx, where, "error", `"needs.is" must be text`);
      if (raw.not !== undefined && !isText(raw.not)) report(ctx, where, "error", `"needs.not" must be text`);
      if (hasIs !== hasNot && (raw.is === undefined || isText(raw.is)) && (raw.not === undefined || isText(raw.not))) {
        gate.state = {
          key: raw.key,
          is: isText(raw.is) ? raw.is : undefined,
          not: isText(raw.not) ? raw.not : undefined,
          hint: hint || "Not yet.",
        };
      }
    }
  } else if (raw.is !== undefined || raw.not !== undefined) {
    report(ctx, where, "error", `"needs.is"/"needs.not" need a "needs.key"`);
  }

  if (gate.stat || gate.milestone || gate.state) {
    if (needsHint && !hint) report(ctx, where, "warning", `this locked option has no "hint" — the button cannot explain itself`);
    gate.hint = hint || "Not yet.";
  } else if (raw !== undefined) {
    report(ctx, where, "error", `"needs" must include a stat, milestone or remembered-value condition`);
  }
  return gate;
}

/** Reads alternative stat groups for a branch's `any` condition. */
function takeAnyStats(ctx: Ctx, where: string, raw: unknown): Partial<Stats>[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    report(ctx, where, "error", `"any" must be a non-empty list of stat groups, e.g. [{ "feelings": 7 }, { "attraction": 7 }]`);
    return [];
  }

  const groups: Partial<Stats>[] = [];
  raw.forEach((item, index) => {
    const groupWhere = `${where}[${index}]`;
    if (!isObj(item)) {
      report(ctx, groupWhere, "error", `each "any" entry must be an object of stat thresholds`);
      return;
    }
    const validFields = fields(ctx, groupWhere, item, [], STAT_NAMES);
    const stats = takeStats(ctx, groupWhere, item);
    if (Object.keys(stats).length === 0) {
      report(ctx, groupWhere, "error", `each "any" entry must include at least one stat threshold`);
    } else if (validFields) {
      groups.push(stats);
    }
  });
  return groups;
}

/**
 * A clock time the way a person writes one: "18:12", "6:12 PM", "9am".
 * Returns minutes since midnight, or null when the text is not a time.
 */
function parseClock(text: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/**
 * Reads the optional "at" of a step: the story-clock time of that bubble.
 * A chapter uses it to set the clock for the whole scene; a single line can
 * use it to pin one moment ("the match starts at five").
 */
function takeAt(ctx: Ctx, where: string, raw: Raw): number | undefined {
  if (raw.at === undefined) return undefined;
  if (!isText(raw.at)) {
    report(ctx, where, "error", `"at" must be a clock time like "18:12" or "6:12 PM"`);
    return undefined;
  }
  const minutes = parseClock(raw.at);
  if (minutes === null) {
    report(ctx, where, "error", `"at" is not a clock time — write it like "18:12" or "6:12 PM"`);
    return undefined;
  }
  return minutes;
}

/** Reads an optional whole-minute gap after a text bubble. */
function takeDuration(ctx: Ctx, where: string, raw: Raw): number | undefined {
  if (raw.duration === undefined) return undefined;
  if (
    !isNum(raw.duration) ||
    !Number.isInteger(raw.duration) ||
    raw.duration < 0 ||
    raw.duration > 1440
  ) {
    report(ctx, where, "error", `"duration" must be a whole number of minutes from 0 to 1440`);
    return undefined;
  }
  return raw.duration;
}

function checkId(ctx: Ctx, where: string, id: string): void {
  if (!ctx.ids.has(id)) {
    report(ctx, where, "error", `"${id}" does not match any character folder in src/story/characters/`);
  }
}

function checkAsset(ctx: Ctx, where: string, name: string): void {
  if (!ctx.assets.has(name)) {
    const list = [...ctx.assets].slice(0, 4).join(", ");
    report(
      ctx,
      where,
      "error",
      `no picture called "${name}" in src/story/assets/ — add src/story/assets/${name}.svg (or .png/.jpg/.webp)` +
        (list ? ` · pictures found: ${list}` : " · that folder is empty"),
    );
  }
}

// ---- steps -----------------------------------------------------------------

const STEP_FIELDS: Record<string, { required: string[]; optional: string[] }> = {
  them: { required: ["text"], optional: ["typing", "pause", "speaker", "at", "duration"] },
  me: { required: ["text"], optional: ["pause", "at", "duration"] },
  chapter: { required: ["number", "time", "at"], optional: ["text"] },
  divider: { required: ["text"], optional: ["at", "style"] },
  photo: { required: ["name", "alt"], optional: ["from", "caption", "gallery", "nsfw_version", "typing", "pause", "at"] },
  wait: { required: ["time"], optional: [] },
  sound: { required: ["sound"], optional: [] },
  choice: { required: ["options"], optional: [] },
  status: { required: ["text"], optional: [] },
  rename: { required: ["name"], optional: ["initial"] },
  milestone: { required: ["id"], optional: [] },
  stats: { required: [], optional: [...STAT_NAMES] },
  remember: { required: ["key", "value"], optional: ["chat"] },
  reveal: { required: ["fact"], optional: ["value"] },
  if: { required: ["key", "then"], optional: ["is", "any", "not", "none"] },
  branch: { required: ["then"], optional: ["needs", "any", "otherwise"] },
  unlock: { required: ["chat"], optional: [] },
  "unlock-place": { required: ["place", "chat"], optional: [] },
  "add-to-chat": { required: ["chat", "steps"], optional: [] },
  ask: { required: ["key", "placeholder"], optional: [...STAT_NAMES] },
  quiz: { required: ["id", "questions"], optional: ["pass"] },
  "chapter-end": { required: [], optional: [] },
  "story-end": { required: [], optional: [] },
  "continue-elsewhere": { required: [], optional: ["for"] },
};

const OPTION_FIELDS = { required: ["label"], optional: ["say", "then", "needs", ...STAT_NAMES] };
const QUESTION_FIELDS = { required: ["q", "answers"], optional: ["hint"] };
const ANSWER_FIELDS = { required: ["text", "reply"], optional: ["right", ...STAT_NAMES] };

/** What a place chat can do. Everything else belongs to a character thread. */
const SCENE_STEPS = new Set([
  "them",
  "me",
  "divider",
  "sound",
  "photo",
  "wait",
  "choice",
  "milestone",
  "remember",
  "if",
  "unlock",
  "unlock-place",
  "add-to-chat",
]);

function takeSteps(ctx: Ctx, where: string, raw: unknown): Step[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    report(ctx, where, "error", `expected a list of steps`);
    return [];
  }
  const out: Step[] = [];
  raw.forEach((entry, i) => {
    const step = takeStep(ctx, `${where}[${i}]`, entry);
    if (step) out.push(step);
  });
  return out;
}

/**
 * Any step may carry `"nsfw": "yes"`. The wrapper checks the value once and
 * marks the parsed step, so every type gets the gate without repeating it.
 */
function takeStep(ctx: Ctx, where: string, raw: unknown): Step | null {
  const step = takeStepBody(ctx, where, raw);
  if (!step) return null;
  if (isObj(raw) && raw.nsfw !== undefined) {
    if (raw.nsfw !== "yes") {
      report(ctx, where, "error", `"nsfw" must be "yes" — it marks the whole step as NSFW-only`);
      return null;
    }
    step.nsfw = true;
  }
  return step;
}

function takeStepBody(ctx: Ctx, where: string, raw: unknown): Step | null {
  if (!isObj(raw)) {
    report(ctx, where, "error", `each step must be an object like { "type": "them", "text": "…" }`);
    return null;
  }
  if (!isText(raw.type)) {
    report(ctx, where, "error", `missing "type"`);
    return null;
  }
  const type = raw.type;
  const spec = STEP_FIELDS[type];
  if (!spec) {
    report(ctx, where, "error", `unknown step type "${type}"${nearest(type, Object.keys(STEP_FIELDS))}`);
    return null;
  }
  if (ctx.scene && !SCENE_STEPS.has(type)) {
    report(
      ctx,
      where,
      "error",
      `"${type}" is not available in a place chat — allowed: ${[...SCENE_STEPS].join(", ")}`,
    );
    return null;
  }
  fields(ctx, where, raw, ["type", ...spec.required], [...spec.optional, "nsfw"]);
  const label = `${where} ("${type}")`;
  const optNum = (key: string): number | undefined => (isNum(raw[key]) ? raw[key] : undefined);

  switch (type) {
    case "them": {
      if (!isText(raw.text)) return null;
      if (raw.speaker !== undefined && !isText(raw.speaker)) {
        report(ctx, label, "error", `"speaker" must be text, e.g. "Door guy"`);
        return null;
      }
      if (raw.speaker !== undefined && !ctx.scene) {
        report(ctx, label, "error", `"speaker" only belongs in a place chat — a character thread is just the two of you`);
        return null;
      }
      const duration = takeDuration(ctx, label, raw);
      if (raw.duration !== undefined && duration === undefined) return null;
      return {
        t: "msg",
        from: "them",
        text: raw.text,
        typing: optNum("typing"),
        pause: optNum("pause"),
        duration,
        speaker: ctx.scene && isText(raw.speaker) ? raw.speaker : undefined,
        at: takeAt(ctx, label, raw),
      };
    }
    case "me": {
      if (!isText(raw.text)) return null;
      const duration = takeDuration(ctx, label, raw);
      if (raw.duration !== undefined && duration === undefined) return null;
      return {
        t: "msg",
        from: "me",
        text: raw.text,
        typing: optNum("typing"),
        pause: optNum("pause"),
        duration,
        at: takeAt(ctx, label, raw),
      };
    }
    case "chapter": {
      if (!isNum(raw.number) || !Number.isInteger(raw.number) || raw.number < 1) {
        report(ctx, label, "error", `"number" must be a whole number starting at 1`);
        return null;
      }
      if (typeof raw.time !== "string") {
        report(ctx, label, "error", `"time" must be text like "Friday Evening" — use an empty string for a blank line`);
        return null;
      }
      if (raw.text !== undefined && typeof raw.text !== "string") {
        report(ctx, label, "error", `"text" must be a chapter title`);
        return null;
      }
      const at = raw.at === "" ? undefined : takeAt(ctx, label, raw);
      if (raw.at !== "" && at === undefined) return null;
      return {
        t: "chapter",
        number: raw.number,
        text: typeof raw.text === "string" ? raw.text.trim() : "",
        time: raw.time.trim(),
        at,
      };
    }
    case "divider": {
      if (!isText(raw.text)) return null;
      if (raw.style !== undefined && raw.style !== "divider" && raw.style !== "fade") {
        report(ctx, label, "error", `"style" must be "divider" or "fade"`);
        return null;
      }
      return {
        t: "divider",
        text: raw.text,
        at: takeAt(ctx, label, raw),
        style: raw.style === "fade" ? "fade" : "divider",
      };
    }
    case "photo": {
      if (!isText(raw.name) || !isText(raw.alt)) return null;
      if (raw.nsfw === "yes" && raw.nsfw_version !== undefined) {
        report(ctx, label, "error", `a photo is either NSFW-only ("nsfw": "yes") or has an "nsfw_version" — not both`);
        return null;
      }
      const from = raw.from === "me" ? "me" : "them";
      let gallery: string | undefined;
      if (raw.gallery !== undefined) {
        if (!isText(raw.gallery)) {
          report(ctx, label, "error", `"gallery" must be "misc" or a character id`);
          return null;
        }
        if (raw.gallery !== "misc" && !ctx.ids.has(raw.gallery)) {
          report(ctx, label, "error", `"gallery" names "${raw.gallery}", which is not a character folder`);
          return null;
        }
        gallery = raw.gallery;
      }
      checkAsset(ctx, label, raw.name);
      let nsfwVersion: string | undefined;
      if (raw.nsfw_version !== undefined) {
        if (!isText(raw.nsfw_version)) {
          report(ctx, label, "error", `"nsfw_version" must be a picture name like "alex/chapter1/photo_nsfw"`);
          return null;
        }
        checkAsset(ctx, label, raw.nsfw_version);
        nsfwVersion = raw.nsfw_version;
      }
      return {
        t: "img",
        from,
        name: raw.name,
        alt: raw.alt,
        nsfwVersion,
        caption: isText(raw.caption) ? raw.caption : undefined,
        gallery,
        typing: optNum("typing"),
        pause: optNum("pause"),
        at: takeAt(ctx, label, raw),
      };
    }
    case "sound": {
      // A sound on its own, played where it stands: a built-in voice or a file.
      if (!isText(raw.sound)) {
        report(ctx, label, "error", `"sound" must name a built-in voice ("chime", "pop", …) or a sound file`);
        return null;
      }
      if (ctx.sounds) {
        const known = ctx.sounds.has(raw.sound) || ctx.sounds.has(`sounds/${raw.sound}`);
        if (!known) {
          report(
            ctx,
            label,
            "warning",
            `"sound" names "${raw.sound}", which is not a built-in voice or a file in assets/sounds/ — voices are ${VOICE_NAMES.join(", ")}`,
          );
        }
      }
      return { t: "sound", sound: raw.sound };
    }
    case "wait": {
      if (!isNum(raw.time) || raw.time <= 0) {
        report(ctx, label, "error", `"time" must be a positive number of milliseconds`);
        return null;
      }
      if (raw.time > 60000) {
        report(ctx, label, "warning", `"time" is capped at 60000 — a longer pause will feel like a bug`);
      }
      return { t: "wait", time: Math.min(raw.time, 60000) };
    }
    case "choice": {
      if (!Array.isArray(raw.options) || raw.options.length === 0) {
        report(ctx, label, "error", `"options" must be a list with at least one reply`);
        return null;
      }
      const opts: ChoiceOpt[] = [];
      raw.options.forEach((option, i) => {
        const oWhere = `${label} → options[${i}]`;
        if (!isObj(option)) {
          report(ctx, oWhere, "error", `each option must be an object like { "label": "Say hi", "then": [ … ] }`);
          return;
        }
        if (!fields(ctx, oWhere, option, OPTION_FIELDS.required, OPTION_FIELDS.optional)) return;
        if (!isText(option.label)) return;
        const effects = takeStats(ctx, oWhere, option);
        if (ctx.scene && Object.keys(effects).length > 0) {
          report(ctx, oWhere, "warning", `place chats do not show stats — this reply's stat change would be invisible`);
        }
        opts.push({
          label: option.label,
          say: isText(option.say) ? option.say : option.label,
          then: takeSteps(ctx, `${oWhere} → then`, option.then),
          requires: takeGate(ctx, `${oWhere} → needs`, option.needs),
          effects: Object.keys(effects).length > 0 ? effects : undefined,
        });
      });
      return opts.length > 0 ? { t: "choice", opts } : null;
    }
    case "status": {
      if (!isText(raw.text)) return null;
      return { t: "presence", value: raw.text };
    }
    case "rename": {
      if (!isText(raw.name)) return null;
      return {
        t: "rename",
        name: raw.name,
        initial: isText(raw.initial) ? raw.initial : raw.name.trim()[0].toUpperCase(),
      };
    }
    case "milestone": {
      if (!isText(raw.id)) return null;
      return { t: "milestone", id: raw.id };
    }
    case "stats": {
      const stats = takeStats(ctx, label, raw);
      if (Object.keys(stats).length === 0) {
        report(ctx, label, "error", `add at least one of: ${STAT_NAMES.join(", ")}`);
        return null;
      }
      return { t: "addStats", stats };
    }
    case "remember": {
      if (!isText(raw.key) || !isText(raw.value)) return null;
      const chat = isText(raw.chat) ? raw.chat : undefined;
      if (chat) checkId(ctx, label, chat);
      return { t: "set", key: raw.key, value: raw.value, chat };
    }
    case "reveal": {
      if (!isText(raw.fact)) return null;
      if (!(REVEAL_FACTS as string[]).includes(raw.fact)) {
        report(ctx, label, "error", `"fact" must be one of: ${REVEAL_FACTS.join(", ")}${nearest(raw.fact, REVEAL_FACTS)}`);
        return null;
      }
      const fact = raw.fact as RevealFact;
      if (fact === "age" || fact === "birthday") {
        if (raw.value !== undefined) report(ctx, label, "error", `"${fact}" is one fact on its own — drop the "value"`);
        return { t: "reveal", fact };
      }
      if (!isText(raw.value)) {
        report(ctx, label, "error", `revealing a ${fact} entry needs its "value", e.g. { "type": "reveal", "fact": "${fact}", "value": "…" }`);
        return null;
      }
      return { t: "reveal", fact, value: raw.value };
    }
    case "if": {
      if (!isText(raw.key)) return null;
      const conditions = (["is", "any", "not", "none"] as const).filter((key) => raw[key] !== undefined);
      if (conditions.length !== 1) {
        report(ctx, label, "error", `an "if" needs exactly one of "is", "any", "not" or "none"`);
        return null;
      }

      const condition = conditions[0];
      if (condition === "is") {
        if (!isText(raw.is)) {
          report(ctx, label, "error", `"is" must be a non-empty remembered value`);
          return null;
        }
        return { t: "if", key: raw.key, is: raw.is, then: takeSteps(ctx, `${label} → then`, raw.then) };
      }
      if (condition === "not") {
        if (!isText(raw.not)) {
          report(ctx, label, "error", `"not" must be a non-empty remembered value`);
          return null;
        }
        return { t: "if", key: raw.key, not: raw.not, then: takeSteps(ctx, `${label} → then`, raw.then) };
      }

      const rawValues = condition === "any" ? raw.any : raw.none;
      if (!Array.isArray(rawValues) || rawValues.length === 0 || !rawValues.every(isText)) {
        report(ctx, label, "error", `"${condition}" must be a non-empty list of remembered values`);
        return null;
      }
      const values = rawValues.filter((value): value is string => isText(value));
      return condition === "any"
        ? { t: "if", key: raw.key, any: values, then: takeSteps(ctx, `${label} → then`, raw.then) }
        : { t: "if", key: raw.key, none: values, then: takeSteps(ctx, `${label} → then`, raw.then) };
    }
    case "branch": {
      const gate = takeGate(ctx, label + " → needs", raw.needs, false);
      const min = gate?.stat ?? {};
      const any = takeAnyStats(ctx, `${label} → any`, raw.any);
      if (gate?.milestone || gate?.state || gate?.chat || gate?.seconds) {
        report(
          ctx,
          label,
          "error",
          `a "branch" step can only check stats — use a choice option with "needs" for milestone or remembered conditions`,
        );
        return null;
      }
      if (Object.keys(min).length === 0 && !any?.some((group) => Object.keys(group).length > 0)) {
        report(ctx, label, "error", `a "branch" step needs at least one stat threshold in "needs" or "any"`);
        return null;
      }
      return {
        t: "gate",
        min,
        any,
        then: takeSteps(ctx, `${label} → then`, raw.then),
        otherwise: raw.otherwise === undefined ? undefined : takeSteps(ctx, `${label} → otherwise`, raw.otherwise),
      };
    }
    case "unlock": {
      if (!isText(raw.chat)) return null;
      checkId(ctx, label, raw.chat);
      return { t: "unlock", chat: raw.chat };
    }
    case "unlock-place": {
      if (!isText(raw.place) || !isText(raw.chat)) return null;
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(raw.place)) {
        report(ctx, label, "error", `"place" must be a place file id`);
        return null;
      }
      if (!ctx.placeIds?.has(raw.place)) {
        report(ctx, label, "error", `place "${raw.place}" does not exist in src/story/locations/`);
        return null;
      }
      if (!ctx.placeChats?.get(raw.place)?.has(raw.chat)) {
        report(ctx, label, "error", `place chat "${raw.chat}" does not exist in "${raw.place}"`);
        return null;
      }
      return { t: "unlockPlace", place: raw.place, chat: raw.chat };
    }
    case "add-to-chat": {
      if (!isText(raw.chat)) return null;
      checkId(ctx, label, raw.chat);
      // These steps will play in a character chat, so they follow that format
      // even when the step itself was written inside a place chat.
      const chatCtx: Ctx = { ...ctx, scene: false };
      return { t: "append", chat: raw.chat, steps: takeSteps(chatCtx, `${label} → steps`, raw.steps) };
    }
    case "ask": {
      if (!isText(raw.key) || !isText(raw.placeholder)) return null;
      const effects = takeStats(ctx, label, raw);
      return {
        t: "ask",
        key: raw.key,
        placeholder: raw.placeholder,
        effects: Object.keys(effects).length > 0 ? effects : undefined,
      };
    }
    case "quiz": {
      if (!isText(raw.id) || !Array.isArray(raw.questions) || raw.questions.length === 0) {
        report(ctx, label, "error", `"questions" must be a list with at least one question`);
        return null;
      }
      const questions: QuizQ[] = [];
      raw.questions.forEach((question, i) => {
        const qWhere = `${label} → questions[${i}]`;
        if (!isObj(question) || !fields(ctx, qWhere, question, QUESTION_FIELDS.required, QUESTION_FIELDS.optional)) return;
        if (!isText(question.q)) return;
        if (!Array.isArray(question.answers) || question.answers.length < 2) {
          report(ctx, qWhere, "error", `give at least two answers, one of them "right": true`);
          return;
        }
        const answers: QuizQ["answers"] = [];
        question.answers.forEach((answer, j) => {
          const aWhere = `${qWhere} → answers[${j}]`;
          if (!isObj(answer) || !fields(ctx, aWhere, answer, ANSWER_FIELDS.required, ANSWER_FIELDS.optional)) return;
          if (!isText(answer.text) || !isText(answer.reply)) return;
          // A right answer can pay out, e.g. answering "setter" instead of
          // "volleyball" earns a point for paying attention.
          const effects = takeStats(ctx, aWhere, answer);
          answers.push({
            text: answer.text,
            reply: answer.reply,
            right: answer.right === true,
            effects: Object.keys(effects).length > 0 ? effects : undefined,
          });
        });
        if (answers.length < 2) return;
        if (!answers.some((a) => a.right)) report(ctx, qWhere, "warning", `no answer is marked "right": true`);
        questions.push({
          q: question.q as string,
          answers,
          hint: isText(question.hint) ? question.hint : "Not quite — think back.",
        });
      });
      if (questions.length === 0) return null;
      return { t: "quiz", id: raw.id, questions, pass: takeSteps(ctx, `${label} → pass`, raw.pass) };
    }
    case "chapter-end":
      return { t: "ending", kind: "pause" };
    case "story-end":
      return { t: "ending", kind: "finale" };
    case "continue-elsewhere":
      return { t: "ending", kind: "wait", waitFor: isText(raw.for) ? raw.for : undefined };
    default:
      report(ctx, where, "error", `step type "${type}" is not supported`);
      return null;
  }
}

// ---- character folders -----------------------------------------------------

const CHARACTER_FIELDS = {
  required: ["name"],
  optional: ["chat", "color", "initial", "avatar", "teaser", "unlocked", "dev", "order", "age", "birthday", "tagline", "interests", "likes", "dislikes"],
};

const textList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => isText(x)) ? (v as string[]) : null;

type ChapterSource = { file: string; number: number; data: unknown };
type Built = {
  contact: Contact;
  profile?: Profile;
  order: number;
  profileFile: string;
  chapters: { file: string; steps: Step[] }[];
};

function takeCharacter(ctx: Ctx, id: string, raw: Raw, chapters: ChapterSource[]): Built | null {
  const where = ctx.file;
  let ok = fields(ctx, where, raw, CHARACTER_FIELDS.required, CHARACTER_FIELDS.optional);
  if (!isText(raw.name)) {
    if (raw.name !== undefined) report(ctx, where, "error", `"name" must be text`);
    ok = false;
  }
  if (raw.color !== undefined && !isText(raw.color)) {
    report(ctx, where, "error", `"color" must be a CSS colour like "#7c3aed"`);
    ok = false;
  }
  if (raw.initial !== undefined && !isText(raw.initial)) {
    report(ctx, where, "error", `"initial" must be a single letter`);
    ok = false;
  }
  if (raw.teaser !== undefined && !isText(raw.teaser)) {
    report(ctx, where, "error", `"teaser" must be text`);
    ok = false;
  }
  if (raw.avatar !== undefined) {
    if (!isText(raw.avatar)) {
      report(ctx, where, "error", `"avatar" must be a picture name like "alex-head" — no extension`);
      ok = false;
    } else {
      checkAsset(ctx, where, raw.avatar);
    }
  }
  if (raw.unlocked !== undefined && typeof raw.unlocked !== "boolean") {
    report(ctx, where, "error", `"unlocked" must be true or false`);
    ok = false;
  }
  if (raw.dev !== undefined && typeof raw.dev !== "boolean") {
    report(ctx, where, "error", `"dev" must be true or false`);
    ok = false;
  }
  if (raw.order !== undefined && !isNum(raw.order)) {
    report(ctx, where, "error", `"order" must be a number (lower comes first)`);
    ok = false;
  }
  if (raw.chat !== undefined) {
    report(
      ctx,
      where,
      "error",
      `"chat" is not allowed in the profile anymore — put the steps in ${id}/chapter1.json, ${id}/chapter2.json, …`,
    );
    ok = false;
  }
  if (!ok) {
    report(ctx, where, "error", `this character was skipped — fix the file and reload`);
    return null;
  }

  const ordered = [...chapters].sort((a, b) => a.number - b.number);
  const chat: Step[] = [];
  const chapterSteps: { file: string; steps: Step[] }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const chapter = ordered[i];
    const chCtx: Ctx = { ...ctx, file: chapter.file };
    if (!Array.isArray(chapter.data)) {
      report(chCtx, "steps", "error", `a chapter file must contain a list of steps`);
      continue;
    }
    const first = chapter.data[0];
    if (!isObj(first) || first.type !== "chapter") {
      report(
        chCtx,
        "steps[0]",
        "error",
        `start this chapter with { "type": "chapter", "number": ${chapter.number}, "text": "", "time": "", "at": "18:12" }`,
      );
    } else if (first.number !== chapter.number) {
      report(chCtx, "steps[0]", "error", `the chapter number must be ${chapter.number} to match the file name`);
    }
    const steps = takeSteps(chCtx, "steps", chapter.data);
    chat.push(...steps);
    chapterSteps.push({ file: chapter.file, steps });
    if (ordered[i + 1] && ordered[i + 1].number !== chapter.number + 1) {
      report(
        ctx,
        where,
        "warning",
        `chapter files jump from ${chapter.number} to ${ordered[i + 1].number} — expected ${chapter.number + 1}`,
      );
    }
  }
  if (ordered.length > 0 && ordered[0].number !== 1) {
    report(ctx, where, "warning", `chapter files start at ${ordered[0].number} — expected chapter1.json`);
  }

  const name = raw.name as string;
  let profile: Profile | undefined;
  const hasProfileFields = ["age", "birthday", "tagline", "interests", "likes", "dislikes"].some((key) => raw[key] !== undefined);
  if (hasProfileFields && raw.age === undefined && raw.tagline === undefined) {
    report(ctx, where, "error", `a profile needs both "age" and "tagline"`);
  }
  if (raw.age !== undefined || raw.tagline !== undefined) {
    if (!isNum(raw.age) || !isText(raw.tagline)) {
      report(ctx, where, "error", `a profile needs both "age" (number) and "tagline" (text)`);
    } else {
      const interests = textList(raw.interests) ?? [];
      const likes = textList(raw.likes) ?? [];
      const dislikes = textList(raw.dislikes) ?? [];
      if (raw.interests !== undefined && !textList(raw.interests)) report(ctx, where, "error", `"interests" must be a list of texts`);
      if (raw.likes !== undefined && !textList(raw.likes)) report(ctx, where, "error", `"likes" must be a list of texts`);
      if (raw.dislikes !== undefined && !textList(raw.dislikes)) report(ctx, where, "error", `"dislikes" must be a list of texts`);
      if (raw.birthday !== undefined && !isText(raw.birthday)) report(ctx, where, "error", `"birthday" must be text, e.g. "2 April"`);
      const birthday = isText(raw.birthday) ? raw.birthday : undefined;
      profile = { age: raw.age, birthday, tagline: raw.tagline, interests, likes, dislikes };
    }
  }

  const contact: Contact = {
    id,
    name,
    initial: isText(raw.initial) ? raw.initial : name.trim()[0].toUpperCase(),
    color: isText(raw.color) ? raw.color : DEFAULT_COLOR,
    avatar: isText(raw.avatar) ? raw.avatar : undefined,
    teaser: isText(raw.teaser) ? raw.teaser : "",
    script: chat,
    storeKey: `sr-chat-${id}`,
    startUnlocked: raw.unlocked === true,
    dev: raw.dev === true,
    data: {
      transcript: [],
      queue: [],
      state: {},
      name,
      initial: isText(raw.initial) ? raw.initial : name.trim()[0].toUpperCase(),
      unlocked: raw.unlocked === true,
      stats: { ...STAT_START },
      clockUnits: 0,
    },
  };
  return { contact, profile, order: isNum(raw.order) ? raw.order : 999, profileFile: where, chapters: chapterSteps };
}

/** Visits every step, including the ones nested inside choices and conditional paths. */
function eachNestedStep(steps: Step[], visit: (s: Step) => void): void {
  for (const s of steps) {
    visit(s);
    if (s.t === "choice") for (const o of s.opts) eachNestedStep(o.then, visit);
    else if (s.t === "if") eachNestedStep(s.then, visit);
    else if (s.t === "gate") {
      eachNestedStep(s.then, visit);
      if (s.otherwise) eachNestedStep(s.otherwise, visit);
    } else if (s.t === "quiz") eachNestedStep(s.pass, visit);
  }
}

/**
 * A `reveal` has to name something the profile actually holds, or the fact
 * would never appear. Runs once every character is built, so it can follow
 * `add-to-chat` steps into the chat they write to.
 */
function checkReveals(ctx: Ctx, ownerId: string, steps: Step[], built: Map<string, Built>, depth: number): void {
  if (depth > 8) return;
  eachNestedStep(steps, (s) => {
    if (s.t === "reveal") {
      const prof = built.get(ownerId)?.profile;
      if (!prof) {
        report(ctx, "chat", "warning", `a "reveal" step here has no profile to reveal — give this character "age" and "tagline"`);
        return;
      }
      if (s.fact === "age") return;
      if (s.fact === "birthday") {
        if (!prof.birthday) report(ctx, "chat", "warning", `no "birthday" on this profile — that fact can never be revealed`);
        return;
      }
      if (!prof[s.fact].includes(s.value ?? "")) {
        report(ctx, "chat", "warning", `no ${s.fact} entry "${s.value}" on this profile — that fact can never be revealed`);
      }
    } else if (s.t === "append") {
      if (built.has(s.chat)) checkReveals(ctx, s.chat, s.steps, built, depth + 1);
    }
  });
}

type StoryReferences = {
  milestones: Set<string>;
  writes: Set<string>;
  reads: { key: string; file: string; onlyWhenPresent: boolean }[];
  milestoneReads: { id: string; file: string }[];
};

function validateStoryReferences(
  built: Map<string, Built>,
  places: Map<string, Place>,
  ids: Set<string>,
  assets: Set<string>,
  sounds: Set<string>,
  soundFiles: Set<string>,
  issues: Issue[],
): void {
  const refs = new Map<string, StoryReferences>();
  const entry = (scope: string): StoryReferences => {
    let value = refs.get(scope);
    if (!value) {
      value = { milestones: new Set(), writes: new Set(), reads: [], milestoneReads: [] };
      refs.set(scope, value);
    }
    return value;
  };

  const visit = (steps: Step[], scope: string, file: string, depth: number): void => {
    if (depth > 16) return;
    for (const step of steps) {
      const own = entry(scope);
      if (step.t === "milestone") {
        own.milestones.add(step.id);
        own.writes.add(`_m:${step.id}`);
      } else if (step.t === "ask") {
        own.writes.add(step.key);
      } else if (step.t === "quiz") {
        own.writes.add(`_q:${step.id}`);
      } else if (step.t === "set") {
        entry(step.chat ?? scope).writes.add(step.key);
      } else if (step.t === "if" && (step.is !== undefined || step.any !== undefined)) {
        own.reads.push({ key: step.key, file, onlyWhenPresent: true });
      }

      if (step.t === "choice") {
        for (const option of step.opts) {
          if (option.requires?.milestone) {
            entry(option.requires.chat ?? scope).milestoneReads.push({ id: option.requires.milestone, file });
          }
          if (option.requires?.state) {
            const condition = option.requires.state;
            entry(scope).reads.push({
              key: condition.key,
              file,
              onlyWhenPresent: condition.is !== undefined,
            });
          }
          visit(option.then, scope, file, depth + 1);
        }
      } else if (step.t === "if") {
        visit(step.then, scope, file, depth + 1);
      } else if (step.t === "gate") {
        visit(step.then, scope, file, depth + 1);
        if (step.otherwise) visit(step.otherwise, scope, file, depth + 1);
      } else if (step.t === "quiz") {
        visit(step.pass, scope, file, depth + 1);
      } else if (step.t === "append") {
        visit(step.steps, step.chat, file, depth + 1);
      }
    }
  };

  for (const [id, item] of built) {
    for (const chapter of item.chapters) visit(chapter.steps, id, chapter.file, 0);
    const endings = new Set<string>();
    eachNestedStep(item.contact.script, (step) => {
      if (step.t === "ending") endings.add(step.kind);
    });
    if (item.contact.script.length > 0 && endings.size === 0) {
      report(
        { file: item.profileFile, issues, ids, assets, sounds, soundFiles },
        "chat",
        "warning",
        `no route contains a chapter-end, story-end or continue-elsewhere marker`,
      );
    }
  }

  for (const [placeId, place] of places) {
    for (const chat of place.chats) visit(chat.script, `${placeId}/${chat.id}`, `${placeId}.json`, 0);
  }

  for (const [scope, refsForScope] of refs) {
    const ctx: Ctx = { file: scope, issues, ids, assets, sounds, soundFiles };
    for (const read of refsForScope.reads) {
      if (read.onlyWhenPresent && !refsForScope.writes.has(read.key)) {
        report(
          { ...ctx, file: read.file },
          "story references",
          "warning",
          `condition checks "${read.key}", but this chat never remembers or asks for that value`,
        );
      }
    }
    for (const read of refsForScope.milestoneReads) {
      if (!refsForScope.milestones.has(read.id)) {
        report(
          { ...ctx, file: read.file },
          "story references",
          "warning",
          `no milestone "${read.id}" is declared in "${scope}" — this reply may stay locked`,
        );
      }
    }
  }
}

// ---- place files ------------------------------------------------------------

const PLACE_FIELDS = {
  required: ["name"],
  optional: ["icon", "color", "teaser", "order", "host", "chats", "ambient", "dev"],
};

const PLACE_CHAT_FIELDS = {
  required: ["id", "title"],
  optional: ["teaser", "unlocked", "chat", "at"],
};

const PLACE_DEFAULT_COLOR = "#6b7f8f";

/**
 * A place groups the conversations that happen away from the phone. Its
 * `host` is the character whose name labels untagged lines; everyone else in
 * the room is named on the individual `them` step with `speaker`.
 */
function takePlace(ctx: Ctx, id: string, raw: Raw): Place | null {
  const where = ctx.file;
  let ok = fields(ctx, where, raw, PLACE_FIELDS.required, PLACE_FIELDS.optional);

  if (!isText(raw.name)) {
    if (raw.name !== undefined) report(ctx, where, "error", `"name" must be text`);
    ok = false;
  }
  if (raw.icon !== undefined && !isText(raw.icon)) {
    report(ctx, where, "error", `"icon" must be a short symbol like "📚"`);
    ok = false;
  }
  if (raw.color !== undefined && !isText(raw.color)) {
    report(ctx, where, "error", `"color" must be a CSS colour like "#6b7f8f"`);
    ok = false;
  }
  if (raw.teaser !== undefined && !isText(raw.teaser)) {
    report(ctx, where, "error", `"teaser" must be text`);
    ok = false;
  }
  if (raw.order !== undefined && !isNum(raw.order)) {
    report(ctx, where, "error", `"order" must be a number (lower comes first)`);
    ok = false;
  }
  if (raw.dev !== undefined && typeof raw.dev !== "boolean") {
    report(ctx, where, "error", `"dev" must be true or false`);
    ok = false;
  }
  if (!isText(raw.host)) {
    report(ctx, where, "error", `"host" must name a character folder — it is the default speaker`);
    ok = false;
  } else {
    checkId(ctx, where, raw.host);
  }
  if (raw.ambient !== undefined && !isText(raw.ambient)) {
    report(ctx, where, "error", `"ambient" must name a sound file in assets/sounds/`);
    ok = false;
  } else if (isText(raw.ambient) && ctx.soundFiles) {
    const name = raw.ambient.replace(/^sounds\//, "");
    if (!ctx.soundFiles.has(name) && !ctx.soundFiles.has(`sounds/${name}`)) {
      report(ctx, where, "error", `no ambient sound file called "${raw.ambient}" in src/story/assets/sounds/`);
      ok = false;
    }
  }

  if (!ok) {
    report(ctx, where, "error", `this place was skipped — fix the file and reload`);
    return null;
  }

  const chats: PlaceChat[] = [];
  if (raw.chats !== undefined && !Array.isArray(raw.chats)) {
    report(ctx, where, "error", `"chats" must be a list of place chats`);
  } else if (Array.isArray(raw.chats)) {
    const seen = new Set<string>();
    raw.chats.forEach((entry, i) => {
      const cWhere = `${where} → chats[${i}]`;
      if (!isObj(entry)) {
        report(ctx, cWhere, "error", `each place chat must be an object with "id", "title" and "chat"`);
        return;
      }
      if (!fields(ctx, cWhere, entry, PLACE_CHAT_FIELDS.required, PLACE_CHAT_FIELDS.optional)) return;
      if (!isText(entry.id) || !isText(entry.title)) return;

      const chatId = entry.id.trim();
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(chatId)) {
        report(ctx, cWhere, "error", `"id" may only use letters, numbers and dashes`);
        return;
      }
      if (seen.has(chatId)) {
        report(ctx, cWhere, "error", `two place chats share the id "${chatId}"`);
        return;
      }
      seen.add(chatId);

      if (entry.teaser !== undefined && !isText(entry.teaser)) {
        report(ctx, cWhere, "error", `"teaser" must be text`);
        return;
      }
      if (entry.unlocked !== undefined && typeof entry.unlocked !== "boolean") {
        report(ctx, cWhere, "error", `"unlocked" must be true or false`);
        return;
      }

      const sceneCtx: Ctx = { ...ctx, scene: true };
      const steps = takeSteps(sceneCtx, `${cWhere} → chat`, entry.chat);
      if (entry.chat !== undefined && steps.length === 0) {
        report(ctx, cWhere, "warning", `"chat" is empty — the place chat will open and finish immediately`);
      }

      const startUnlocked = entry.unlocked !== false;
      chats.push({
        id: chatId,
        title: entry.title,
        teaser: isText(entry.teaser) ? entry.teaser : "",
        script: steps,
        storeKey: `sr-place-${id}-${chatId}`,
        startUnlocked,
        host: raw.host as string,
        at: takeAt(ctx, cWhere, entry),
        data: {
          transcript: [],
          queue: [],
          state: {},
          stats: { ...STAT_START },
          unlocked: startUnlocked,
          done: false,
          clockUnits: 0,
        },
      });
    });
  }

  return {
    id,
    name: raw.name as string,
    icon: isText(raw.icon) ? raw.icon : "📍",
    color: isText(raw.color) ? raw.color : PLACE_DEFAULT_COLOR,
    teaser: isText(raw.teaser) ? raw.teaser : "",
    order: isNum(raw.order) ? raw.order : 999,
    chats,
    ambient: isText(raw.ambient) ? raw.ambient : undefined,
    dev: raw.dev === true,
  };
}

// ---- conversation balance ---------------------------------------------------

/**
 * Who talks in a chat: `them` is the character's bubbles, `me` the player's.
 * A choice, a quiz answer and an `ask` each count as the player speaking once
 * (that is how many bubbles the thread gets). Measured by `countChat`.
 */
export type ChatBalance = {
  them: number;
  me: number;
};

type Talk = { label: string; them: number; me: number };

/**
 * One pass through a chat, counting who speaks scene by scene. It takes the
 * first reply the player could pick and the "otherwise" side of a gate, so it
 * provides an indicative speaker split rather than measuring every path.
 */
function playChat(steps: Step[]): Talk[] {
  const scenes: Talk[] = [{ label: "", them: 0, me: 0 }];
  const here = (): Talk => scenes[scenes.length - 1];
  const state: Record<string, string> = {};
  const queue: Step[] = [...steps];
  let guard = 0;
  while (queue.length > 0) {
    if (++guard > 20000) break; // a script that loops must not hang the checker
    const s = queue.shift();
    if (!s) break;
    if (s.nsfw) continue; // the SFW pass: an NSFW-only step never happens
    switch (s.t) {
      case "chapter":
        scenes.push({ label: s.text ? `Chapter ${s.number} — ${s.text}` : `Chapter ${s.number}`, them: 0, me: 0 });
        break;
      case "divider":
        scenes.push({ label: s.text, them: 0, me: 0 });
        break;
      case "msg":
        if (s.from === "sys") scenes.push({ label: s.text, them: 0, me: 0 });
        else if (s.from === "me") here().me++;
        else here().them++;
        break;
      case "img":
        if (s.from === "me") here().me++;
        else here().them++;
        break;
      case "choice": {
        here().me++; // the player always sends the line they picked
        const open = s.opts.find((o) => !o.requires) ?? s.opts[0];
        if (open) queue.unshift(...open.then);
        break;
      }
      case "quiz":
        here().me += s.questions.length;
        // The first reply the player could pick is the right one, so this pass
        // reads as a clean run — the branch whose reward a careful player earns.
        state[`_q:${s.id}`] = "clean";
        queue.unshift(...s.pass);
        break;
      case "ask":
        here().me++;
        state[s.key] = "";
        break;
      case "set":
        state[s.key] = s.value;
        break;
      case "milestone":
        state[`_m:${s.id}`] = "1";
        break;
      case "if":
        if (matchesIfCondition(s, state[s.key])) queue.unshift(...s.then);
        break;
      case "gate":
        queue.unshift(...(s.otherwise ?? s.then));
        break;
      default:
        break; // reveal, addStats, unlock, append, presence, rename, ending
    }
  }
  return scenes;
}

function countChat(steps: Step[]): ChatBalance {
  const all = playChat(steps);
  // A leading chapter heading or divider opens an empty scene, not dialogue.
  const scenes = all[0] && all[0].them + all[0].me === 0 ? all.slice(1) : all;
  return {
    them: scenes.reduce((n, s) => n + s.them, 0),
    me: scenes.reduce((n, s) => n + s.me, 0),
  };
}

// ---- assembling ------------------------------------------------------------

export type StoryMeta = { title?: string; description?: string; lang?: string; ui?: UiOverrides };

function validateSoundConfig(ctx: Ctx, raw: unknown): void {
  if (!isObj(raw)) {
    report(ctx, ctx.file, "error", `the sound config must contain a JSON object`);
    return;
  }
  fields(ctx, ctx.file, raw, [], ["enabled", "volume", "ambient", "events"]);
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    report(ctx, ctx.file, "error", `"enabled" must be true or false`);
  }
  const level = (value: unknown, where: string): void => {
    if (!isNum(value) || value < 0 || value > 1) report(ctx, where, "error", `volume must be a number from 0 to 1`);
  };
  if (raw.volume !== undefined) level(raw.volume, ctx.file);

  if (raw.ambient !== undefined) {
    if (!isObj(raw.ambient)) {
      report(ctx, ctx.file, "error", `"ambient" must be an object with an optional file name and volume`);
    } else {
      fields(ctx, `${ctx.file} → ambient`, raw.ambient, [], ["default", "volume"]);
      if (raw.ambient.volume !== undefined) level(raw.ambient.volume, `${ctx.file} → ambient`);
      if (raw.ambient.default !== undefined && raw.ambient.default !== null) {
        if (!isText(raw.ambient.default)) {
          report(ctx, `${ctx.file} → ambient`, "error", `"default" must be a sound file name or null`);
        } else {
          const name = raw.ambient.default.replace(/^sounds\//, "");
          if (!ctx.soundFiles?.has(name) && !ctx.soundFiles?.has(`sounds/${name}`)) {
            report(ctx, `${ctx.file} → ambient`, "error", `no ambient sound file called "${raw.ambient.default}" in src/story/assets/sounds/`);
          }
        }
      }
    }
  }

  if (raw.events !== undefined) {
    if (!isObj(raw.events)) {
      report(ctx, ctx.file, "error", `"events" must be an object mapping event names to sounds or null`);
      return;
    }
    const knownEvents = new Set(["them", "me", "choice", "quiz", "stat"]);
    for (const [event, value] of Object.entries(raw.events)) {
      if (!knownEvents.has(event)) report(ctx, ctx.file, "warning", `unknown sound event "${event}" — known events are ${[...knownEvents].join(", ")}`);
      if (value !== null && !isText(value)) {
        report(ctx, `${ctx.file} → events.${event}`, "error", `sound must be a built-in voice, a file name or null`);
      } else if (isText(value) && !ctx.sounds?.has(value) && !ctx.sounds?.has(`sounds/${value}`)) {
        report(ctx, `${ctx.file} → events.${event}`, "warning", `sound "${value}" is not a built-in voice or a file in assets/sounds/`);
      }
    }
  }
}

/**
 * Every `img` step in a script, including the ones behind conditional paths. The
 * folder follows an `add-to-chat` into the chat it writes to, so an appended
 * picture is filed with the character whose thread it lands in.
 */
function eachImage(
  steps: Step[],
  visit: (s: Extract<Step, { t: "img" }>, folder: string) => void,
  folder: string,
): void {
  for (const s of steps) {
    if (s.t === "img") visit(s, folder);
    else if (s.t === "choice") for (const o of s.opts) eachImage(o.then, visit, folder);
    else if (s.t === "if") eachImage(s.then, visit, folder);
    else if (s.t === "gate") {
      eachImage(s.then, visit, folder);
      if (s.otherwise) eachImage(s.otherwise, visit, folder);
    } else if (s.t === "append") eachImage(s.steps, visit, s.chat);
    else if (s.t === "quiz") eachImage(s.pass, visit, folder);
  }
}

/** A picture named `misc_…` belongs to the story, not the character who sends it. */
const isGeneralPicture = (name: string): boolean =>
  (name.split("/").pop() ?? name).startsWith("misc_");

/**
 * Builds the Gallery from every picture a script can send, not just the ones
 * already in a transcript. That is what lets an unrevealed picture appear as a
 * placeholder and makes the missing count honest. A photo can name another
 * folder with `gallery`, and a `misc_…` file name does the same, which is how
 * story pictures can be filed separately from a character's photos in "General".
 */
function buildGallery(
  contacts: Record<string, Contact>,
  order: string[],
  places: Record<string, Place>,
  placeOrder: string[],
): GalleryCategory[] {
  const seen = new Map<string, GalleryImage & { category: string }>();

  const add = (image: GalleryImage, category: string): void => {
    if (seen.has(image.name)) return;
    seen.set(image.name, { ...image, category });
  };

  for (const id of order) {
    const contact = contacts[id];
    if (contact.avatar) {
      add(
        {
          name: contact.avatar,
          alt: `Portrait of ${contact.data.name}`,
          caption: `${contact.data.name} · profile photo`,
          revealed: true,
        },
        id,
      );
    }
    eachImage(
      contact.script,
      (photo, folder) => {
        add(
          { name: photo.name, alt: photo.alt, caption: photo.caption ?? "" },
          photo.gallery ?? (isGeneralPicture(photo.name) ? "misc" : folder),
        );
      },
      id,
    );
  }

  for (const placeId of placeOrder) {
    for (const chat of places[placeId].chats) {
      eachImage(
        chat.script,
        (photo) => {
          add(
            { name: photo.name, alt: photo.alt, caption: photo.caption ?? "" },
            photo.gallery ?? "misc",
          );
        },
        "misc",
      );
    }
  }

  const byCategory = new Map<string, GalleryImage[]>();
  for (const id of [...order, "misc"]) byCategory.set(id, []);
  for (const entry of seen.values()) {
    const { category, ...image } = entry;
    const list = byCategory.get(category) ?? byCategory.get("misc");
    list?.push(image);
  }

  return [...byCategory.entries()]
    .filter(([, images]) => images.length > 0)
    .map(([id, images]) => ({
      id,
      title: id === "misc" ? "General" : (contacts[id]?.data.name ?? id),
      images,
    }));
}

type CharacterGroup = {
  id: string;
  profileFile?: string;
  profile?: unknown;
  chapters: ChapterSource[];
};

/**
 * Groups `characters/<id>/*.json` into one profile and its numbered chapters.
 * The folder is the character id, so these paths also keep errors readable.
 */
function groupCharacters(files: Record<string, unknown>, issues: Issue[]): Map<string, CharacterGroup> {
  const groups = new Map<string, CharacterGroup>();

  for (const file of Object.keys(files).sort()) {
    const parts = file.split("/");
    if (parts.length !== 2) {
      issues.push({
        file,
        where: file,
        level: "error",
        message:
          parts.length === 1
            ? `characters live in a folder named after them — move this file to characters/<id>/<id>.json`
            : `character files must sit directly inside the character folder`,
      });
      continue;
    }

    const [id, name] = parts;
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
      issues.push({
        file,
        where: file,
        level: "error",
        message: `folder names may only use letters, numbers and dashes (no spaces) — this file was skipped`,
      });
      continue;
    }

    let group = groups.get(id);
    if (!group) {
      group = { id, chapters: [] };
      groups.set(id, group);
    }

    if (name === `${id}.json`) {
      if (group.profileFile) {
        issues.push({
          file,
          where: file,
          level: "error",
          message: `two profile files in ${id}/ — keep ${id}.json and remove this one`,
        });
      } else {
        group.profileFile = file;
        group.profile = files[file];
      }
      continue;
    }

    const chapter = /^chapter(\d+)\.json$/i.exec(name);
    if (!chapter) {
      issues.push({
        file,
        where: file,
        level: "error",
        message: `unexpected file — a character folder holds ${id}.json plus chapter1.json, chapter2.json, …`,
      });
      continue;
    }

    const number = Number(chapter[1]);
    if (!Number.isInteger(number) || number < 1) {
      issues.push({
        file,
        where: file,
        level: "error",
        message: `chapter numbers start at 1, so this file was skipped`,
      });
      continue;
    }
    if (group.chapters.some((c) => c.number === number)) {
      issues.push({
        file,
        where: file,
        level: "error",
        message: `two files are chapter ${number} — keep one`,
      });
      continue;
    }
    group.chapters.push({ file, number, data: files[file] });
  }

  return groups;
}

/**
 * Builds the cast from raw story files.
 *
 * @param characters path inside characters/ (e.g. `alex/chapter1.json`) -> parsed JSON
 * @param places     file name (e.g. `cafe.json`) -> parsed JSON
 * @param assets     picture name (file name without extension) -> URL
 * @param meta       parsed src/story/story.json, if present
 * @param soundFiles sound file names in assets/sounds/, e.g. "sounds/ding"
 */
export function buildStory(
  characters: Record<string, unknown>,
  places: Record<string, unknown>,
  assets: Record<string, string>,
  meta?: unknown,
  soundFiles?: string[],
  soundConfig?: unknown,
): {
  cast: Cast;
  issues: Issue[];
  story: StoryMeta;
  balance: Record<string, ChatBalance>;
  placeBalance: Record<string, ChatBalance>;
} {
  const issues: Issue[] = [];
  const assetNames = new Set(Object.keys(assets));
  // A sound step may name a built-in voice or a file beside sounds.json; the
  // file may be written with or without its sounds/ folder.
  const soundNames = new Set<string>(VOICE_NAMES);
  const soundAssetNames = new Set<string>();
  for (const name of soundFiles ?? []) {
    soundNames.add(name);
    soundNames.add(name.split("/").pop() ?? name);
    const withoutRoot = name.replace(/^sounds\//, "");
    soundAssetNames.add(withoutRoot);
    soundAssetNames.add(`sounds/${withoutRoot}`);
    soundAssetNames.add(withoutRoot.split("/").pop() ?? withoutRoot);
  }

  if (soundConfig !== undefined) {
    validateSoundConfig(
      { file: "assets/sounds/sounds.json", issues, ids: new Set(), assets: assetNames, sounds: soundNames, soundFiles: soundAssetNames },
      soundConfig,
    );
  }

  const placeTargets = new Set(Object.keys(places).map((fileName) => fileName.replace(/\.json$/i, "")));
  const placeChatTargets = new Map<string, Set<string>>();
  for (const [fileName, raw] of Object.entries(places)) {
    const placeId = fileName.replace(/\.json$/i, "");
    const chatIds = new Set<string>();
    if (isObj(raw) && Array.isArray(raw.chats)) {
      for (const chat of raw.chats) {
        if (isObj(chat) && isText(chat.id)) chatIds.add(chat.id.trim());
      }
    }
    placeChatTargets.set(placeId, chatIds);
  }

  // Character ids are the folder names, so the full set is known up front and
  // cross-references (unlock, add-to-chat, needs.inChat) can be checked inline.
  const groups = groupCharacters(characters, issues);
  const ids = new Set(groups.keys());
  const built = new Map<string, Built>();
  for (const [id, group] of groups) {
    if (!group.profileFile) {
      issues.push({
        file: `${id}/${id}.json`,
        where: `${id}/${id}.json`,
        level: "error",
        message: `missing the character profile — every folder needs a ${id}.json from which to read the name`,
      });
      continue;
    }
    const ctx: Ctx = {
      file: group.profileFile,
      issues,
      ids,
      assets: assetNames,
      sounds: soundNames,
      soundFiles: soundAssetNames,
      placeIds: placeTargets,
      placeChats: placeChatTargets,
    };
    if (!isObj(group.profile)) {
      report(ctx, group.profileFile, "error", `the file must contain a JSON object`);
      continue;
    }
    const entry = takeCharacter(ctx, id, group.profile, group.chapters);
    if (entry) built.set(id, entry);
  }

  // Place ids work the same way: the file name is the id, and a place can only
  // point at characters that were already found.
  const placeIds = new Set<string>();
  for (const fileName of Object.keys(places)) {
    const id = fileName.replace(/\.json$/i, "");
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
      issues.push({
        file: fileName,
        where: fileName,
        level: "error",
        message: `file names may only use letters, numbers and dashes (no spaces) — this file was skipped`,
      });
      continue;
    }
    if (placeIds.has(id)) {
      issues.push({ file: fileName, where: fileName, level: "error", message: `two files share the id "${id}"` });
      continue;
    }
    placeIds.add(id);
  }

  const builtPlaces = new Map<string, Place>();
  for (const [fileName, raw] of Object.entries(places)) {
    const id = fileName.replace(/\.json$/i, "");
    if (!placeIds.has(id) || builtPlaces.has(id)) continue;
    const ctx: Ctx = {
      file: fileName,
      issues,
      ids,
      assets: assetNames,
      sounds: soundNames,
      soundFiles: soundAssetNames,
      placeIds: placeTargets,
      placeChats: placeChatTargets,
    };
    if (!isObj(raw)) {
      report(ctx, fileName, "error", `the file must contain a JSON object`);
      continue;
    }
    const place = takePlace(ctx, id, raw);
    if (place) builtPlaces.set(id, place);
  }

  // Second pass: every `reveal` must match something on the target profile.
  const balance: Record<string, ChatBalance> = {};
  for (const [id, entry] of built) {
    const ctx: Ctx = { file: entry.profileFile, issues, ids, assets: assetNames, sounds: soundNames, soundFiles: soundAssetNames };
    for (const chapter of entry.chapters) {
      checkReveals({ ...ctx, file: chapter.file }, id, chapter.steps, built, 0);
    }
    balance[id] = countChat(entry.contact.script);
  }

  validateStoryReferences(built, builtPlaces, ids, assetNames, soundNames, soundAssetNames, issues);

  // Keep an indicative speaker split for each place chat as well.
  const placeBalance: Record<string, ChatBalance> = {};
  for (const [placeId, place] of builtPlaces) {
    for (const chat of place.chats) {
      const key = `${placeId}/${chat.id}`;
      placeBalance[key] = countChat(chat.script);
    }
  }

  const contacts: Record<string, Contact> = {};
  const profiles: Record<string, Profile> = {};
  for (const [id, entry] of built) {
    contacts[id] = entry.contact;
    if (entry.profile) profiles[id] = entry.profile;
  }
  const order = [...built.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  const placesOut: Record<string, Place> = {};
  for (const [id, place] of builtPlaces) placesOut[id] = place;
  const placeOrder = [...builtPlaces.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
    .map(([id]) => id);

  const gallery = buildGallery(contacts, order, placesOut, placeOrder);

  let story: StoryMeta = {};
  if (meta !== undefined) {
    if (!isObj(meta)) {
      issues.push({ file: "story.json", where: "story.json", level: "error", message: "the file must contain a JSON object" });
    } else {
      if (meta.title !== undefined && !isText(meta.title)) {
        issues.push({ file: "story.json", where: "story.json", level: "error", message: `"title" must be text` });
      } else if (isText(meta.title)) {
        story.title = meta.title;
      }
      if (meta.description !== undefined && !isText(meta.description)) {
        issues.push({ file: "story.json", where: "story.json", level: "error", message: `"description" must be text` });
      } else if (isText(meta.description)) {
        story.description = meta.description;
      }
      if (meta.lang !== undefined && (!isText(meta.lang) || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(meta.lang))) {
        issues.push({ file: "story.json", where: "story.json", level: "error", message: `"lang" must be a language tag such as "en" or "en-GB"` });
      } else if (isText(meta.lang)) {
        story.lang = meta.lang;
      }
      if (meta.ui !== undefined) {
        if (!isObj(meta.ui)) {
          issues.push({ file: "story.json", where: "story.json → ui", level: "error", message: `"ui" must be an object of supported interface keys and translated text` });
        } else {
          const ui: UiOverrides = {};
          for (const [key, value] of Object.entries(meta.ui)) {
            if (!Object.hasOwn(UI_MESSAGES, key)) {
              issues.push({ file: "story.json", where: `story.json → ui.${key}`, level: "error", message: `unknown interface key "${key}"` });
            } else if (!isText(value)) {
              issues.push({ file: "story.json", where: `story.json → ui.${key}`, level: "error", message: `translation must be non-empty text` });
            } else {
              ui[key as UiKey] = value;
            }
          }
          story.ui = ui;
        }
      }
      for (const key of Object.keys(meta)) {
        if (key !== "title" && key !== "description" && key !== "lang" && key !== "ui") {
          issues.push({
            file: "story.json",
            where: "story.json",
            level: "error",
            message: `unknown field "${key}"${nearest(key, ["title", "description"])}`,
          });
        }
      }
    }
  }

  return {
    cast: { contacts, order, profiles, places: placesOut, placeOrder, assets, gallery },
    issues,
    story,
    balance,
    placeBalance,
  };
}
