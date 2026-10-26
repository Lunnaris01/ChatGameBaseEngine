// Engine-side types and constants.
//
// Story authors never open this file: the story-facing format is plain JSON
// in src/story/ (see src/story/README.md). src/engine/story.ts translates
// that JSON into the engine objects defined here.

export type Stat = "trust" | "friendship";
export type Stats = Record<Stat, number>;

/** The one place stat names are defined; used by the engine and the validator. */
export const STAT_NAMES: Stat[] = ["trust", "friendship"];
export const STAT_MAX = 50;
export const STAT_MIN = -50;
export const STAT_START: Stats = { trust: 0, friendship: 0 };

export const isStat = (key: string): key is Stat => (STAT_NAMES as string[]).includes(key);

// Character (combat) types and main stat mapping.
export type CharacterType = "Fighter" | "Assassin" | "Archer" | "Mage";
export const CHARACTER_TYPES: CharacterType[] = ["Fighter", "Assassin", "Archer", "Mage"];
export type CombatStatName = "strength" | "agility" | "intelligence" | "defense" | "health" | "cunning";
export const COMBAT_STAT_NAMES: CombatStatName[] = ["health", "defense", "strength", "agility", "intelligence", "cunning"];
export type CombatStats = Record<CombatStatName, number>;

export const DEFAULT_COMBAT_STATS: CombatStats = {
  health: 50,
  defense: 0,
  strength: 0,
  agility: 0,
  intelligence: 0,
  cunning: 0,
};

/** Maps a character type to the combat stat it uses as its main stat. */
export function mainStatForType(type: CharacterType): CombatStatName {
  if (type === "Fighter") return "strength";
  if (type === "Mage") return "intelligence";
  return "agility"; // Assassin, Archer
}

// Facts on a profile that stay hidden until the story reveals them: `age` and
// `birthday` (one fact each), or a single entry of `interests` / `likes` /
// `dislikes` (matched by text).
export type RevealFact = "age" | "birthday" | "interests" | "likes" | "dislikes";
export const REVEAL_FACTS: RevealFact[] = ["age", "birthday", "interests", "likes", "dislikes"];

// Quiz: a short knowledge check about things the story already told the player.
// Wrong picks are struck off and hinted, so a player who paid attention always
// gets through; `pass` is where the gated image / extra conversation lives.
export type QuizAnswer = { text: string; right?: boolean; reply: string; effects?: Partial<Stats> };
export type QuizQ = { q: string; answers: QuizAnswer[]; hint: string };

/**
 * Any step can be marked NSFW-only with `"nsfw": "yes"` in the story file.
 * While the Content setting is SFW the whole step is skipped: no bubble, no
 * sound, no stat, no state — as if it were not in the script.
 */
export type Step = StepBody & { nsfw?: boolean };

type StepBody =
  | { t: "chapter"; number: number; text: string; time: string; at?: number }
  | { t: "divider"; text: string; at?: number; style: "divider" | "fade" }
  | {
      t: "msg";
      from: "them" | "me" | "sys" | "thought" | "narrator";
      text: string;
      typing?: number;
      pause?: number;
      /** Minutes until the next message; defaults to one. */
      duration?: number;
      speaker?: string;
      /** Story-clock time in minutes since midnight; the clock the story sets. */
      at?: number;
    }
  | { t: "thought"; text: string; typing?: number; pause?: number; duration?: number; at?: number }
  | { t: "narrate"; text: string; typing?: number; pause?: number; duration?: number; at?: number }
  | { t: "choice"; opts: ChoiceOpt[] }
  | { t: "milestone"; id: string }
  | { t: "ask"; key: string; placeholder: string; effects?: Partial<Stats> }
  | { t: "presence"; value: string }
  | { t: "rename"; name: string; initial: string }
   | { t: "unlock"; chat: string }
   | { t: "unlockPlace"; place: string; chat: string }
  | { t: "set"; key: string; value: string; chat?: string }
  | { t: "reveal"; fact: RevealFact; value?: string }
  | {
      t: "if";
      key: string;
      is?: string;
      any?: string[];
      not?: string;
      none?: string[];
      then: Step[];
    }
  | { t: "addStats"; stats: Partial<Stats> }
  | { t: "gate"; min: Partial<Stats>; any?: Partial<Stats>[]; then: Step[]; otherwise?: Step[] }
  | { t: "append"; chat: string; steps: Step[] }
  | { t: "ending"; kind: "pause" | "finale" }
  | { t: "ending"; kind: "wait"; waitFor?: string }
  | {
      t: "img";
      from: "them" | "me";
      name: string;
      alt: string;
      /** Second, more revealing picture, shown while the content setting is NSFW. */
      nsfwVersion?: string;
      caption?: string;
      /** Gallery folder override; defaults to the sender's folder. */
      gallery?: string;
      typing?: number;
      pause?: number;
      /** Story-clock time in minutes since midnight. */
      at?: number;
    }
  | { t: "wait"; time: number }
  /** Plays one sound on its own: a file name in assets/sounds/, or a built-in voice. */
  | { t: "sound"; sound: string }
  | { t: "quiz"; id: string; questions: QuizQ[]; pass: Step[] }
  | { t: "autosave" }
  | { t: "combat"; enemy: string; onWin?: Step[]; onLose?: Step[] };

/** Matches one validated remembered-value condition. Missing keys match `not`/`none`. */
export function matchesIfCondition(
  step: Extract<Step, { t: "if" }>,
  storedValue: string | undefined,
): boolean {
  const value = storedValue ?? "";
  if (step.is !== undefined) return value === step.is;
  if (step.any !== undefined) return step.any.includes(value);
  if (step.not !== undefined) return value !== step.not;
  if (step.none !== undefined) return !step.none.includes(value);
  return false;
}

export type Item = {
  from: "them" | "me" | "sys" | "thought" | "narrator";
  text: string;
  /** The story time on this bubble, e.g. "18:12" — never the phone's clock. */
  time?: string;
  /** The story named this exact time (an "at") instead of the clock reaching it. */
  pinned?: boolean;
  /** Who said it, when that is not the thread's host (place chats only). */
  speaker?: string;
  img?: { name: string; alt: string; nsfwVersion?: string };
  /** A chapter break left in the thread as a divider. */
  chapter?: { number: number; title: string; time: string };
  /** A plain time/place divider left in the thread. */
  divider?: { text: string };
};

export type Gate = {
  chat?: string;
  milestone?: string;
  seconds?: number;
  stat?: Partial<Stats>;
  state?: { key: string; is?: string; not?: string; hint: string };
  hint?: string;
};

export type ChoiceOpt = { label: string; say: string; then: Step[]; requires?: Gate; effects?: Partial<Stats> };

export type Profile = { age: number; birthday?: string; tagline: string; interests: string[]; likes: string[]; dislikes: string[] };

export type ContactData = {
  transcript: Item[];
  queue: Step[];
  state: Record<string, string>;
  name: string;
  initial: string;
  unlocked: boolean;
  stats: Stats;
  /** Character combat stats. */
  combat?: CombatStats;
  /** Character type. */
  type?: CharacterType;
  /** Main combat stat name. */
  mainstat?: CombatStatName;
  /** The story clock, in minutes since midnight; the next bubble's time. */
  clock?: number;
  /** Unspent message-length units toward the next story-clock minute (0–49). */
  clockUnits?: number;
};

export type Contact = {
  id: string;
  name: string;
  initial: string;
  color: string;
  /** Picture name (no extension) of the portrait, if the character file names one. */
  avatar?: string;
  teaser: string;
  script: Step[];
  storeKey: string;
  /** Unlocked at the start of a new save; saved progress overrides it. */
  startUnlocked: boolean;
  /** Dev-only character: hidden from the chat list unless Dev mode is on. */
  dev: boolean;
  /** Character type for combat. */
  type?: CharacterType;
  /** Main combat stat. */
  mainstat?: CombatStatName;
  /** Character combat stats. */
  combat?: CombatStats;
  data: ContactData;
};

/**
 * One conversation inside a place. It borrows the chat runner and bubbles, but
 * it is not a contact: no presence line, no profile, or stats; its clock is
 * seeded independently by the place chat.
 */
export type PlaceChatData = {
  transcript: Item[];
  queue: Step[];
  state: Record<string, string>;
  stats: Stats;
  unlocked: boolean;
  done: boolean;
  /** Whether this scene has been entered before, so its cost is only charged once. */
  visited?: boolean;
  /** The story clock, in minutes since midnight; the next bubble's time. */
  clock?: number;
  /** Unspent message-length units toward the next story-clock minute (0–49). */
  clockUnits?: number;
};

export type PlaceChat = {
  id: string;
  title: string;
  teaser: string;
  script: Step[];
  storeKey: string;
  startUnlocked: boolean;
  /** Character file id whose name is the default speaker. */
  host: string;
  /** Story-clock seed in minutes since midnight, e.g. 960 for 16:00. */
  at?: number;
  data: PlaceChatData;
};

export type Place = {
  id: string;
  name: string;
  icon: string;
  color: string;
  teaser: string;
  order: number;
  chats: PlaceChat[];
  /** Ambient sound track for this place, e.g. "rock_concert". */
  ambient?: string;
  /** Dev-only place: hidden from the Places tab unless Dev mode is on. */
  dev: boolean;
};

/** Enemy definition for combat. */
export type Enemy = {
  id: string;
  name: string;
  health: number;
  defense: number;
  attack: number;
  mainstat: number;
  type?: CharacterType;
  description?: string;
};

/** One picture in a gallery folder, revealed or still a placeholder. */
export type GalleryImage = {
  name: string;
  alt: string;
  /** Fallback line; revealed photos use the transcript's caption and time. */
  caption: string;
  /** Portraits are visible from the first launch. */
  revealed?: boolean;
};

/** A gallery folder: one per character, plus "misc" for everything else. */
export type GalleryCategory = {
  id: string;
  title: string;
  images: GalleryImage[];
};

/** The story, assembled from src/story/ by src/engine/story.ts. */
export type Cast = {
  contacts: Record<string, Contact>;
  /** Chat-list order. */
  order: string[];
  /** Dossier per character; a character without one is hidden on the cast tab. */
  profiles: Record<string, Profile>;
  places: Record<string, Place>;
  /** Places-tab order. */
  placeOrder: string[];
  /** `img` step name -> asset URL. */
  assets: Record<string, string>;
  /** Gallery folders, including pictures that have not been revealed yet. */
  gallery: GalleryCategory[];
  /** Enemies keyed by id. */
  enemies: Record<string, Enemy>;
};

/** Equipment slots for the player character. */
export type EquipmentSlot = "leftHand" | "rightHand" | "upperArmor" | "lowerArmor" | "boots";
export type EquipmentItem = { name: string; attack?: number; defense?: number };

export type PlayerInventory = {
  leftHand?: EquipmentItem;
  rightHand?: EquipmentItem;
  upperArmor?: EquipmentItem;
  lowerArmor?: EquipmentItem;
  boots?: EquipmentItem;
  gold: number;
  potions: number;
};

export type PlayerCharacter = {
  name: string;
  rank: string;
  type: CharacterType;
  mainstat: CombatStatName;
  combat: CombatStats;
  inventory: PlayerInventory;
};
