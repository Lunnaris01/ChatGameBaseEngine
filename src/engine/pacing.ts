export type MessageDelays = { typing: number; pause: number };

const TYPE_BASE_MS = 300;
const TYPE_PER_CHARACTER_MS = 14;
const TYPE_MIN_MS = 350;
const TYPE_MAX_MS = 3_200;
const PAUSE_BASE_MS = 180;
const PAUSE_PER_WORD_MS = 35;
const PAUSE_MIN_MS = 180;
const PAUSE_MAX_MS = 1_200;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/** Default beats: typing scales with visible length, the reply pause with words. */
export function messageDelays(text: string): MessageDelays {
  const trimmed = text.trim();
  const characters = Array.from(trimmed).length;
  const words = trimmed.match(/\S+/gu)?.length ?? 0;
  return {
    typing: clamp(TYPE_BASE_MS + characters * TYPE_PER_CHARACTER_MS, TYPE_MIN_MS, TYPE_MAX_MS),
    pause: clamp(PAUSE_BASE_MS + words * PAUSE_PER_WORD_MS, PAUSE_MIN_MS, PAUSE_MAX_MS),
  };
}
