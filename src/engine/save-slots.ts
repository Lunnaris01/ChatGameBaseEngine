import type { Contact, Item, Place, PlaceChat, Stats, Step } from "./types";
import type { PlayerCharacter } from "./types";
import type { GameStorage } from "./storage";

export type SaveThread = {
  transcript: Item[];
  queue: Step[];
  state: Record<string, string>;
  stats: Stats;
  name?: string;
  initial?: string;
  unlocked?: boolean;
  done?: boolean;
  visited?: boolean;
  clock?: number;
  clockUnits?: number;
};

export type SaveFile = {
  version: 1;
  savedAt: string;
  playerName?: string;
  player?: PlayerCharacter | null;
  threads: Record<string, SaveThread>;
};

export type SaveSlotsContext = {
  storage: GameStorage;
  slots: number;
  contacts: Record<string, Contact>;
  order: string[];
  places: Record<string, Place>;
  placeOrder: string[];
  statStart: Stats;
  restoredClockUnits: (value: unknown) => number;
  cancelRun: () => void;
  cancelPendingInteraction: () => void;
  getPlayerName: () => string;
  setPlayerName: (value: string) => void;
  getPlayerCharacter: () => PlayerCharacter | null;
  setPlayerCharacter: (value: PlayerCharacter | null) => void;
  persistPlayerCharacter: (pc: PlayerCharacter | null) => void;
  saveContactThread: (contact: Contact) => void;
  savePlaceThread: (place: Place, chat: PlaceChat) => void;
  setSaveStatus: (text: string, error?: boolean) => void;
  renderSaveSlots: () => void;
  savePanelTitle: HTMLElement;
  captureThreads: () => Record<string, SaveThread>;
  clearCurrent: () => void;
  clearRefreshChoices: () => void;
};

export const slotKey = (slot: number): string => `sr-save-${slot}`;

export function hasSave(ctx: SaveSlotsContext, slot: number): boolean {
  try {
    return ctx.storage.getItem(slotKey(slot)) !== null;
  } catch {
    return false;
  }
}

export function readSave(ctx: SaveSlotsContext, slot: number): SaveFile | null {
  try {
    const raw = ctx.storage.getItem(slotKey(slot));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<SaveFile>;
    if (
      candidate.version !== 1 ||
      typeof candidate.savedAt !== "string" ||
      (candidate.playerName !== undefined && typeof candidate.playerName !== "string") ||
      (candidate.player !== undefined && (typeof candidate.player !== "object" || candidate.player === null)) ||
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

export function saveToSlot(ctx: SaveSlotsContext, slot: number): boolean {
  const save: SaveFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    playerName: ctx.getPlayerName(),
    player: ctx.getPlayerCharacter(),
    threads: ctx.captureThreads(),
  };
  try {
    ctx.storage.setItem(slotKey(slot), JSON.stringify(save));
  } catch {
    ctx.setSaveStatus("Could not save — storage is full or blocked.", true);
    return false;
  }
  ctx.setSaveStatus(`Saved to slot ${slot}.`);
  ctx.renderSaveSlots();
  ctx.savePanelTitle.focus();
  return true;
}

export function applySave(ctx: SaveSlotsContext, save: SaveFile): void {
  ctx.cancelRun();
  ctx.cancelPendingInteraction();
  ctx.clearCurrent();
  ctx.clearRefreshChoices();

  for (const id of ctx.order) {
    const contact = ctx.contacts[id];
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
          ? { ...ctx.statStart, ...saved.stats }
          : { ...ctx.statStart },
      clock: typeof saved?.clock === "number" && Number.isFinite(saved.clock) ? saved.clock : undefined,
      clockUnits: ctx.restoredClockUnits(saved?.clockUnits),
    };
    ctx.saveContactThread(contact);
  }

  for (const placeId of ctx.placeOrder) {
    const place = ctx.places[placeId];
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
            ? { ...ctx.statStart, ...saved.stats }
            : { ...ctx.statStart },
        unlocked:
          typeof saved?.unlocked === "boolean" ? saved.unlocked : chat.startUnlocked,
        done: saved?.done === true,
        visited: saved?.visited === true || saved?.done === true ||
          (saved?.transcript?.length ?? 0) > 0 || (saved?.queue?.length ?? 0) > 0,
        clock: typeof saved?.clock === "number" && Number.isFinite(saved.clock) ? saved.clock : undefined,
        clockUnits: ctx.restoredClockUnits(saved?.clockUnits),
      };
      ctx.savePlaceThread(place, chat);
    }
  }

  if (typeof save.playerName === "string") {
    ctx.setPlayerName(save.playerName.trim());
  } else {
    ctx.setPlayerName("");
    ctx.setPlayerCharacter(null);
    try { ctx.storage.removeItem("sr-player"); } catch { /* ignore */ }
    for (const id of ctx.order) {
      const savedName = ctx.contacts[id].data.state.name;
      if (typeof savedName === "string" && savedName.trim()) {
        ctx.setPlayerName(savedName.trim());
        break;
      }
    }
  }

  if (save.player && typeof save.player === "object") {
    ctx.setPlayerCharacter(save.player as PlayerCharacter);
    ctx.persistPlayerCharacter(ctx.getPlayerCharacter());
  }
  try {
    const name = ctx.getPlayerName();
    if (name) ctx.storage.setItem("sr-name", name);
    else ctx.storage.removeItem("sr-name");
  } catch {
    /* loaded game still works for this session */
  }
}

export function loadFromSlot(ctx: SaveSlotsContext, slot: number): boolean {
  const save = readSave(ctx, slot);
  if (!save) {
    ctx.setSaveStatus(`Slot ${slot} could not be read.`, true);
    return false;
  }
  applySave(ctx, save);
  ctx.setSaveStatus(`Loaded slot ${slot}. Your chats are back.`);
  return true;
}