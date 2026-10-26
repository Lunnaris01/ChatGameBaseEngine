import type { SoundPlayer } from "./sounds";

export const VOLUME_DEFAULT = 100;
export type VolumeKey = "master" | "ambient" | "effects";
export const VOLUME_KEYS: Record<VolumeKey, string> = {
  master: "sr-vol-master",
  ambient: "sr-vol-ambient",
  effects: "sr-vol-effects",
};

export function readVolume(storage: { getItem(key: string): string | null }, key: VolumeKey): number {
  try {
    const raw = storage.getItem(VOLUME_KEYS[key]);
    const value = raw === null ? NaN : Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= 100) return value;
  } catch { /* ignore */ }
  return VOLUME_DEFAULT;
}

export function migrateSound(storage: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }): void {
  try {
    const legacy = storage.getItem("sr-sound");
    if (legacy === null) return;
    if (storage.getItem(VOLUME_KEYS.master) === null) {
      const level = legacy === "off" ? 0 : VOLUME_DEFAULT;
      for (const key of Object.values(VOLUME_KEYS)) storage.setItem(key, String(level));
    }
    storage.removeItem("sr-sound");
  } catch { /* ignore */ }
}

export function applyVolumes(sounds: SoundPlayer, volumes: Record<VolumeKey, number>): void {
  sounds.setVolumes({
    master: volumes.master / 100,
    ambient: volumes.ambient / 100,
    effects: volumes.effects / 100,
  });
}