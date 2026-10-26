/** The subset of Storage needed by the app; easy to replace in tests. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key"> & { readonly length: number };

export type GameStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  entries(): Record<string, string>;
  replace(entries: Record<string, string>): void;
};

const PREFERENCES = new Set([
  "sr-text-speed",
  "sr-vol-master",
  "sr-vol-ambient",
  "sr-vol-effects",
  "sr-show-stats",
  "sr-dev",
  "sr-nsfw",
  "sr-name",
  "sr-quickbar",
  "sr-quickbar-v2",
  "sr-quickbar-open",
  "sr-home-background",
  "sr-sound",
  "sr-dev-mode",
  "sr-debug",
]);

export function isGameStorageKey(key: string): boolean {
  return (
    PREFERENCES.has(key) ||
    key === "sr-player" ||
    key.startsWith("sr-chat-") ||
    key.startsWith("sr-place-") ||
    /^sr-save-[1-6]$/.test(key)
  );
}

/** Namespaces previews so they can never overwrite a player's real save. */
export function createGameStorage(backing: KeyValueStore, namespace = ""): GameStorage {
  const scoped = (key: string): string => `${namespace}${key}`;
  const entries = (): Record<string, string> => {
    const result: Record<string, string> = {};
    for (let index = 0; index < backing.length; index++) {
      const rawKey = backing.key(index);
      if (!rawKey || !rawKey.startsWith(namespace)) continue;
      const key = rawKey.slice(namespace.length);
      if (!isGameStorageKey(key)) continue;
      const value = backing.getItem(rawKey);
      if (value !== null) result[key] = value;
    }
    return result;
  };

  const clear = (): void => {
    const keys: string[] = [];
    for (let index = 0; index < backing.length; index++) {
      const key = backing.key(index);
      if (key?.startsWith(namespace) && isGameStorageKey(key.slice(namespace.length))) keys.push(key);
    }
    for (const key of keys) backing.removeItem(key);
  };

  return {
    getItem: (key) => backing.getItem(scoped(key)),
    setItem: (key, value) => backing.setItem(scoped(key), value),
    removeItem: (key) => backing.removeItem(scoped(key)),
    clear,
    entries,
    replace(next) {
      const unsupported = Object.keys(next).find((key) => !isGameStorageKey(key));
      if (unsupported) throw new Error(`Unsupported game data key: ${unsupported}`);
      clear();
      for (const [key, value] of Object.entries(next)) {
        backing.setItem(scoped(key), value);
      }
    },
  };
}

/** In-memory fallback keeps the game usable when browser storage is blocked. */
export function createMemoryStorage(): KeyValueStore {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}
