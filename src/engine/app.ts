// The app itself: views, rendering and the step runner.
//
// Engine code — story authors never open this file. The cast arrives already
// built (src/engine/story.ts) and this module only knows how to play it.

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import hiddenPhoto from "./assets/hidden.svg";
import attractionIcon from "./assets/stat-attraction.svg";
import bondIcon from "./assets/stat-bond.svg";
import feelingsIcon from "./assets/stat-feelings.svg";
import trustIcon from "./assets/stat-trust.svg";

import type { Issue, StoryMeta } from "./story";
import type { Cast, ChoiceOpt, Contact, Item, Place, PlaceChat, QuizQ, RevealFact, Stat, Stats, Step } from "./types";
import { STAT_MAX, STAT_START, matchesIfCondition } from "./types";
import { createSounds } from "./sounds";
import type { SoundConfig, SoundPlayer } from "./sounds";
import { RunGate } from "./run-gate";
import { createGameStorage, createMemoryStorage } from "./storage";
import type { KeyValueStore } from "./storage";
import { makeBackup, parseBackup } from "./backup";
import type { GameBackup } from "./backup";
import { createTranslator } from "./i18n";
import type { UiKey } from "./i18n";
import { messageDelays } from "./pacing";

const STAT_META: { key: Stat; icon: string }[] = [
  { key: "trust", icon: trustIcon },
  { key: "feelings", icon: feelingsIcon },
  { key: "attraction", icon: attractionIcon },
  { key: "bond", icon: bondIcon },
];
const STAT_LABEL_KEYS: Record<Stat, UiKey> = {
  trust: "stat.trust",
  feelings: "stat.feelings",
  attraction: "stat.attraction",
  bond: "stat.bond",
};

/** The sound files and the config that maps events to them. */
export type SoundSetup = {
  /** Sound file name (without extension) -> bundled URL. */
  files: Record<string, string>;
  /** The parsed `assets/sounds/sounds.json`, if the story has one. */
  config?: unknown;
};

export function startApp(cast: Cast, issues: Issue[], story: StoryMeta, sound?: SoundSetup): void {
  if (!document.getElementById("main")) return;
  const tr = createTranslator(story.ui);

  let backingStorage: KeyValueStore;
  let storagePersistent = true;
  try {
    backingStorage = window.localStorage;
  } catch {
    backingStorage = createMemoryStorage();
    storagePersistent = false;
  }
  const previewMode = new URLSearchParams(window.location.search).has("studio-preview");
  const storage = createGameStorage(backingStorage, previewMode ? "sr-studio-game:" : "");

  const {
    contacts: CONTACTS,
    order: ORDER_IDS,
    profiles: PROFILES,
    places: PLACES,
    placeOrder: PLACE_IDS,
    assets: IMG_URLS,
    gallery: GALLERY,
  } = cast;

  const viewList = document.getElementById("view-list") as HTMLElement;
  const viewChat = document.getElementById("view-chat") as HTMLElement;
  const chatlist = document.getElementById("chatlist") as HTMLElement;
  const logEl = document.getElementById("log") as HTMLElement;
  const boxEl = document.getElementById("choices") as HTMLElement;
  const choiceStatus = document.getElementById("choice-status") as HTMLElement;
  const formEl = document.getElementById("bar") as HTMLFormElement;
  const fieldEl = document.getElementById("field") as HTMLInputElement;
  const sendEl = document.getElementById("send") as HTMLButtonElement;
  const presenceEl = document.getElementById("presence") as HTMLElement;
  const avatarEl = document.getElementById("avatar") as HTMLElement;
  const chatnameEl = document.getElementById("chatname") as HTMLElement;
  const backBtn = document.getElementById("back") as HTMLButtonElement;
  const restartBtn = document.getElementById("restart") as HTMLButtonElement;
  const restartDialog = document.getElementById("restart-confirm") as HTMLDialogElement;
  const restartCancel = document.getElementById("restart-cancel") as HTMLButtonElement;
  const restartConfirm = document.getElementById("restart-confirm-ok") as HTMLButtonElement;

  /**
   * A thread is anything the chat runner can play: a character chat or a
   * conversation in a place. The data is a getter so restarting a contact can
   * replace its saved object without breaking a thread someone is holding.
   */
  type ThreadData = {
    transcript: Item[];
    queue: Step[];
    state: Record<string, string>;
    stats: Stats;
    /** The story clock, in minutes since midnight. */
    clock?: number;
    /** Unspent message-length units toward the next story-clock minute (0–49). */
    clockUnits?: number;
    /** Place chats only. */
    unlocked?: boolean;
    done?: boolean;
  };

  type Scene = { place: Place; chat: PlaceChat };

  type Thread = {
    readonly data: ThreadData;
    readonly storeKey: string;
    readonly contact: Contact | null;
    readonly scene: Scene | null;
  };

  /** A save slot stores whole thread payloads, keyed by their normal store key. */
  type SaveThread = ThreadData & { name?: string; initial?: string };
  type SaveFile = {
    version: 1;
    savedAt: string;
    /** Device-wide player name at the time of the snapshot. Optional for old saves. */
    playerName?: string;
    threads: Record<string, SaveThread>;
  };

  const contactThread = (c: Contact): Thread => ({
    get data() {
      return c.data;
    },
    storeKey: c.storeKey,
    contact: c,
    scene: null,
  });

  const sceneThread = (place: Place, chat: PlaceChat): Thread => ({
    get data() {
      return chat.data;
    },
    storeKey: chat.storeKey,
    contact: null,
    scene: { place, chat },
  });

  const runGate = new RunGate();
  const pendingDelays = new Set<() => void>();
  let current: Thread | null = null;
  let cancelInteraction: (() => void) | null = null;

  function cancelDelays(): void {
    for (const cancel of [...pendingDelays]) cancel();
  }

  const beginRun = (): number => {
    const token = runGate.begin();
    cancelDelays();
    return token;
  };

  function cancelRun(): void {
    runGate.cancel();
    cancelDelays();
  }

  function cancelPendingInteraction(): void {
    const cancel = cancelInteraction;
    cancelInteraction = null;
    cancel?.();
  }

  // ---- sound ---------------------------------------------------------------
  //
  // The story decides what plays: a message from a character, one from the player, a
  // choice, a quiz, a stat, and an ambient track for the game or for a place.
  // No config, no files, or a browser that blocks audio all mean silence.
  const sounds: SoundPlayer = createSounds(sound?.files ?? {}, (sound?.config ?? undefined) as SoundConfig | undefined);
  // ---- volume --------------------------------------------------------------
  //
  // Three sliders in Settings: the master, the ambience and the one-shot sound
  // effects. Each is a proportion of the story's own level, so a story that
  // ships quiet stays quiet at 100%. Like the text speed, the choice lives on
  // the device rather than in a save.
  const VOLUME_DEFAULT = 100;
  type VolumeKey = "master" | "ambient" | "effects";
  const VOLUME_KEYS: Record<VolumeKey, string> = {
    master: "sr-vol-master",
    ambient: "sr-vol-ambient",
    effects: "sr-vol-effects",
  };

  const readVolume = (key: VolumeKey): number => {
    try {
      const raw = storage.getItem(VOLUME_KEYS[key]);
      const value = raw === null ? NaN : Number(raw);
      if (Number.isInteger(value) && value >= 0 && value <= 100) return value;
    } catch { /* ignore */ }
    return VOLUME_DEFAULT;
  };

  // Sound used to be one switch. A player who had it off gets all three
  // sliders at zero; everyone else keeps the defaults.
  const migrateSound = (): void => {
    try {
      const legacy = storage.getItem("sr-sound");
      if (legacy === null) return;
      if (storage.getItem(VOLUME_KEYS.master) === null) {
        const level = legacy === "off" ? 0 : VOLUME_DEFAULT;
        for (const key of Object.values(VOLUME_KEYS)) storage.setItem(key, String(level));
      }
      storage.removeItem("sr-sound");
    } catch { /* ignore */ }
  };
  migrateSound();

  const volumes: Record<VolumeKey, number> = {
    master: readVolume("master"),
    ambient: readVolume("ambient"),
    effects: readVolume("effects"),
  };

  const applyVolumes = (): void => {
    sounds.setVolumes({
      master: volumes.master / 100,
      ambient: volumes.ambient / 100,
      effects: volumes.effects / 100,
    });
  };
  applyVolumes();

  // Pictures may bring a second, more revealing version (`nsfw_version` in a
  // photo step). SFW is the default; this is a device preference like the rest
  // and only chooses which picture is drawn.
  let nsfwMode = false;
  try { nsfwMode = storage.getItem("sr-nsfw") === "1"; } catch { /* ignore */ }

  // The player's name. An `ask` for the key "name" saves it here, on the
  // device, so every chat can say it: the tutorial can take it once and other
  // chats can confirm or change it. An `ask` for a name already
  // known arrives with the field filled in.
  let playerName = "";
  try { playerName = (storage.getItem("sr-name") ?? "").trim(); } catch { /* ignore */ }

  // Browsers only allow audio after a gesture, so the first tap unlocks it.
  const unlockSound = (): void => sounds.unlock();
  window.addEventListener("pointerdown", unlockSound, { once: true, passive: true });
  window.addEventListener("keydown", unlockSound, { once: true });

  // ---- the story clock ------------------------------------------------------
  //
  // The phone's clock says when the player opened the app, which has nothing to
  // do with when a message was sent: a text read at three in the morning is
  // still a text from the evening. So every bubble carries a story time. The
  // story sets the clock (a chapter's "at"); message text and image captions
  // add units to a per-thread accumulator, with each 50 units advancing it by
  // one minute. A text's `duration` remains an explicit gap override.
  const CLOCK_FALLBACK = 9 * 60; // 09:00, for a thread that has not been seeded
  const CLOCK_UNITS_PER_MINUTE = 50;
  const MESSAGE_CLOCK_UNITS = 10;
  const IMAGE_CLOCK_UNITS = 30;

  const wordCount = (text: string): number => text.match(/\S+/g)?.length ?? 0;
  const restoredClockUnits = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value) % CLOCK_UNITS_PER_MINUTE
      : 0;

  /** Minutes since midnight as a 24-hour clock, e.g. 1092 -> "18:12". */
  const fmtClock = (minutes: number): string => {
    const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };

  const clockOf = (t: Thread): number => t.data.clock ?? CLOCK_FALLBACK;

  /** The time on a bubble; its content advances time for the following bubble. */
  function stamp(
    t: Thread,
    at: number | undefined,
    progress?: { units: number; duration?: number },
  ): string {
    if (at !== undefined) {
      t.data.clock = at;
      t.data.clockUnits = 0;
    }
    const label = fmtClock(clockOf(t));
    if (progress?.duration !== undefined) {
      // An explicit duration owns this gap, so don't count this message again.
      t.data.clock = clockOf(t) + progress.duration;
      t.data.clockUnits = 0;
    } else if (progress) {
      const total = (t.data.clockUnits ?? 0) + progress.units;
      const minutes = Math.floor(total / CLOCK_UNITS_PER_MINUTE);
      t.data.clockUnits = total % CLOCK_UNITS_PER_MINUTE;
      if (minutes > 0) t.data.clock = clockOf(t) + minutes;
    }
    return label;
  }

  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // A contact's avatar is their initial on their own colour (story.json's
  // "color"), so the letter inside cannot be a fixed white. Luminance decides:
  // black and white cross over at 0.179, where both read at 4.6:1 or better,
  // so picking the better of the two always clears WCAG AA for large bold text.
  const luminance = (hexColor: string): number => {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hexColor.trim());
    if (!m) return 0;
    const s = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
    const chan = (i: number): number => {
      const v = parseInt(s.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
  };

  const avatarInk = (bg: string): string => (luminance(bg) > 0.179 ? "#000000" : "#ffffff");

  // A character file may name a portrait ("avatar": "portraits/alex"), which fills
  // that same circle: chat list, thread header, Characters tab and profile — and
  // opens the Gallery, which is why a fresh save already has one picture. The
  // initial on the contact's colour stays the fallback, so a story with no art
  // (and a scrap of a story that took its pictures with it) still reads.
  const avatarUrl = (c: Contact): string | undefined => (c.avatar ? IMG_URLS[c.avatar] : undefined);

  // A save can outlive a picture's folder. If a transcript names a file that
  // has moved since it was written, resolve it by a unique path suffix rather
  // than losing the photo; current steps always match exactly first. The last
  // fallback covers a rename that changed the leading word too: match the
  // unique tail of the old file name.
  const resolveAssetName = (name: string): string | undefined => {
    if (IMG_URLS[name]) return name;
    const suffix = `/${name}`;
    const pathMatches = Object.keys(IMG_URLS).filter((key) => key.endsWith(suffix));
    if (pathMatches.length === 1) return pathMatches[0];

    const base = name.split("/").pop() ?? name;
    const cut = base.indexOf("_");
    const tail = cut >= 0 ? base.slice(cut + 1) : "";
    if (tail) {
      const matches = Object.keys(IMG_URLS).filter((key) => {
        const keyBase = key.split("/").pop() ?? key;
        return keyBase.endsWith(`_${tail}`);
      });
      if (matches.length === 1) return matches[0];
    }
    return undefined;
  };

  // Which picture a photo actually shows: the second version when the content
  // setting is NSFW and the step carries one, otherwise the normal picture.
  // Both names stay in the transcript, so changing the setting redraws photos
  // that were already sent instead of baking the choice into the save.
  const pictureName = (img: Item["img"] | undefined): string | undefined => {
    if (!img) return undefined;
    if (nsfwMode && img.nsfwVersion) {
      const variant = resolveAssetName(img.nsfwVersion);
      if (variant) return variant;
    }
    return resolveAssetName(img.name) ?? img.name;
  };

  const avatarInner = (c: Contact, px: number): string => {
    const url = avatarUrl(c);
    return url
      ? `<img src="${url}" alt="" width="${px}" height="${px}" class="h-full w-full rounded-full object-cover" />`
      : esc(c.data.initial);
  };

  /** The style that puts the initial on the contact's colour — portraits don't need it. */
  const avatarStyle = (c: Contact): string =>
    avatarUrl(c) ? "" : ` style="background:${c.color};color:${avatarInk(c.color)}"`;

  /** An avatar circle built into a list of rows (chat list, Characters tab). */
  const avatarSpan = (c: Contact, size: string, px: number): string =>
    `<span aria-hidden="true" class="flex ${size} shrink-0 items-center justify-center rounded-full text-xl font-bold"${avatarStyle(c)}>${avatarInner(c, px)}</span>`;

  /** Fills an avatar element that stays on screen (thread header, profile). */
  const paintAvatar = (el: HTMLElement, c: Contact, px: number): void => {
    if (avatarUrl(c)) {
      el.textContent = "";
      el.removeAttribute("style");
      el.innerHTML = avatarInner(c, px);
    } else {
      el.textContent = c.data.initial;
      el.setAttribute("style", `background:${c.color};color:${avatarInk(c.color)}`);
    }
  };

  const scroll = (): void => {
    logEl.scrollTop = logEl.scrollHeight;
  };

  const saveThread = (t: Thread): void => {
    try {
      storage.setItem(t.storeKey, JSON.stringify(t.data));
    } catch {
      /* storage blocked — game still works */
    }
  };

  const saveChat = (c: Contact): void => saveThread(contactThread(c));

  const loadThread = (t: Thread): void => {
    try {
      const raw = storage.getItem(t.storeKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<ThreadData> & Partial<Contact["data"]>;
      t.data.transcript = saved.transcript ?? [];
      t.data.queue = saved.queue ?? [];
      t.data.state = saved.state ?? {};
      t.data.stats = saved.stats ?? { ...STAT_START };
      if (typeof saved.clock === "number" && Number.isFinite(saved.clock)) t.data.clock = saved.clock;
      t.data.clockUnits = restoredClockUnits(saved.clockUnits);
      if (t.scene) {
        t.data.unlocked = saved.unlocked ?? t.scene.chat.startUnlocked;
        t.data.done = saved.done === true;
      }
      if (t.contact) {
        t.contact.data.name = saved.name ?? t.contact.name;
        t.contact.data.initial = saved.initial ?? t.contact.initial;
        t.contact.data.unlocked = saved.unlocked ?? ((saved.transcript?.length ?? 0) > 0);
      }
    } catch {
      /* corrupt save — start fresh */
    }
  };

  const loadChat = (c: Contact): void => loadThread(contactThread(c));

  const fill = (t: Thread, s: string): string => {
    const hostName = t.scene ? CONTACTS[t.scene.chat.host]?.data.state.name : undefined;
    // The device-wide name wins; the chat's own answer is the fallback for a
    // save from before the name was shared.
    return s.replaceAll("{name}", playerName || t.data.state.name || hostName || tr("chat.friend"));
  };

  const linkify = (s: string): string =>
    esc(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="underline">$1</a>');

  const isBigEmoji = (s: string): boolean =>
    /^(\p{Extended_Pictographic}|\u200d|️)+$/u.test(s) && [...s].length <= 4;

  function bubbleEl(item: Item, html: string, scene: boolean): HTMLElement {
    const from = item.from;
    const row = document.createElement("div");
    if (from === "sys") {
      // A notice carries its time only when the story named that moment — a
      // chapter heading does, an "end of story" line does not.
      const when = item.pinned && item.time ? ` · ${esc(item.time)}` : "";
      row.innerHTML = `<div class="bubble-in mx-auto w-fit max-w-[90%] rounded-lg bg-chat-800 px-3 py-1 text-center text-xs text-ink-300">${html}${when}</div>`;
      return row;
    }
    const big = !scene && isBigEmoji(html) && from === "them";
    const side = from === "me" ? "justify-end" : "justify-start";
    const color = from === "me" ? "bg-out-600 rounded-tr-md" : "bg-chat-800 rounded-tl-md";
    const label =
      scene && from === "them" && item.speaker
        ? `<span class="mb-0.5 block text-xs font-semibold text-tick-400">${esc(item.speaker)}</span>`
        : "";
    // The story time sits inside the bubble, next to the read tick.
    const meta = `<span class="mt-1 block text-right text-xs text-ink-300">${item.time ?? ""}${from === "me" ? ' <span class="ticks">✓</span>' : ""}</span>`;
    const body = big
      ? `<span class="text-5xl">${html}</span>`
      : `${label}<span>${html}</span>${meta}`;
    row.className = `bubble-in flex ${side}`;
    row.innerHTML = `<div class="max-w-[80%] rounded-2xl ${color} px-3 py-2 text-[15px]">${body}</div>`;
    if (from === "me" && !big) {
      const ticks = row.querySelector(".ticks");
      if (ticks) {
        window.setTimeout(() => {
          ticks.textContent = "✓✓";
          ticks.classList.add("text-tick-400");
        }, 800);
      }
    }
    return row;
  }

  function renderItem(t: Thread, item: Item, instant: boolean): void {
    const el = item.chapter
      ? chapterDivider(t, item)
      : item.divider
      ? threadDivider(t, item)
      : item.img
      ? renderImgBubble(t, item, instant)
      : bubbleEl(
          item,
          item.from === "me" || item.from === "sys" ? esc(item.text) : linkify(fill(t, item.text)),
          t.scene !== null,
        );
    if (instant) {
      const ticks = el.querySelector(".ticks");
      if (ticks) {
        ticks.textContent = "✓✓";
        ticks.classList.add("text-tick-400");
      }
    }
    logEl.appendChild(el);
  }

  function post(
    t: Thread,
    from: Item["from"],
    text: string,
    speaker?: string,
    at?: number,
    duration?: number,
  ): void {
    const item: Item = { from, text };
    item.time = stamp(
      t,
      at,
      from === "sys" ? undefined : { units: MESSAGE_CLOCK_UNITS + wordCount(text), duration },
    );
    if (at !== undefined) item.pinned = true;
    if (speaker) item.speaker = speaker;
    t.data.transcript.push(item);
    renderItem(t, item, false);
    if (from === "them") sounds.play("them");
    if (from === "me") sounds.play("me");
    saveThread(t);
    if (t.contact) renderList();
    scroll();
  }

  /** Leaves the chapter break in the transcript as a divider. */
  function postChapter(t: Thread, step: Extract<Step, { t: "chapter" }>): void {
    const item: Item = {
      from: "sys",
      text: `Chapter ${step.number}`,
      chapter: { number: step.number, title: step.text, time: step.time },
    };
    item.time = stamp(t, step.at);
    if (step.at !== undefined) item.pinned = true;
    t.data.transcript.push(item);
    renderItem(t, item, false);
    saveThread(t);
    if (t.contact) renderList();
    scroll();
  }

  /** Leaves a plain divider line in the transcript. */
  function postDivider(t: Thread, step: Extract<Step, { t: "divider" }>): void {
    const item: Item = { from: "sys", text: step.text, divider: { text: step.text } };
    item.time = stamp(t, step.at);
    if (step.at !== undefined) item.pinned = true;
    t.data.transcript.push(item);
    renderItem(t, item, false);
    saveThread(t);
    if (t.contact) renderList();
    scroll();
  }

  function renderImgBubble(t: Thread, item: Item, instant: boolean): HTMLElement {
    const name = pictureName(item.img) ?? "";
    const url = IMG_URLS[name] ?? "";
    const alt = item.img?.alt ?? "";
    const from = item.from;
    const side = from === "me" ? "justify-end" : "justify-start";
    const color = from === "me" ? "bg-out-600 rounded-tr-md" : "bg-chat-800 rounded-tl-md";
    const caption = item.text ? `<span class="block px-1 pt-1 text-[15px]">${esc(fill(t, item.text))}</span>` : "";
    const meta = `<span class="block px-1 pb-0.5 pt-1 text-right text-xs text-ink-300">${item.time ?? ""}${from === "me" ? ' <span class="ticks">✓</span>' : ""}</span>`;
    const row = document.createElement("div");
    row.className = `bubble-in flex ${side}`;
    // The picture sits in a button so it can be opened full size with a tap,
    // a click or the keyboard — the alt text is the button's label.
    row.innerHTML = `<div class="max-w-[75%] rounded-2xl ${color} p-1.5"><button type="button" class="block cursor-zoom-in rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tick-400" aria-label="Open photo: ${esc(alt)}"><img src="${url}" alt="" width="864" height="1536" class="block h-auto w-auto max-h-[60vh] max-w-full rounded-xl object-contain" /></button>${caption}${meta}</div>`;
    const shot = row.querySelector("button") as HTMLButtonElement;
    shot.addEventListener("click", () => {
      const where = t.contact ? t.contact.data.name : t.scene?.place.name ?? "";
      openPhoto(url, alt, `${item.text ? item.text + " · " : ""}${where}${item.time ? " · " + item.time : ""}`, shot);
    });
    if (instant && from === "me") {
      const ticks = row.querySelector(".ticks");
      if (ticks) {
        ticks.textContent = "✓✓";
        ticks.classList.add("text-tick-400");
      }
    }
    return row;
  }

  function postImg(t: Thread, from: Item["from"], name: string, alt: string, nsfwVersion: string | undefined, caption: string, at?: number): void {
    const item: Item = { from, text: caption, img: { name, alt, nsfwVersion } };
    item.time = stamp(t, at, { units: IMAGE_CLOCK_UNITS + wordCount(caption) });
    if (at !== undefined) item.pinned = true;
    t.data.transcript.push(item);
    logEl.appendChild(renderImgBubble(t, item, false));
    if (from === "them") sounds.play("them");
    if (from === "me") sounds.play("me");
    saveThread(t);
    if (t.contact) renderList();
    scroll();
  }

  function startTyping(t: Thread): HTMLElement {
    // There is no presence line in a place chat, so the dots do the work alone.
    if (!t.scene) presenceEl.textContent = tr("chat.typing");
    const el = document.createElement("div");
    el.className = "bubble-in flex justify-start";
    el.innerHTML = `<div class="rounded-2xl rounded-tl-md bg-chat-800 px-4 py-3"><span class="typing-dot inline-block h-2 w-2 rounded-full bg-ink-300"></span> <span class="typing-dot inline-block h-2 w-2 rounded-full bg-ink-300"></span> <span class="typing-dot inline-block h-2 w-2 rounded-full bg-ink-300"></span></div>`;
    logEl.appendChild(el);
    scroll();
    return el;
  }

  async function sayImg(
    t: Thread,
    myGen: number,
    from: Item["from"],
    name: string,
    alt: string,
    nsfwVersion: string | undefined,
    caption: string,
    typing?: number,
    pause?: number,
    at?: number,
  ): Promise<void> {
    const defaults = messageDelays(caption);
    // The player's own images land instantly on their side — no typing indicator.
    if (from === "me") {
      postImg(t, "me", name, alt, nsfwVersion, caption, at);
      await beat(pause ?? defaults.pause);
      return;
    }
    const el = startTyping(t);
    await beat(typing ?? defaults.typing);
    el.remove();
    if (!runGate.isCurrent(myGen)) return;
    if (!t.scene) presenceEl.textContent = tr("chat.online");
    postImg(t, "them", name, alt, nsfwVersion, caption, at);
    await beat(pause ?? defaults.pause);
  }

  // ---- text speed ----------------------------------------------------------
  //
  // Five pace multipliers apply equally to calculated beats and explicit delays.
  const SPEED_IDS = ["slow", "normal", "quick", "speedy", "skip"] as const;
  type Speed = (typeof SPEED_IDS)[number];
  const SPEED_PRESETS: Record<Speed, { factor: number; note: UiKey }> = {
    slow: { factor: 2.5, note: "speed.slowNote" },
    normal: { factor: 2, note: "speed.normalNote" },
    quick: { factor: 1, note: "speed.quickNote" },
    speedy: { factor: 2 / 3, note: "speed.speedyNote" },
    skip: { factor: 0.4, note: "speed.skipNote" },
  };
  const isSpeed = (value: string): value is Speed => (SPEED_IDS as readonly string[]).includes(value);

  let speed: Speed = "normal";
  try {
    const stored = storage.getItem("sr-text-speed");
    if (stored && isSpeed(stored)) speed = stored;
    else if (stored !== null) {
      // Older settings stored a 1–10 number. Map the old paces onto the presets:
      // 1 was the default, 2 as written, 3 faster, and 4+ the replay pace.
      const old = Number(stored);
      if (Number.isInteger(old) && old >= 1 && old <= 10) {
        speed = old <= 1 ? "normal" : old === 2 ? "quick" : old === 3 ? "speedy" : "skip";
        storage.setItem("sr-text-speed", speed);
      }
    }
  } catch { /* ignore */ }

  /** How long a beat lasts at the current pace. */
  const speedFactor = (): number => SPEED_PRESETS[speed].factor;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      let timer = 0;
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        pendingDelays.delete(cancel);
        resolve();
      };
      const cancel = (): void => finish();
      pendingDelays.add(cancel);
      timer = window.setTimeout(finish, ms);
    });

  /** A text beat: the gap between two messages, scaled by the text speed. */
  const beat = (ms: number): Promise<void> => sleep(Math.max(0, Math.round(ms * speedFactor())));

  async function sayThem(
    t: Thread,
    myGen: number,
    text: string,
    typing?: number,
    pause?: number,
    speaker?: string,
    at?: number,
    duration?: number,
  ): Promise<void> {
    const defaults = messageDelays(text);
    const dots = startTyping(t);
    await beat(typing ?? defaults.typing);
    dots.remove();
    if (!runGate.isCurrent(myGen)) return;
    if (!t.scene) presenceEl.textContent = tr("chat.online");
    post(t, "them", text, speaker, at, duration);
    await beat(pause ?? defaults.pause);
  }

  function cardShell(): HTMLElement {
    const card = document.createElement("div");
    card.className = "fade-card mx-auto my-2 w-fit max-w-full rounded-2xl border border-chat-700 bg-chat-800 px-5 py-3 text-center shadow-sm";
    return card;
  }

  /** Plays a brief fade card; true when the thread is still the current one. */
  async function showFadeCard(card: HTMLElement, myGen: number): Promise<boolean> {
    card.style.animationDuration = `${Math.round(900 * speedFactor())}ms`;
    logEl.appendChild(card);
    scroll();
    await beat(900);
    card.remove();
    scroll();
    return runGate.isCurrent(myGen);
  }

  function chapterCard(t: Thread, step: Extract<Step, { t: "chapter" }>): HTMLElement {
    const card = cardShell();

    const values = [
      `Chapter ${step.number}`,
      fill(t, step.text),
      step.time,
      step.at === undefined ? "" : fmtClock(step.at),
    ];
    const classes = [
      "block min-h-[1.4em] text-lg font-bold text-ink-100",
      "block min-h-[1.4em] text-base font-semibold text-ink-100",
      "block min-h-[1.4em] text-sm text-ink-300",
      "block min-h-[1.4em] text-sm tabular-nums text-ink-300",
    ];
    values.forEach((value, index) => {
      const line = document.createElement("span");
      line.className = classes[index];
      line.textContent = value;
      card.appendChild(line);
    });
    return card;
  }

  function dividerCard(t: Thread, step: Extract<Step, { t: "divider" }>): HTMLElement {
    const card = cardShell();
    const label = document.createElement("span");
    label.className = "block text-base font-semibold text-ink-100";
    label.textContent = fill(t, step.text);
    card.appendChild(label);
    if (step.at !== undefined) {
      const when = document.createElement("span");
      when.className = "mt-0.5 block text-sm tabular-nums text-ink-300";
      when.textContent = fmtClock(step.at);
      card.appendChild(when);
    }
    return card;
  }

  function lineDivider(content: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "bubble-in my-3 flex items-center gap-3";
    row.innerHTML =
      '<span aria-hidden="true" class="h-px flex-1 bg-chat-700"></span>' +
      `<span class="max-w-[75%] text-center">${content}</span>` +
      '<span aria-hidden="true" class="h-px flex-1 bg-chat-700"></span>';
    return row;
  }

  function chapterDivider(t: Thread, item: Item): HTMLElement {
    const chapter = item.chapter;
    if (!chapter) return document.createElement("div");
    const title = fill(t, chapter.title);
    const when = [fill(t, chapter.time), item.pinned ? item.time ?? "" : ""]
      .filter((value) => value !== "")
      .map(esc)
      .join(" · ");
    return lineDivider(
      `<span class="block text-xs font-bold uppercase tracking-wide text-tick-400">Chapter ${chapter.number}</span>` +
        (title ? `<span class="mt-0.5 block text-sm font-semibold text-ink-100">${esc(title)}</span>` : "") +
        (when ? `<span class="mt-0.5 block text-xs text-ink-300">${when}</span>` : ""),
    );
  }

  function threadDivider(t: Thread, item: Item): HTMLElement {
    const text = esc(fill(t, item.divider?.text ?? ""));
    const when = item.pinned && item.time ? ` · <span class="tabular-nums">${esc(item.time)}</span>` : "";
    return lineDivider(
      `<span class="block text-xs font-semibold uppercase tracking-wide text-ink-300">${text}${when}</span>`,
    );
  }

  function gateStatus(t: Thread, opt: ChoiceOpt): { locked: boolean; waitSecs: number; hint: string } {
    const g = opt.requires;
    if (!g) return { locked: false, waitSecs: 0, hint: "" };
    // A milestone belongs to the named chat, or to this thread when none is named.
    const gateState = g.chat ? CONTACTS[g.chat]?.data.state : t.data.state;
    if (g.milestone) {
      const ts = Number(gateState?.["_m:" + g.milestone] ?? 0);
      if (!ts) return { locked: true, waitSecs: 0, hint: g.hint ?? "" };
      if (g.seconds) {
        const left = Math.ceil((ts + g.seconds * 1000 - Date.now()) / 1000);
        if (left > 0) return { locked: true, waitSecs: left, hint: `back in ~${left}s…` };
      }
    }
    if (g.state) {
      const v = t.data.state[g.state.key] ?? "";
      if (g.state.is !== undefined && v !== g.state.is) return { locked: true, waitSecs: 0, hint: g.state.hint };
      if (g.state.not !== undefined && v === g.state.not) return { locked: true, waitSecs: 0, hint: g.state.hint };
      if (g.state.is === undefined && g.state.not === undefined && !v) return { locked: true, waitSecs: 0, hint: g.state.hint };
    }
    if (g.stat) {
      for (const k of Object.keys(g.stat) as Stat[]) {
        if ((t.data.stats[k] ?? 0) < (g.stat[k] ?? 0)) return { locked: true, waitSecs: 0, hint: g.hint ?? "" };
      }
    }
    return { locked: false, waitSecs: 0, hint: "" };
  }

  function applyStats(t: Thread, eff: Partial<Stats> | undefined): void {
    if (!eff) return;
    for (const k of Object.keys(eff) as Stat[]) {
      t.data.stats[k] = (t.data.stats[k] ?? 0) + (eff[k] ?? 0);
    }
    sounds.play("stat");
    saveThread(t);
  }

  // Revealed facts live in the same per-character notebook as milestones, under
  // a `_r:` prefix. A fact stays hidden on the profile until its reveal step runs.
  const revealKey = (fact: RevealFact, value?: string): string =>
    value === undefined ? `_r:${fact}` : `_r:${fact}:${value}`;

  const isRevealed = (c: Contact, fact: RevealFact, value?: string): boolean =>
    c.data.state[revealKey(fact, value)] === "1";

  // "Show stat changes" prints each reply's stat effect under the button while
  // writing. It used to be the 🐞 toggle in the chat header (`sr-debug`) and
  // then "Dev mode" (`sr-dev-mode`); the key is `sr-show-stats` now, and older
  // values carry over once. Like the text speed it is a device preference, so
  // it survives a reload, a fresh start and a wipe.
  let showStats = false;
  try {
    const stored = storage.getItem("sr-show-stats");
    const previous = storage.getItem("sr-dev-mode");
    const oldest = storage.getItem("sr-debug");
    const carried = stored ?? previous ?? oldest;
    showStats = carried === "1";
    if (stored === null && carried !== null) {
      storage.setItem("sr-show-stats", showStats ? "1" : "0");
      storage.removeItem("sr-dev-mode");
      storage.removeItem("sr-debug");
    }
  } catch { /* ignore */ }

  // Dev mode is the master switch for the authoring tools. It brings `dev`
  // characters and places into view and it
  // carries the stat preview on and off with it.
  let devMode = false;
  try { devMode = storage.getItem("sr-dev") === "1"; } catch { /* ignore */ }
  // The SFW/NSFW choice lives behind Dev mode, so a game without it is SFW —
  // including a save from before the setting was tucked away.
  if (!devMode) {
    nsfwMode = false;
    try { storage.setItem("sr-nsfw", "0"); } catch { /* ignore */ }
  }
  let refreshChoices: (() => void) | null = null;
  const STAT_COLORS: Record<Stat, string> = { trust: "#60a5fa", feelings: "#fb7185", attraction: "#fbbf24", bond: "#34d399" };

  function effectLine(eff: Partial<Stats> | undefined): string {
    if (!eff) return "";
    const parts = (Object.keys(eff) as Stat[])
      .filter((k) => eff[k])
      .map((k) => `<span style="color:${STAT_COLORS[k]}">${(eff[k] as number) > 0 ? "+" : ""}${eff[k]} ${esc(tr(STAT_LABEL_KEYS[k]))}</span>`);
    if (parts.length === 0) return "";
    return `<span class="block text-xs font-normal opacity-90">${parts.join(" · ")}</span>`;
  }

  function noEffectLine(): string {
    return '<span class="block text-xs font-normal opacity-70">no stat change</span>';
  }

  function askChoice(t: Thread, myGen: number, opts: ChoiceOpt[]): Promise<void> {
    return new Promise((resolve) => {
      let timer = 0;
      let done = false;
      let settled = false;
      let announced = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (cancelInteraction === cancel) cancelInteraction = null;
        resolve();
      };
      const cancel = (): void => {
        window.clearTimeout(timer);
        if (!done) {
          done = true;
          refreshChoices = null;
          boxEl.innerHTML = "";
          choiceStatus.textContent = "";
        }
        finish();
      };
      cancelInteraction = cancel;
      const render = (): void => {
        if (!runGate.isCurrent(myGen) || done) return;
        window.clearTimeout(timer);
        if (!announced) {
          announced = true;
          sounds.play("choice");
        }
        boxEl.innerHTML = "";
        let available = 0;
        let minWait = Infinity;
        refreshChoices = render;
        for (const opt of opts) {
          const lock = gateStatus(t, opt);
          const b = document.createElement("button");
          b.type = "button";
          if (lock.locked) {
            b.disabled = true;
            b.className = "min-h-11 w-full rounded-2xl border border-chat-700 px-4 py-2 text-left text-sm font-semibold text-ink-300 opacity-70";
            b.innerHTML = `<span class="block">🔒 ${esc(opt.label)}</span><span class="mt-0.5 block text-xs font-normal opacity-80">(${esc(lock.hint)})</span>${showStats ? effectLine(opt.effects) || noEffectLine() : ""}`;
            if (lock.waitSecs > 0) minWait = Math.min(minWait, lock.waitSecs);
          } else {
            available++;
            b.className = "min-h-11 w-full rounded-2xl border border-out-500 px-4 py-2 text-left text-sm font-semibold text-tick-400";
            b.innerHTML = `<span class="block">${esc(opt.label)}</span>${showStats ? effectLine(opt.effects) || noEffectLine() : ""}`;
            b.addEventListener("click", () => {
              if (!runGate.isCurrent(myGen) || done) return;
              done = true;
              refreshChoices = null;
              window.clearTimeout(timer);
              boxEl.innerHTML = "";
              choiceStatus.textContent = "";
              post(t, "me", opt.say);
              applyStats(t, opt.effects);
              t.data.queue.splice(1, 0, ...opt.then);
              saveThread(t);
              void beat(messageDelays(opt.say).pause).then(finish);
            }, { once: true });
          }
          boxEl.appendChild(b);
        }
        if (minWait !== Infinity) {
          timer = window.setTimeout(render, Math.min(minWait, 30) * 1000 + 400);
        }
        choiceStatus.textContent = available === 1
          ? tr("chat.replyCount.one")
          : tr("chat.replyCount", { count: available });
        scroll();
      };
      render();
    });
  }

  function askText(t: Thread, myGen: number, key: string, placeholder: string, eff: Partial<Stats> | undefined): Promise<void> {
    return new Promise((resolve) => {
      fieldEl.placeholder = placeholder;
      fieldEl.disabled = false;
      fieldEl.required = true;
      fieldEl.setCustomValidity("");
      sendEl.disabled = false;
      formEl.style.display = "";
      // Already answered? Start from that answer: the player can send it back
      // to confirm or edit it to change it.
      const known = key === "name" ? playerName || t.data.state[key] : t.data.state[key];
      fieldEl.value = known ?? "";
      fieldEl.focus();
      choiceStatus.textContent = tr("chat.typedReply");
      let cancel = (): void => {};
      const onSubmit = (e: Event): void => {
        e.preventDefault();
        if (!runGate.isCurrent(myGen)) return;
        const value = fieldEl.value.trim();
        if (!value) {
          fieldEl.setCustomValidity(tr("chat.replyRequired"));
          choiceStatus.textContent = tr("chat.replyRequired");
          fieldEl.reportValidity();
          return;
        }
        cleanup();
        if (cancelInteraction === cancel) cancelInteraction = null;
        choiceStatus.textContent = "";
        fieldEl.value = "";
        fieldEl.disabled = true;
        sendEl.disabled = true;
        fieldEl.placeholder = tr("chat.replyPlaceholder");
        t.data.state[key] = value;
        if (key === "name") {
          playerName = value;
          try { storage.setItem("sr-name", value); } catch { /* ignore */ }
        }
        post(t, "me", value);
        applyStats(t, eff);
        resolve();
      };
      const cleanup = (): void => {
        formEl.removeEventListener("submit", onSubmit);
        formEl.removeEventListener("input", onInput);
        formEl.style.display = "none";
        fieldEl.required = false;
        fieldEl.setCustomValidity("");
      };
      const onInput = (): void => {
        if (fieldEl.value.trim()) fieldEl.setCustomValidity("");
      };
      cancel = (): void => {
        cleanup();
        fieldEl.disabled = true;
        sendEl.disabled = true;
        choiceStatus.textContent = "";
        if (cancelInteraction === cancel) cancelInteraction = null;
        resolve();
      };
      cancelInteraction = cancel;
      formEl.addEventListener("submit", onSubmit);
      formEl.addEventListener("input", onInput);
    });
  }

  // One quiz question at a time. Wrong answers are removed from the board and
  // the character nudges, so the player narrows it down instead of guessing.
  function askQuizQuestion(t: Thread, myGen: number, item: QuizQ): Promise<boolean> {
    return new Promise((resolve) => {
      const used = new Set<string>();
      let tries = 0;
      let busy = false;
      let settled = false;
      const finish = (clean: boolean): void => {
        if (settled) return;
        settled = true;
        if (cancelInteraction === cancel) cancelInteraction = null;
        resolve(clean);
      };
      const cancel = (): void => {
        boxEl.innerHTML = "";
        choiceStatus.textContent = "";
        finish(false);
      };
      cancelInteraction = cancel;
      const render = (): void => {
        if (!runGate.isCurrent(myGen)) return;
        busy = false;
        boxEl.innerHTML = "";
        choiceStatus.textContent = tr("quiz.available");
        const tag = document.createElement("p");
        tag.className = "px-1 text-xs font-semibold uppercase tracking-wide text-ink-300";
        tag.textContent = tr("quiz.prompt");
        boxEl.appendChild(tag);
        let shown = 0;
        for (const a of item.answers) {
          if (used.has(a.text)) continue;
          shown++;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "min-h-11 w-full rounded-2xl border border-out-500 px-4 py-2 text-left text-sm font-semibold text-tick-400";
          b.innerHTML = `<span class="block">${esc(a.text)}</span>`;
          b.addEventListener("click", () => {
            if (!runGate.isCurrent(myGen) || busy) return;
            busy = true;
            tries++;
            used.add(a.text);
            boxEl.innerHTML = "";
            choiceStatus.textContent = "";
            post(t, "me", a.text);
            applyStats(t, a.effects);
            void (async () => {
              await beat(messageDelays(a.text).pause);
              if (!runGate.isCurrent(myGen)) return;
              await sayThem(t, myGen, fill(t, a.reply));
              if (!runGate.isCurrent(myGen)) return;
              if (a.right) {
                finish(tries === 1);
                return;
              }
              await sayThem(t, myGen, fill(t, item.hint));
              if (!runGate.isCurrent(myGen)) return;
              render();
            })();
          });
          boxEl.appendChild(b);
        }
        // Defensive: a mis-authored question must never soft-lock the chat.
        if (shown === 0) finish(false);
        scroll();
      };
      render();
    });
  }

  async function execStep(t: Thread, myGen: number, step: Step): Promise<void> {
    // An NSFW-only step does not happen in SFW mode: no bubble, no sound, no
    // stat, no state. Gating here covers every step type at once.
    if (step.nsfw && !nsfwMode) return;
    if (step.t === "chapter") {
      postChapter(t, step);
      if (!(await showFadeCard(chapterCard(t, step), myGen))) return;
    } else if (step.t === "divider") {
      if (step.style === "fade") {
        stamp(t, step.at);
        saveThread(t);
        if (!(await showFadeCard(dividerCard(t, step), myGen))) return;
      } else {
        postDivider(t, step);
      }
    } else if (step.t === "presence") {
      if (!t.scene) presenceEl.textContent = step.value;
    } else if (step.t === "rename") {
      if (t.contact) {
        t.contact.data.name = step.name;
        t.contact.data.initial = step.initial;
        chatnameEl.textContent = step.name;
        paintAvatar(avatarEl, t.contact, 40);
        saveThread(t);
        renderList();
      }
    } else if (step.t === "milestone") {
      t.data.state["_m:" + step.id] = String(Date.now());
      saveThread(t);
    } else if (step.t === "ending") {
      // pause = true end of this version; wait = more will arrive via other chats.
      if (step.kind === "wait") {
        const who = step.waitFor ?? "your other chats";
        post(t, "sys", tr("story.end.wait", { who }));
      } else {
        post(t, "sys", step.kind === "finale"
          ? tr("story.end.finale")
          : tr("story.end.pause"));
      }
      await beat(400);
    } else if (step.t === "set") {
      if (step.chat) {
        const target = CONTACTS[step.chat];
        if (target) {
          target.data.state[step.key] = step.value;
          saveChat(target);
        }
      } else {
        t.data.state[step.key] = step.value;
        saveThread(t);
      }
    } else if (step.t === "reveal") {
      if (t.contact) {
        const key = revealKey(step.fact, step.value);
        if (t.contact.data.state[key] !== "1") {
          t.contact.data.state[key] = "1";
          saveThread(t);
        }
      }
    } else if (step.t === "if") {
      if (matchesIfCondition(step, t.data.state[step.key])) {
        t.data.queue.splice(1, 0, ...step.then);
        saveThread(t);
      }
    } else if (step.t === "addStats") {
      applyStats(t, step.stats);
    } else if (step.t === "gate") {
      const meets = (thresholds: Partial<Stats>): boolean =>
        (Object.keys(thresholds) as Stat[]).every(
          (k) => (t.data.stats[k] ?? 0) >= (thresholds[k] ?? 0),
        );
      const ok = meets(step.min) && (step.any === undefined || step.any.some(meets));
      t.data.queue.splice(1, 0, ...(ok ? step.then : (step.otherwise ?? [])));
      saveThread(t);
    } else if (step.t === "unlock") {
      const target = CONTACTS[step.chat];
      if (target && !target.data.unlocked) {
        target.data.unlocked = true;
        saveChat(target);
        renderList();
      }
    } else if (step.t === "unlockPlace") {
      const place = PLACES[step.place];
      const target = place?.chats.find((chat) => chat.id === step.chat);
      if (place && target && !target.data.unlocked) {
        target.data.unlocked = true;
        saveThread(sceneThread(place, target));
        renderPlaces();
      }
    } else if (step.t === "append") {
      const target = CONTACTS[step.chat];
      if (target) {
        target.data.queue.push(...structuredClone(step.steps));
        saveChat(target);
        renderList();
      }
    } else if (step.t === "img") {
      await sayImg(t, myGen, step.from, step.name, step.alt, step.nsfwVersion, step.caption ? fill(t, step.caption) : "", step.typing, step.pause, step.at);
    } else if (step.t === "msg") {
      if (step.from === "them") {
        await sayThem(t, myGen, fill(t, step.text), step.typing, step.pause, step.speaker, step.at, step.duration);
      } else {
        post(t, step.from, step.text, undefined, step.at, step.duration);
        await beat(step.pause ?? messageDelays(step.text).pause);
      }
    } else if (step.t === "sound") {
      sounds.named(step.sound);
    } else if (step.t === "wait") {
      const dots = startTyping(t);
      await beat(step.time);
      dots.remove();
      if (!runGate.isCurrent(myGen)) return;
      if (!t.scene) presenceEl.textContent = tr("chat.online");
      await beat(200);
    } else if (step.t === "quiz") {
      let clean = true;
      sounds.play("quiz");
      for (const item of step.questions) {
        await sayThem(t, myGen, fill(t, item.q));
        if (!runGate.isCurrent(myGen)) return;
        const ok = await askQuizQuestion(t, myGen, item);
        if (!runGate.isCurrent(myGen)) return;
        if (!ok) clean = false;
      }
      t.data.state["_q:" + step.id] = clean ? "clean" : "retry";
      saveThread(t);
      t.data.queue.splice(1, 0, ...step.pass);
      saveThread(t);
    } else if (step.t === "choice") {
      await askChoice(t, myGen, step.opts);
    } else if (step.t === "ask") {
      await askText(t, myGen, step.key, step.placeholder, step.effects);
    }
  }

  async function runChat(t: Thread, myGen: number): Promise<void> {
    while (t.data.queue.length > 0 && runGate.isCurrent(myGen)) {
      const step = t.data.queue[0];
      await execStep(t, myGen, step);
      if (!runGate.isCurrent(myGen)) return;
      t.data.queue.shift();
      saveThread(t);
    }
    if (!runGate.isCurrent(myGen)) return;
    if (t.scene) {
      t.data.done = true;
      saveThread(t);
      showSceneEnd(t);
    }
  }

  function renderList(): void {
    chatlist.innerHTML = "";
    let shown = 0;
    for (const id of ORDER_IDS) {
      if (CONTACTS[id].dev && !devMode) continue;
      if (!CONTACTS[id].data.unlocked) continue;
      renderListRow(id);
      shown++;
    }
    if (shown === 0 && issues.length === 0) {
      chatlist.innerHTML = `<p class="rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No chats yet — add a character file in src/story/characters/ 💬</p>`;
    }
  }

  function renderListRow(id: string): void {
    const c = CONTACTS[id];
    // Dividers are transcript markers, not messages: the row keeps the last
    // real line so a closed chat does not show "TWO HOURS LATER" as its preview.
    let last: Item | undefined;
    for (let i = c.data.transcript.length - 1; i >= 0; i--) {
      const item = c.data.transcript[i];
      if (!item.chapter && !item.divider) {
        last = item;
        break;
      }
    }
    const fresh = c.data.transcript.length === 0;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "flex w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-chat-800";
    row.innerHTML =
      avatarSpan(c, "h-12 w-12", 48) +
      `<span class="min-w-0 flex-1"><span class="flex items-baseline justify-between gap-2"><span class="truncate font-semibold">${esc(c.data.name)}</span>` +
      `<span class="shrink-0 text-xs text-ink-300">${last?.time ? esc(last.time) : ""}</span></span>` +
      `<span class="flex items-center justify-between gap-2"><span class="truncate text-sm text-ink-300">${last ? esc(last.text.slice(0, 42)) : esc(c.teaser)}</span>` +
      `${fresh ? `<span class="shrink-0 rounded-full bg-out-600 px-2 py-0.5 text-xs font-bold text-white">${esc(tr("state.new"))}</span>` : ""}</span></span>`;
    row.addEventListener("click", () => startChat(id));
    chatlist.appendChild(row);
  }

  function showList(): void {
    showSection("list");
    fieldEl.disabled = true;
    sendEl.disabled = true;
  }

  function startChat(id: string): void {
    openThread(contactThread(CONTACTS[id]));
  }

  function openThread(t: Thread): void {
    const myGen = beginRun();
    cancelPendingInteraction();
    current = t;

    if (t.data.queue.length === 0 && t.data.transcript.length === 0) {
      const script = t.scene ? t.scene.chat.script : t.contact?.script ?? [];
      t.data.queue = structuredClone(script);
      saveThread(t);
    }

    // A place chat has no chapter heading, so the place file seeds the clock
    // itself: "at": "16:00" means the scene starts at four in the afternoon.
    if (t.scene && t.data.clock === undefined && t.scene.chat.at !== undefined) {
      t.data.clock = t.scene.chat.at;
    }

    sounds.ambient(t.scene ? (t.scene.place.ambient ?? null) : null);

    if (t.contact) {
      chatnameEl.textContent = t.contact.data.name;
      paintAvatar(avatarEl, t.contact, 40);
      presenceEl.textContent = tr("chat.online");
      whoBtn.disabled = false;
      whoBtn.setAttribute("aria-label", tr("chat.viewNamedProfile", { name: t.contact.data.name }));
      backBtn.setAttribute("aria-label", tr("chat.backToChats"));
    } else if (t.scene) {
      const { place, chat } = t.scene;
      const host = CONTACTS[chat.host];
      // No online line in a place: the location and the moment name the thread.
      chatnameEl.textContent = place.name;
      presenceEl.textContent = chat.title;
      backBtn.setAttribute("aria-label", tr("chat.backToPlaces"));
      if (host) {
        paintAvatar(avatarEl, host, 40);
        whoBtn.disabled = false;
        whoBtn.setAttribute("aria-label", tr("chat.viewNamedProfile", { name: host.data.name }));
      } else {
        avatarEl.textContent = place.icon;
        avatarEl.setAttribute("style", `background:${place.color};color:${avatarInk(place.color)}`);
        whoBtn.disabled = true;
      }
    }
    logEl.innerHTML = "";
    boxEl.innerHTML = "";
    fieldEl.disabled = true;
    sendEl.disabled = true;
    logEl.setAttribute("aria-label", t.scene ? "Scene messages" : "Chat messages");
    for (const item of t.data.transcript) renderItem(t, item, true);
    hideView(viewList);
    hideView(viewGallery);
    hideView(viewSettings);
    hideView(viewChars);
    hideView(viewProfile);
    hideView(viewPlaces);
    viewChat.classList.remove("hidden");
    viewChat.classList.add("flex");
    tabsEl.classList.add("hidden");
    formEl.style.display = "none";
    scroll();
    if (t.scene && t.data.queue.length === 0) showSceneEnd(t);
    else void runChat(t, myGen);
  }

  /** The end of a place chat: a way out, and the place remembers it is read. */
  function showSceneEnd(t: Thread): void {
    if (!t.scene || current !== t) return;
    boxEl.innerHTML = "";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "min-h-11 w-full rounded-2xl border border-out-500 px-4 py-2 text-sm font-semibold text-tick-400";
    b.textContent = tr("action.leave");
    b.setAttribute("aria-label", tr("chat.leavePlace", { name: t.scene.place.name }));
    b.addEventListener("click", () => showSection("places"));
    boxEl.appendChild(b);
    scroll();
  }

  async function doRestart(): Promise<void> {
    if (!current) return;
    const myGen = beginRun();
    cancelPendingInteraction();
    fieldEl.disabled = true;
    sendEl.disabled = true;
    const t = current;
    const script = t.scene ? t.scene.chat.script : t.contact?.script ?? [];
    t.data.transcript = [];
    t.data.queue = structuredClone(script);
    t.data.state = {};
    t.data.stats = { ...STAT_START };
    t.data.clock = undefined;
    t.data.clockUnits = 0;
    if (t.scene) t.data.done = false;
    if (t.contact) {
      t.contact.data.name = t.contact.name;
      t.contact.data.initial = t.contact.initial;
      chatnameEl.textContent = t.contact.data.name;
      paintAvatar(avatarEl, t.contact, 40);
      presenceEl.textContent = tr("chat.online");
    } else if (t.scene) {
      chatnameEl.textContent = t.scene.place.name;
      presenceEl.textContent = t.scene.chat.title;
    }
    logEl.innerHTML = "";
    boxEl.innerHTML = "";
    saveThread(t);
    if (t.contact) renderList();
    else renderPlaces();
    await runChat(t, myGen);
  }

  const tabsEl = document.getElementById("tabs") as HTMLElement;
  const tabChats = document.getElementById("tab-chats") as HTMLButtonElement;
  const tabPlaces = document.getElementById("tab-places") as HTMLButtonElement;
  const tabGallery = document.getElementById("tab-gallery") as HTMLButtonElement;
  const tabSettings = document.getElementById("tab-settings") as HTMLButtonElement;
  const viewGallery = document.getElementById("view-gallery") as HTMLElement;
  const viewPlaces = document.getElementById("view-places") as HTMLElement;
  const placeList = document.getElementById("placelist") as HTMLElement;
  const tabChars = document.getElementById("tab-chars") as HTMLButtonElement;
  const viewChars = document.getElementById("view-chars") as HTMLElement;
  const charGrid = document.getElementById("chargrid") as HTMLElement;
  const viewProfile = document.getElementById("view-profile") as HTMLElement;
  const whoBtn = document.getElementById("who") as HTMLButtonElement;
  const profileBack = document.getElementById("profile-back") as HTMLButtonElement;
  const profileAvatar = document.getElementById("profile-avatar") as HTMLElement;
  const profileName = document.getElementById("profile-name") as HTMLElement;
  const profileAge = document.getElementById("profile-age") as HTMLElement;
  const profileBirthday = document.getElementById("profile-birthday") as HTMLElement;
  const profileTag = document.getElementById("profile-tag") as HTMLElement;
  const profileStats = document.getElementById("profile-stats") as HTMLElement;
  const profileInterests = document.getElementById("profile-interests") as HTMLElement;
  const profileLikes = document.getElementById("profile-likes") as HTMLElement;
  const profileDislikes = document.getElementById("profile-dislikes") as HTMLElement;
  const secInterests = document.getElementById("sec-interests") as HTMLElement;
  const secLikes = document.getElementById("sec-likes") as HTMLElement;
  const secDislikes = document.getElementById("sec-dislikes") as HTMLElement;
  const profileChat = document.getElementById("profile-chat") as HTMLButtonElement;
  const viewSettings = document.getElementById("view-settings") as HTMLElement;
  const galleryList = document.getElementById("gallery-list") as HTMLElement;
  const galleryCount = document.getElementById("gallery-count") as HTMLElement;
  const saveOpen = document.getElementById("save-open") as HTMLButtonElement;
  const loadOpen = document.getElementById("load-open") as HTMLButtonElement;
  const savePanel = document.getElementById("save-panel") as HTMLElement;
  const savePanelTitle = document.getElementById("save-panel-title") as HTMLElement;
  const savePanelNote = document.getElementById("save-panel-note") as HTMLElement;
  const saveSlots = document.getElementById("save-slots") as HTMLElement;
  const saveConfirm = document.getElementById("save-confirm") as HTMLElement;
  const saveConfirmText = document.getElementById("save-confirm-text") as HTMLElement;
  const saveConfirmOk = document.getElementById("save-confirm-ok") as HTMLButtonElement;
  const saveConfirmCancel = document.getElementById("save-confirm-cancel") as HTMLButtonElement;
  const saveStatus = document.getElementById("save-status") as HTMLElement;
  const saveClose = document.getElementById("save-close") as HTMLButtonElement;
  const backupExport = document.getElementById("backup-export") as HTMLButtonElement;
  const backupImport = document.getElementById("backup-import") as HTMLInputElement;
  const backupStatus = document.getElementById("backup-status") as HTMLElement;
  const backupDialog = document.getElementById("backup-confirm") as HTMLDialogElement;
  const backupConfirmText = document.getElementById("backup-confirm-text") as HTMLElement;
  const backupCancel = document.getElementById("backup-cancel") as HTMLButtonElement;
  const backupConfirm = document.getElementById("backup-confirm-ok") as HTMLButtonElement;
  const delArm = document.getElementById("del-arm") as HTMLButtonElement;
  const lightbox = document.getElementById("lightbox") as HTMLElement;
  const lightboxImg = document.getElementById("lightbox-img") as HTMLImageElement;
  const lightboxCap = document.getElementById("lightbox-cap") as HTMLElement;
  const lightboxPos = document.getElementById("lightbox-pos") as HTMLElement;
  const lightboxPrev = document.getElementById("lightbox-prev") as HTMLButtonElement;
  const lightboxNext = document.getElementById("lightbox-next") as HTMLButtonElement;
  const lightboxClose = document.getElementById("lightbox-close") as HTMLButtonElement;

  const TAB_ON = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold text-tick-400";
  const TAB_OFF = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold text-ink-300";

  function showTabs(active: HTMLButtonElement): void {
    tabsEl.classList.remove("hidden");
    for (const btn of [tabChats, tabPlaces, tabGallery, tabChars, tabSettings]) {
      const on = btn === active;
      btn.className = on ? TAB_ON : TAB_OFF;
      if (on) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    }
  }

  function hideView(el: HTMLElement): void {
    el.classList.add("hidden");
    el.classList.remove("flex");
  }

  let profileReturn: "chat" | "chars" = "chat";

  function showSection(which: "list" | "places" | "gallery" | "chars" | "settings"): void {
    cancelRun();
    refreshChoices = null;
    cancelPendingInteraction();
    hideView(viewChat);
    hideView(viewGallery);
    hideView(viewPlaces);
    hideView(viewSettings);
    hideView(viewList);
    hideView(viewChars);
    hideView(viewProfile);
    const map = {
      list: viewList,
      places: viewPlaces,
      gallery: viewGallery,
      chars: viewChars,
      settings: viewSettings,
    } as const;
    map[which].classList.remove("hidden");
    map[which].classList.add("flex");
    showTabs(
      which === "list"
        ? tabChats
        : which === "places"
          ? tabPlaces
          : which === "gallery"
            ? tabGallery
            : which === "chars"
              ? tabChars
              : tabSettings,
    );
    if (which === "list") renderList();
    if (which === "places") renderPlaces();
    if (which === "gallery") renderGallery();
    if (which === "chars") renderCharacters();
    if (which === "settings") disarmDelete();
    else closeSavePanel();
    current = null;
  }

  function renderPlaces(): void {
    placeList.innerHTML = "";
    let shown = 0;
    for (const placeId of PLACE_IDS) {
      const place = PLACES[placeId];
      if (place.dev && !devMode) continue;
      const chats = place.chats.filter((chat) => chat.data.unlocked);
      if (chats.length === 0) continue;
      shown++;

      const section = document.createElement("section");
      section.className = "space-y-1";
      const heading = document.createElement("div");
      heading.className = "px-2 pt-1";
      heading.innerHTML =
        `<h2 class="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-tick-400"><span aria-hidden="true" class="text-lg">${esc(place.icon)}</span>${esc(place.name)}</h2>` +
        (place.teaser ? `<p class="mt-1 text-xs text-ink-300">${esc(place.teaser)}</p>` : "");
      section.appendChild(heading);

      for (const chat of chats) {
        const done = chat.data.done;
        const fresh = chat.data.transcript.length === 0;
        const row = document.createElement("button");
        row.type = "button";
        row.className = "flex w-full items-start gap-3 rounded-2xl p-3 text-left hover:bg-chat-800" + (done ? " opacity-70" : "");
        row.setAttribute("aria-label", `Open ${chat.title}${done ? " (already read)" : ""}`);
        row.innerHTML =
          `<span aria-hidden="true" class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${done ? "bg-chat-700 text-tick-400" : "bg-chat-800 text-lg"}">${done ? "✓" : esc(place.icon)}</span>` +
          `<span class="min-w-0 flex-1"><span class="flex items-baseline justify-between gap-2"><span class="truncate font-semibold ${done ? "text-ink-300" : ""}">${esc(chat.title)}</span>` +
          `${fresh ? `<span class="shrink-0 rounded-full bg-out-600 px-2 py-0.5 text-xs font-bold text-white">${esc(tr("state.new"))}</span>` : ""}</span>` +
          `<span class="mt-0.5 block text-sm text-ink-300">${esc(chat.teaser)}</span></span>`;
        row.addEventListener("click", () => openThread(sceneThread(place, chat)));
        section.appendChild(row);
      }
      placeList.appendChild(section);
    }
    if (shown === 0 && issues.length === 0) {
      placeList.innerHTML = `<p class="rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No places yet — add a file in src/story/locations/ 📍</p>`;
    }
  }

  /** Pictures already in a transcript, keyed by asset name. */
  function revealedPhotos(): Map<string, Item> {
    const out = new Map<string, Item>();
    for (const id of ORDER_IDS) {
      for (const item of CONTACTS[id].data.transcript) {
        if (!item.img) continue;
        const name = resolveAssetName(item.img.name);
        if (name && !out.has(name)) out.set(name, item);
      }
    }
    for (const placeId of PLACE_IDS) {
      for (const chat of PLACES[placeId].chats) {
        for (const item of chat.data.transcript) {
          if (!item.img) continue;
          const name = resolveAssetName(item.img.name);
          if (name && !out.has(name)) out.set(name, item);
        }
      }
    }
    return out;
  }

  type GalleryEntry = { url: string; alt: string; caption: string };
  let galleryFlat: GalleryEntry[] = [];
  let galleryTiles: HTMLButtonElement[] = [];
  let lightboxIndex = -1;

  function renderGallery(): void {
    const revealed = revealedPhotos();
    // A dev character's pictures stay out of a player's Gallery (and its
    // counts) until Dev mode is on.
    const categories = GALLERY.filter((cat) => {
      if (cat.id === "misc") return true;
      const c = CONTACTS[cat.id];
      return Boolean(c?.data.unlocked) && (!c.dev || devMode);
    }).map((cat) => {
      const title = cat.id === "misc" ? cat.title : (CONTACTS[cat.id]?.data.name ?? cat.title);
      const images = cat.images.map((ph) => {
        const item = revealed.get(ph.name);
        const isRevealed = ph.revealed === true || item !== undefined;
        const alt = isRevealed ? (item?.img?.alt ?? `Portrait of ${title}`) : "Hidden photo";
        const caption = !isRevealed
          ? tr("profile.notYet")
          : ph.revealed
            ? `${title} · profile photo`
            : item
              ? `${item.text ? `${item.text} · ` : ""}${title}${item.time ? ` · ${item.time}` : ""}`
              : ph.caption;
        // The Gallery shows the version the chat shows.
        const shownName = item ? (pictureName(item.img) ?? ph.name) : ph.name;
        return { ...ph, title, isRevealed, alt, caption, shownName };
      });
      return { ...cat, title, images };
    });

    const total = categories.reduce((n, cat) => n + cat.images.length, 0);
    const shown = categories.reduce(
      (n, cat) => n + cat.images.filter((ph) => ph.isRevealed).length,
      0,
    );
    galleryCount.textContent =
      total === 0 ? "" : `${shown} of ${total} ${total === 1 ? "photo" : "photos"}`;
    galleryList.innerHTML = "";
    galleryFlat = [];
    galleryTiles = [];

    if (total === 0) {
      galleryList.innerHTML = `<p class="rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No photos yet — keep chatting 💬</p>`;
      return;
    }

    for (const cat of categories) {
      const section = document.createElement("section");
      section.className = "space-y-2";
      const headingId = `gallery-${cat.id}`;
      section.setAttribute("aria-labelledby", headingId);
      const shownHere = cat.images.filter((ph) => ph.isRevealed).length;
      section.innerHTML =
        `<div class="flex items-baseline justify-between gap-2 px-1">` +
        `<h2 id="${headingId}" class="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-tick-400"><span aria-hidden="true" class="text-base">📁</span>${esc(cat.title)}</h2>` +
        `<p class="text-xs tabular-nums text-ink-300">${shownHere} of ${cat.images.length}</p>` +
        `</div>`;

      const grid = document.createElement("div");
      grid.className = "grid grid-cols-3 gap-2";
      for (const ph of cat.images) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "overflow-hidden rounded-xl border border-chat-700";
        b.setAttribute(
          "aria-label",
          ph.isRevealed ? `Open photo: ${ph.alt}` : "Hidden photo, not yet revealed",
        );
        const im = document.createElement("img");
        im.src = ph.isRevealed ? (IMG_URLS[ph.shownName] ?? "") : hiddenPhoto;
        im.alt = "";
        im.width = 640;
        im.height = 640;
        im.className = "aspect-square w-full object-cover object-top";
        im.loading = "lazy";
        b.appendChild(im);
        const index = galleryFlat.length;
        b.addEventListener("click", () => openPhotoAt(index));
        grid.appendChild(b);
        galleryFlat.push({
          url: ph.isRevealed ? (IMG_URLS[ph.shownName] ?? "") : hiddenPhoto,
          alt: ph.alt,
          caption: ph.caption,
        });
        galleryTiles.push(b);
      }
      section.appendChild(grid);
      galleryList.appendChild(section);
    }
  }

  function paintLightbox(): void {
    const ph = galleryFlat[lightboxIndex];
    if (!ph) return;
    lightboxImg.src = ph.url;
    lightboxImg.alt = ph.alt;
    lightboxCap.textContent = ph.caption;
    lightboxPos.textContent = `${lightboxIndex + 1} / ${galleryFlat.length}`;
    lightboxPrev.disabled = lightboxIndex === 0;
    lightboxNext.disabled = lightboxIndex === galleryFlat.length - 1;
  }

  function showLightbox(): void {
    lightbox.classList.remove("hidden");
    lightbox.classList.add("flex");
    lightboxClose.focus();
  }

  function openPhotoAt(index: number): void {
    if (index < 0 || index >= galleryFlat.length) return;
    lightboxIndex = index;
    paintLightbox();
    showLightbox();
  }

  /** A chat bubble is a one-picture session, not part of the Gallery paging. */
  function openPhoto(url: string, alt: string, caption: string, opener: HTMLButtonElement): void {
    galleryFlat = [{ url, alt, caption }];
    galleryTiles = [opener];
    lightboxIndex = 0;
    paintLightbox();
    showLightbox();
  }

  function navigateLightbox(delta: number): void {
    const next = lightboxIndex + delta;
    if (next < 0 || next >= galleryFlat.length) return;
    lightboxIndex = next;
    paintLightbox();
  }

  function closeLightbox(): void {
    const opener = galleryTiles[lightboxIndex];
    lightbox.classList.add("hidden");
    lightbox.classList.remove("flex");
    lightboxImg.removeAttribute("src");
    lightboxIndex = -1;
    opener?.focus();
  }

  lightboxPrev.addEventListener("click", () => navigateLightbox(-1));
  lightboxNext.addEventListener("click", () => navigateLightbox(1));
  lightboxClose.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (lightbox.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      closeLightbox();
      return;
    }
    if (e.key === "Tab") {
      const focusable = Array.from(
        lightbox.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || !lightbox.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !lightbox.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigateLightbox(-1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigateLightbox(1);
    }
  });

  let touchStartX = 0;
  let touchStartY = 0;
  let ignoreClickUntil = 0;
  lightbox.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    },
    { passive: true },
  );
  lightbox.addEventListener(
    "touchend",
    (e) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
      ignoreClickUntil = Date.now() + 350;
      navigateLightbox(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
  lightbox.addEventListener("click", (e) => {
    if (Date.now() < ignoreClickUntil) return;
    if (e.target === lightbox) closeLightbox();
  });

  const SAVE_SLOTS = 6;
  const SAVE_KEY = "sr-save-";
  type SaveMode = "save" | "load";
  type PendingSave = { kind: SaveMode; slot: number; trigger: HTMLButtonElement };

  let saveMode: SaveMode | null = null;
  let pendingSave: PendingSave | null = null;

  const slotKey = (slot: number): string => `${SAVE_KEY}${slot}`;

  function hasSave(slot: number): boolean {
    try {
      return storage.getItem(slotKey(slot)) !== null;
    } catch {
      return false;
    }
  }

  function readSave(slot: number): SaveFile | null {
    try {
      const raw = storage.getItem(slotKey(slot));
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const candidate = parsed as Partial<SaveFile>;
      if (
        candidate.version !== 1 ||
        typeof candidate.savedAt !== "string" ||
        (candidate.playerName !== undefined && typeof candidate.playerName !== "string") ||
        !candidate.threads ||
        typeof candidate.threads !== "object" ||
        Array.isArray(candidate.threads)
      ) {
        return null;
      }
      return candidate as SaveFile;
    } catch {
      return null;
    }
  }

  function formatSaveTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleString(story.lang, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function captureThreads(): Record<string, SaveThread> {
    const threads: Record<string, SaveThread> = {};
    for (const id of ORDER_IDS) {
      const contact = CONTACTS[id];
      threads[contact.storeKey] = structuredClone(contact.data);
    }
    for (const placeId of PLACE_IDS) {
      for (const chat of PLACES[placeId].chats) {
        threads[chat.storeKey] = structuredClone(chat.data);
      }
    }
    return threads;
  }

  function setSaveStatus(text: string, error = false): void {
    saveStatus.textContent = text;
    saveStatus.className = `mt-3 text-xs ${error ? "text-red-300" : "text-ink-300"}`;
  }

  function renderSaveSlots(): void {
    saveSlots.innerHTML = "";
    if (!saveMode) return;

    for (let slot = 1; slot <= SAVE_SLOTS; slot++) {
      const save = readSave(slot);
      const occupied = hasSave(slot);
      const time = save ? formatSaveTime(save.savedAt) : occupied ? "Unreadable save" : "Empty";
      const enabled = saveMode === "save" || save !== null;
      const action = saveMode === "save" ? (save || occupied ? "Overwrite" : "Save") : "Load";

      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.slot = String(slot);
      button.disabled = !enabled;
      button.className =
        "flex w-full items-center gap-3 rounded-2xl border border-chat-700 bg-chat-800 p-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60";
      button.setAttribute(
        "aria-label",
        saveMode === "save"
          ? `Slot ${slot}: ${time}. ${action} current progress`
          : save
            ? `Slot ${slot}: saved ${time}. Load this save`
            : occupied
              ? `Slot ${slot}: save unreadable`
              : `Slot ${slot}: empty`,
      );
      button.innerHTML =
        `<img src="${hiddenPhoto}" alt="" width="56" height="56" class="h-14 w-14 shrink-0 rounded-xl object-cover" />` +
        `<span class="min-w-0 flex-1"><span class="block font-semibold">Slot ${slot}</span>` +
        `<span class="block text-xs text-ink-300">${save ? `Saved ${esc(time)}` : esc(time)}</span></span>` +
        `<span aria-hidden="true" class="text-xl text-ink-300">${enabled && saveMode === "save" ? "↓" : enabled && save ? "→" : ""}</span>`;
      button.addEventListener("click", () => chooseSaveSlot(slot, button));
      item.appendChild(button);
      saveSlots.appendChild(item);
    }
  }

  function askSaveConfirm(
    kind: SaveMode,
    slot: number,
    trigger: HTMLButtonElement,
    message: string,
  ): void {
    pendingSave = { kind, slot, trigger };
    saveConfirmText.textContent = message;
    saveConfirmOk.textContent = kind === "save" ? "Overwrite" : "Load";
    saveConfirm.classList.remove("hidden");
    saveConfirmOk.focus();
  }

  function cancelSaveConfirm(): void {
    const trigger = pendingSave?.trigger;
    pendingSave = null;
    saveConfirm.classList.add("hidden");
    trigger?.focus();
  }

  function chooseSaveSlot(slot: number, trigger: HTMLButtonElement): void {
    // A click on another slot supersedes a confirmation that is still open.
    pendingSave = null;
    saveConfirm.classList.add("hidden");

    if (saveMode === "save") {
      if (hasSave(slot)) {
        const existing = readSave(slot);
        const when = existing ? formatSaveTime(existing.savedAt) : null;
        askSaveConfirm(
          "save",
          slot,
          trigger,
          when
            ? `Slot ${slot} already has a save from ${when}. Overwrite it with your current progress?`
            : `Slot ${slot} already has a save that can't be read. Overwrite it with your current progress?`,
        );
      } else {
        saveToSlot(slot);
      }
      return;
    }

    if (saveMode === "load") {
      const save = readSave(slot);
      if (!save) return;
      askSaveConfirm(
        "load",
        slot,
        trigger,
        `Load the save from ${formatSaveTime(save.savedAt)}? Your current progress will be replaced.`,
      );
    }
  }

  function saveToSlot(slot: number): boolean {
    const save: SaveFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      playerName,
      threads: captureThreads(),
    };
    try {
      storage.setItem(slotKey(slot), JSON.stringify(save));
    } catch {
      setSaveStatus("Could not save — storage is full or blocked.", true);
      return false;
    }
    setSaveStatus(`Saved to slot ${slot}.`);
    renderSaveSlots();
    savePanelTitle.focus();
    return true;
  }

  function applySave(save: SaveFile): void {
    cancelRun();
    cancelPendingInteraction();
    current = null;
    refreshChoices = null;

    for (const id of ORDER_IDS) {
      const contact = CONTACTS[id];
      const saved = save.threads[contact.storeKey];
      const state =
        saved?.state && typeof saved.state === "object" && !Array.isArray(saved.state)
          ? saved.state
          : {};
      contact.data = {
        transcript: Array.isArray(saved?.transcript) ? saved.transcript : [],
        queue: Array.isArray(saved?.queue) ? saved.queue : [],
        state,
        name: typeof saved?.name === "string" ? saved.name : contact.name,
        initial: typeof saved?.initial === "string" ? saved.initial : contact.initial,
        unlocked:
          typeof saved?.unlocked === "boolean" ? saved.unlocked : contact.startUnlocked,
        stats:
          saved?.stats && typeof saved.stats === "object"
            ? { ...STAT_START, ...saved.stats }
            : { ...STAT_START },
        // The story clock travels with the save, so a loaded chat keeps the
        // time of day the story left it at.
        clock: typeof saved?.clock === "number" && Number.isFinite(saved.clock) ? saved.clock : undefined,
        clockUnits: restoredClockUnits(saved?.clockUnits),
      };
      saveThread(contactThread(contact));
    }

    for (const placeId of PLACE_IDS) {
      const place = PLACES[placeId];
      for (const chat of place.chats) {
        const saved = save.threads[chat.storeKey];
        const state =
          saved?.state && typeof saved.state === "object" && !Array.isArray(saved.state)
            ? saved.state
            : {};
        chat.data = {
          transcript: Array.isArray(saved?.transcript) ? saved.transcript : [],
          queue: Array.isArray(saved?.queue) ? saved.queue : [],
          state,
          stats:
            saved?.stats && typeof saved.stats === "object"
              ? { ...STAT_START, ...saved.stats }
              : { ...STAT_START },
          unlocked:
            typeof saved?.unlocked === "boolean" ? saved.unlocked : chat.startUnlocked,
          done: saved?.done === true,
          clock: typeof saved?.clock === "number" && Number.isFinite(saved.clock) ? saved.clock : undefined,
          clockUnits: restoredClockUnits(saved?.clockUnits),
        };
        saveThread(sceneThread(place, chat));
      }
    }

    // The player's name belongs to the snapshot too. Old v1 snapshots did not
    // store it separately, so recover it from the chat that asked for it.
    if (typeof save.playerName === "string") {
      playerName = save.playerName.trim();
    } else {
      playerName = "";
      for (const id of ORDER_IDS) {
        const savedName = CONTACTS[id].data.state.name;
        if (typeof savedName === "string" && savedName.trim()) {
          playerName = savedName.trim();
          break;
        }
      }
    }
    try {
      if (playerName) storage.setItem("sr-name", playerName);
      else storage.removeItem("sr-name");
    } catch {
      /* loaded game still works for this session */
    }
  }

  function loadFromSlot(slot: number): boolean {
    const save = readSave(slot);
    if (!save) {
      setSaveStatus(`Slot ${slot} could not be read.`, true);
      return false;
    }
    applySave(save);
    setSaveStatus(`Loaded slot ${slot}. Your chats are back.`);
    return true;
  }

  function confirmSaveAction(): void {
    const action = pendingSave;
    if (!action) return;
    pendingSave = null;
    saveConfirm.classList.add("hidden");
    if (action.kind === "save") {
      if (!saveToSlot(action.slot)) savePanelTitle.focus();
    } else {
      loadFromSlot(action.slot);
      savePanelTitle.focus();
    }
  }

  function openSavePanel(mode: SaveMode): void {
    saveMode = mode;
    pendingSave = null;
    saveConfirm.classList.add("hidden");
    setSaveStatus("");
    savePanelTitle.textContent = mode === "save" ? tr("action.save") : tr("action.load");
    savePanelNote.textContent =
      mode === "save"
        ? tr("settings.saveNote")
        : tr("settings.loadNote");
    savePanel.classList.remove("hidden");
    saveOpen.setAttribute("aria-expanded", String(mode === "save"));
    loadOpen.setAttribute("aria-expanded", String(mode === "load"));
    renderSaveSlots();
  }

  function closeSavePanel(): void {
    saveMode = null;
    pendingSave = null;
    savePanel.classList.add("hidden");
    saveConfirm.classList.add("hidden");
    saveStatus.textContent = "";
    saveOpen.setAttribute("aria-expanded", "false");
    loadOpen.setAttribute("aria-expanded", "false");
  }

  saveOpen.addEventListener("click", () => openSavePanel("save"));
  loadOpen.addEventListener("click", () => openSavePanel("load"));
  saveClose.addEventListener("click", () => {
    closeSavePanel();
    saveOpen.focus();
  });
  saveConfirmOk.addEventListener("click", confirmSaveAction);
  saveConfirmCancel.addEventListener("click", cancelSaveConfirm);
  savePanel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (pendingSave) cancelSaveConfirm();
    else {
      closeSavePanel();
      saveOpen.focus();
    }
  });

  let pendingBackup: GameBackup | null = null;
  backupExport.addEventListener("click", () => {
    try {
      const backup = makeBackup(storage.entries(), story.title ?? "Your Story");
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const slug = (story.title ?? "story").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      anchor.href = url;
      anchor.download = `chat-story-${slug || "backup"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      backupStatus.textContent = "Backup downloaded to this device.";
    } catch {
      backupStatus.textContent = "Could not read local game data for export.";
    }
  });

  backupImport.addEventListener("change", async () => {
    const file = backupImport.files?.[0];
    backupImport.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      backupStatus.textContent = "That backup is larger than the 10 MB import limit.";
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      backupStatus.textContent = "Could not read that backup file.";
      return;
    }
    const parsed = parseBackup(text);
    if ("error" in parsed) {
      backupStatus.textContent = parsed.error;
      return;
    }
    if (!storagePersistent) {
      backupStatus.textContent = "Import needs browser storage, which is blocked in this session.";
      return;
    }
    pendingBackup = parsed.backup;
    backupConfirmText.textContent = `This ${parsed.backup.story ? `backup from “${parsed.backup.story}”` : "backup"} replaces all saved chats, places, save slots and preferences for this game. Continue?`;
    backupStatus.textContent = "";
    backupDialog.showModal();
  });

  backupCancel.addEventListener("click", () => {
    pendingBackup = null;
    backupDialog.close();
  });
  backupDialog.addEventListener("close", () => {
    pendingBackup = null;
  });
  backupConfirm.addEventListener("click", () => {
    const backup = pendingBackup;
    if (!backup) return;
    let previous: Record<string, string>;
    try {
      previous = storage.entries();
    } catch {
      backupDialog.close();
      backupStatus.textContent = "Could not read existing local data; import was not started.";
      return;
    }
    try {
      storage.replace(backup.data);
      backupDialog.close();
      backupStatus.textContent = "Backup restored. Reloading this game…";
      window.setTimeout(() => window.location.reload(), 50);
    } catch {
      try { storage.replace(previous); } catch { /* best-effort rollback */ }
      backupDialog.close();
      backupStatus.textContent = "Could not restore the backup. Existing progress was kept where possible.";
    }
  });

  // ---- text speed ----------------------------------------------------------
  //
  // The five presets in Settings set the pace of the whole game: every gap
  // between messages scales with it, and the typing dots blink to match. The
  // choice lives on the device, not in a save, so it survives a reload and a
  // fresh start.
  const speedInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="speed"]'));
  const speedNote = document.getElementById("speed-note");

  const paintSpeed = (): void => {
    for (const input of speedInputs) input.checked = input.value === speed;
     if (speedNote) speedNote.textContent = tr(SPEED_PRESETS[speed].note);
    document.documentElement.style.setProperty("--typing-cycle", `${(1.1 * speedFactor()).toFixed(2)}s`);
  };
  paintSpeed();

  for (const input of speedInputs) {
    input.addEventListener("change", () => {
      if (!input.checked || !isSpeed(input.value)) return;
      speed = input.value;
      try { storage.setItem("sr-text-speed", speed); } catch { /* ignore */ }
      paintSpeed();
    });
  }

  // The three volume sliders live in Settings next to the text speed.
  const volumeRows: { key: VolumeKey; input: HTMLInputElement | null; out: HTMLElement | null }[] = [
    {
      key: "master",
      input: document.getElementById("vol-master") as HTMLInputElement | null,
      out: document.getElementById("vol-master-value"),
    },
    {
      key: "ambient",
      input: document.getElementById("vol-ambient") as HTMLInputElement | null,
      out: document.getElementById("vol-ambient-value"),
    },
    {
      key: "effects",
      input: document.getElementById("vol-effects") as HTMLInputElement | null,
      out: document.getElementById("vol-effects-value"),
    },
  ];

  const paintVolumes = (): void => {
    for (const row of volumeRows) {
      if (row.input && row.input.value !== String(volumes[row.key])) {
        row.input.value = String(volumes[row.key]);
      }
      if (row.out) row.out.textContent = `${volumes[row.key]}%`;
    }
  };
  paintVolumes();

  for (const row of volumeRows) {
    const input = row.input;
    if (!input) continue;
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 0 || value > 100) return;
      volumes[row.key] = value;
      try { storage.setItem(VOLUME_KEYS[row.key], String(value)); } catch { /* ignore */ }
      paintVolumes();
      applyVolumes();
    });
  }

  // ---- content setting ----------------------------------------------------
  //
  // SFW/NSFW sits in the Developer section, behind Dev mode: the switch is
  // hidden until Dev mode is on, and turning Dev mode off puts the game back to
  // SFW. A photo may name a second file in `nsfw_version` and any step may be
  // gated with `"nsfw": "yes"`; because transcripts keep both picture names,
  // switching redraws photos that were already sent instead of baking the
  // choice into a save.
  const nsfwRow = document.getElementById("nsfw-row");
  const nsfwBox = document.getElementById("nsfw-mode") as HTMLInputElement | null;

  const paintNsfw = (): void => {
    if (nsfwBox) nsfwBox.checked = nsfwMode;
  };
  paintNsfw();

  const paintContent = (): void => {
    nsfwRow?.classList.toggle("hidden", !devMode);
  };
  paintContent();

  const setContent = (on: boolean): void => {
    nsfwMode = on;
    try { storage.setItem("sr-nsfw", on ? "1" : "0"); } catch { /* ignore */ }
    paintNsfw();
  };

  if (nsfwBox) {
    nsfwBox.checked = nsfwMode;
    nsfwBox.addEventListener("change", () => setContent(nsfwBox.checked));
  }

  // "Show stat changes": a plain switch in Settings, off unless turned on. The
  // stat lines appear under the reply buttons, so repaint any choice on screen.
  const statsBox = document.getElementById("show-stats") as HTMLInputElement | null;

  const setStats = (on: boolean): void => {
    showStats = on;
    if (statsBox) statsBox.checked = on;
    try { storage.setItem("sr-show-stats", on ? "1" : "0"); } catch { /* ignore */ }
    if (refreshChoices) refreshChoices();
  };

  if (statsBox) {
    statsBox.checked = showStats;
    statsBox.addEventListener("change", () => setStats(statsBox.checked));
  }

  // "Dev mode": the master switch. Everything dev-only follows it, and the
  // stat preview comes on and off with it. The chat list, Places and Characters
  // repaint when their tab is next opened, so nothing stale is left behind.
  const devBox = document.getElementById("dev-mode") as HTMLInputElement | null;
  const setDevMode = (on: boolean): void => {
    devMode = on;
    if (devBox) devBox.checked = on;
    try { storage.setItem("sr-dev", on ? "1" : "0"); } catch { /* ignore */ }
    setStats(on);
    if (!on) setContent(false);
    paintContent();
  };

  if (devBox) {
    devBox.checked = devMode;
    devBox.addEventListener("change", () => setDevMode(devBox.checked));
  }

  let deleteArmed = false;
  let deleteTimer = 0;
  function disarmDelete(): void {
    deleteArmed = false;
    window.clearTimeout(deleteTimer);
    delArm.textContent = tr("settings.delete");
  }

  delArm.addEventListener("click", () => {
    if (!deleteArmed) {
      deleteArmed = true;
      delArm.textContent = tr("settings.deleteAgain");
      window.clearTimeout(deleteTimer);
      deleteTimer = window.setTimeout(disarmDelete, 5000);
      return;
    }
    disarmDelete();
    closeSavePanel();
    cancelRun();
    cancelPendingInteraction();
    try {
      // Saves live in localStorage only — no cookies. Clearing wipes every
      // transcript, place scene, photo memory, milestone, name and save slot
      // on this device. The text speed, the volume levels, the content setting
      // and the dev switches are personal preferences, so they stay.
      storage.clear();
      storage.setItem("sr-text-speed", speed);
      for (const key of Object.keys(VOLUME_KEYS) as VolumeKey[]) {
        storage.setItem(VOLUME_KEYS[key], String(volumes[key]));
      }
      storage.setItem("sr-show-stats", showStats ? "1" : "0");
      storage.setItem("sr-dev", devMode ? "1" : "0");
      storage.setItem("sr-nsfw", nsfwMode ? "1" : "0");
    } catch {
      /* ignore */
    }
    playerName = "";
    for (const id of ORDER_IDS) {
      const c = CONTACTS[id];
      c.data = {
        transcript: [], queue: [], state: {},
        name: c.name, initial: c.initial,
        unlocked: c.startUnlocked,
        stats: { ...STAT_START },
        clockUnits: 0,
      };
    }
    for (const placeId of PLACE_IDS) {
      for (const chat of PLACES[placeId].chats) {
        chat.data = {
          transcript: [], queue: [], state: {},
          stats: { ...STAT_START },
          unlocked: chat.startUnlocked,
          done: false,
          clockUnits: 0,
        };
      }
    }
    showSection("list");
  });

  tabChats.addEventListener("click", () => showSection("list"));
  tabPlaces.addEventListener("click", () => showSection("places"));
  tabGallery.addEventListener("click", () => showSection("gallery"));
  tabSettings.addEventListener("click", () => showSection("settings"));

  function renderCharacters(): void {
    charGrid.innerHTML = "";
    let shown = 0;
    for (const id of ORDER_IDS) {
      if (CONTACTS[id].dev && !devMode) continue;
      if (!CONTACTS[id].data.unlocked) continue;
      const c = CONTACTS[id];
      const prof = PROFILES[id];
      if (!prof) continue;
      shown++;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rounded-2xl bg-chat-800 p-4 text-left";
      b.setAttribute("aria-label", `Open profile of ${c.data.name}`);
      b.innerHTML =
        avatarSpan(c, "h-14 w-14", 56) +
        `<span class="mt-2 block font-bold">${esc(c.data.name)}</span>` +
        `<span class="block text-xs text-ink-300">${isRevealed(c, "age") ? esc(tr("profile.yearsOld", { age: prof.age })) : esc(tr("profile.ageHidden"))}</span>` +
        `<span class="mt-1 block text-xs text-ink-300">${esc(prof.tagline.split(".")[0])}.</span>`;
      b.addEventListener("click", () => openProfile(c, "chars"));
      charGrid.appendChild(b);
    }
    if (shown === 0) {
      charGrid.innerHTML = `<p class="col-span-2 rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No characters yet — add a file to src/story/characters/ 👥</p>`;
    }
  }

  function openProfile(c: Contact, from: "chat" | "chars"): void {
    profileReturn = from;
    const prof = PROFILES[c.id];
    paintAvatar(profileAvatar, c, 64);
    profileName.textContent = c.data.name;
    const ageKnown = isRevealed(c, "age");
    profileAge.textContent = prof ? (ageKnown ? tr("profile.yearsOld", { age: prof.age }) : tr("profile.ageHidden")) : "";
    profileAge.classList.toggle("italic", Boolean(prof) && !ageKnown);
    // Age and birthday are separate facts: either can be known without the other.
    const birthdayKnown = isRevealed(c, "birthday");
    profileBirthday.textContent = prof?.birthday
      ? birthdayKnown
        ? tr("profile.birthday", { date: prof.birthday })
        : tr("profile.birthdayHidden")
      : "";
    profileBirthday.classList.toggle("italic", Boolean(prof?.birthday) && !birthdayKnown);
    profileBirthday.classList.toggle("hidden", !prof?.birthday);
    profileTag.textContent = prof ? prof.tagline : "";
    profileStats.innerHTML = STAT_META.map((m) => {
      const v = c.data.stats[m.key] ?? 0;
      const pct = Math.max(0, Math.min(100, Math.round((v / STAT_MAX) * 100)));
      return `<li class="flex items-center gap-3"><img src="${m.icon}" alt="" width="112" height="112" class="h-8 w-8 rounded-lg [image-rendering:pixelated]" /><span class="w-24 text-sm">${esc(tr(STAT_LABEL_KEYS[m.key]))}</span><span class="h-2.5 flex-1 overflow-hidden rounded-full bg-chat-700"><span class="block h-full rounded-full bg-gold-500" style="width:${pct}%"></span></span><span class="w-8 text-right text-sm font-bold text-gold-300">${v}</span></li>`;
    }).join("");
    const chip = (s: string): string => `<li class="rounded-full bg-chat-800 border border-chat-700 px-3 py-1">${esc(s)}</li>`;
    // Only what the story has actually told the player shows; the rest sits
    // behind a muted placeholder so it is clear there is more to find.
    const renderFactList = (fact: "interests" | "likes" | "dislikes", items: string[]): { html: string; empty: boolean } => {
      if (items.length === 0) return { html: "", empty: true };
      const shown = items.filter((s) => isRevealed(c, fact, s));
      const pending = shown.length < items.length;
      if (fact === "interests") {
        return {
          html: shown.map(chip).join("") + (pending ? '<li class="rounded-full border border-dashed border-chat-700 px-3 py-1 text-ink-300">not yet revealed</li>' : ""),
          empty: false,
        };
      }
      const mark = fact === "likes" ? "✓" : "✕";
      return {
        html: shown.map((s) => `<li>${mark} ${esc(s)}</li>`).join("") + (pending ? '<li class="text-ink-300">not yet revealed</li>' : ""),
        empty: false,
      };
    };
    const interests = renderFactList("interests", prof?.interests ?? []);
    const likes = renderFactList("likes", prof?.likes ?? []);
    const dislikes = renderFactList("dislikes", prof?.dislikes ?? []);
    profileInterests.innerHTML = interests.html;
    profileLikes.innerHTML = likes.html;
    profileDislikes.innerHTML = dislikes.html;
    secInterests.classList.toggle("hidden", interests.empty);
    secLikes.classList.toggle("hidden", likes.empty);
    secDislikes.classList.toggle("hidden", dislikes.empty);
    hideView(viewChat);
    hideView(viewList);
    hideView(viewGallery);
    hideView(viewPlaces);
    hideView(viewChars);
    hideView(viewSettings);
    tabsEl.classList.add("hidden");
    viewProfile.classList.remove("hidden");
    viewProfile.classList.add("flex");
    profileBack.focus();
  }

  function closeProfile(): void {
    hideView(viewProfile);
    if (profileReturn === "chat" && current) {
      viewChat.classList.remove("hidden");
      viewChat.classList.add("flex");
      scroll();
    } else {
      showSection("chars");
    }
  }

  whoBtn.addEventListener("click", () => {
    if (!current) return;
    const c = current.contact ?? (current.scene ? CONTACTS[current.scene.chat.host] : undefined);
    if (c) openProfile(c, "chat");
  });
  profileBack.addEventListener("click", closeProfile);
  profileChat.addEventListener("click", closeProfile);

  tabChars.addEventListener("click", () => showSection("chars"));

  backBtn.addEventListener("click", () => {
    if (current?.scene) showSection("places");
    else showList();
  });
  restartBtn.addEventListener("click", () => {
    if (current) restartDialog.showModal();
  });
  restartCancel.addEventListener("click", () => restartDialog.close());
  restartConfirm.addEventListener("click", () => {
    restartDialog.close();
    void doRestart();
  });

  // Story files that could not be used: show the author what to fix instead of
  // failing silently. The same list appears in the terminal via `bun run check`.
  //
  // Warnings are authoring nudges (a scripted "me" line, a choice with one
  // reply) — useful while writing, noise in a finished game, so a built story
  // shows errors and nothing else. Errors always show.
  function renderIssues(list: Issue[]): void {
    const problems = import.meta.env.DEV ? list : list.filter((i) => i.level === "error");
    if (problems.length === 0) return;
    const errors = problems.filter((i) => i.level === "error").length;
    const shown = problems.slice(0, 12);
    const panel = document.createElement("details");
    panel.className = "mx-2 mb-2 rounded-2xl border border-red-900 bg-chat-800 p-3 text-sm";
    panel.open = true;
    panel.innerHTML =
      `<summary class="cursor-pointer font-bold text-red-400">${errors > 0 ? `⚠️ ${errors} story problem${errors === 1 ? "" : "s"}` : "⚠️ story warnings"}</summary>` +
      `<p class="mt-1 text-xs text-ink-300">From the story files in <code>src/story/</code> (<code>characters/</code>, <code>locations/</code>, <code>story.json</code>). Fix them and reload — <code>bun run check</code> lists the same problems in the terminal. The browser console has the full detail.</p>` +
      `<ul class="mt-2 space-y-1 text-xs">` +
      shown
        .map(
          (i) =>
            `<li><span class="font-semibold ${i.level === "error" ? "text-red-400" : "text-gold-300"}">${i.level}</span> ` +
            `<span class="text-ink-300">${esc(i.file)}</span>${i.where && i.where !== i.file ? ` <span class="text-ink-300">→ ${esc(i.where)}</span>` : ""} — ${esc(i.message)}</li>`,
        )
        .join("") +
      `</ul>` +
      (problems.length > shown.length ? `<p class="mt-1 text-xs text-ink-300">…and ${problems.length - shown.length} more.</p>` : "");
    viewList.insertBefore(panel, chatlist);
    console.error("Story problems:", problems);
  }

  // Android shell: the hardware back button should leave the current screen
  // rather than the whole app, and the phone shell should stay clear of the
  // status and navigation bars.
  if (Capacitor.isNativePlatform()) {
    document.documentElement.classList.add("is-native");
    void App.addListener("backButton", () => {
      if (backupDialog.open) {
        backupDialog.close();
        pendingBackup = null;
        return;
      }
      if (restartDialog.open) {
        restartDialog.close();
        return;
      }
      if (!lightbox.classList.contains("hidden")) {
        closeLightbox();
        return;
      }
      if (!viewProfile.classList.contains("hidden")) {
        closeProfile();
        return;
      }
      if (!viewChat.classList.contains("hidden")) {
        if (current?.scene) showSection("places");
        else showList();
        return;
      }
      if (viewList.classList.contains("hidden")) {
        showSection("list");
        return;
      }
      void App.exitApp();
    });
  }

  // Boot: show story problems, restore every saved chat and place, then show
  // the list. Places have no row until the player opens the tab.
  renderIssues(issues);
  for (const id of ORDER_IDS) loadChat(CONTACTS[id]);
  // Saves from before the name was shared kept it only in the chat that asked.
  // Adopt it, so a later chat can confirm it instead of asking again.
  if (!playerName) {
    for (const id of ORDER_IDS) {
      const saved = CONTACTS[id].data.state.name;
      if (saved) {
        playerName = saved;
        try { storage.setItem("sr-name", saved); } catch { /* ignore */ }
        break;
      }
    }
  }
  for (const placeId of PLACE_IDS) {
    const place = PLACES[placeId];
    for (const chat of place.chats) loadThread(sceneThread(place, chat));
  }
  showSection("list");
}
