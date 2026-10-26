const STORAGE_KEY = "sr-quickbar-v2";
const DEFAULT_QUICKBAR = ["list", "places", "chars", "settings"];

export { DEFAULT_QUICKBAR };

export function loadQuickbar(storage: { getItem(key: string): string | null }): string[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter((x) => typeof x === "string");
        if (filtered.length > 0) return filtered;
      }
    }
  } catch { /* ignore */ }
  return [...DEFAULT_QUICKBAR];
}

export function saveQuickbar(storage: { setItem(key: string, value: string): void }, sections: string[]): void {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(sections)); } catch { /* ignore */ }
}