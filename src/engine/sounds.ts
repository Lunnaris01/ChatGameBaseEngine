// Sound: a tiny engine around the Web Audio API.
//
// The story decides what plays. `src/story/assets/sounds/sounds.json` maps an
// event ("them", "me", "choice", "quiz", "stat") to a sound file in the same
// folder, or to null for silence, or to the name of a built-in voice — a short
// tone the engine makes up as it plays, so a story can have sound without
// shipping a single file.
//
// Nothing here is required for a story to work: no config, no files, or a
// browser that blocks audio all mean the same thing — no sound.

export type SoundConfig = {
  /** A hard switch for the story itself; the player's sliders sit on top. */
  enabled?: boolean;
  /** The story's own level for the one-shot sounds, 0–1. */
  volume?: number;
  ambient?: {
    /** Track that plays outside a place, e.g. "night_loop". */
    default?: string | null;
    /** Volume of the ambient track, 0–1. */
    volume?: number;
  };
  /**
   * Event name -> sound file name (without extension), the name of a built-in
   * voice ("synth", "chime", "ping", …), or null for silence.
   */
  events?: Record<string, string | null>;
};

/** The player's three sliders, each 0–1. */
export type SoundVolumes = {
  /** Everything at once. */
  master: number;
  /** The background track only. */
  ambient: number;
  /** The one-shot event sounds only. */
  effects: number;
};

export type SoundPlayer = {
  /** Plays the sound configured for an event, if there is one. */
  play: (event: string) => void;
  /**
   * Plays one sound by name: a file in assets/sounds/ or a built-in voice.
   * `high` picks the rising version of the `synth` voice, for a decision.
   */
  named: (sound: string | null, high?: boolean) => void;
  /** Loops a track (null stops it and returns to the default). */
  ambient: (track: string | null) => void;
  /** Applies the player's three volume sliders, each 0–1. */
  setVolumes: (volumes: SoundVolumes) => void;
  /** Called on the first user gesture: browsers only allow audio after one. */
  unlock: () => void;
};

type AudioContextCtor = typeof AudioContext;

const isSoundFile = (name: string | null | undefined): name is string =>
  typeof name === "string" && name.trim() !== "" && name.trim().toLowerCase() !== "none";

/** Where a voice sends its sound: the effects bus, so every slider applies. */
type Out = AudioNode;

/**
 * A short tone that sweeps up or down under a soft envelope. It is the
 * building block every other voice is made of.
 */
const blip = (
  ctx: AudioContext,
  out: Out,
  gain: number,
  from: number,
  to: number,
  length = 0.16,
  type: OscillatorType = "sine",
): void => {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const now = ctx.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + length * 0.6);
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, now + length);
  osc.connect(env).connect(out);
  osc.start(now);
  osc.stop(now + length + 0.02);
};

/** One note with a soft attack and a long tail. */
const note = (
  ctx: AudioContext,
  out: Out,
  gain: number,
  hz: number,
  at: number,
  length: number,
  type: OscillatorType = "sine",
): void => {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const now = ctx.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(hz, now);
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(gain, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, now + length);
  osc.connect(env).connect(out);
  osc.start(now);
  osc.stop(now + length + 0.02);
};

const noiseCache = new WeakMap<AudioContext, AudioBuffer>();

/** A half second of white noise, for the airy voices. */
const noise = (ctx: AudioContext): AudioBuffer => {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buffer);
  return buffer;
};

/** A burst of filtered noise: a swoosh or a key tick. */
const rustle = (
  ctx: AudioContext,
  out: Out,
  gain: number,
  from: number,
  to: number,
  length: number,
  filter: BiquadFilterType,
): void => {
  const source = ctx.createBufferSource();
  const band = ctx.createBiquadFilter();
  const env = ctx.createGain();
  const now = ctx.currentTime;
  source.buffer = noise(ctx);
  band.type = filter;
  band.frequency.setValueAtTime(from, now);
  band.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + length);
  band.Q.value = 1.2;
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(gain, now + length * 0.3);
  env.gain.exponentialRampToValueAtTime(0.0001, now + length);
  source.connect(band).connect(env).connect(out);
  source.start(now);
  source.stop(now + length + 0.02);
};

/**
 * The built-in voices. A story can use any of these by name in
 * `sounds.json` — no file, no download, nothing to ship.
 */
export const VOICES: Record<string, (ctx: AudioContext, out: Out, gain: number, high: boolean) => void> = {
  /** A plain blip. Rises for a decision, falls for everything else. */
  synth: (ctx, out, gain, high) =>
    high ? blip(ctx, out, gain, 880, 1320) : blip(ctx, out, gain, 660, 520),
  /** The same blip, always rising. */
  rise: (ctx, out, gain) => blip(ctx, out, gain, 880, 1320),
  /** The same blip, always falling. */
  fall: (ctx, out, gain) => blip(ctx, out, gain, 660, 520),
  /** Two soft notes, up: a friendly little chime. */
  chime: (ctx, out, gain) => {
    note(ctx, out, gain * 0.8, 784, 0, 0.26);
    note(ctx, out, gain * 0.7, 1175, 0.1, 0.34);
  },
  /** A bright bell, for something that deserves attention. */
  ping: (ctx, out, gain) => {
    note(ctx, out, gain * 0.6, 1568, 0, 0.5);
    note(ctx, out, gain * 0.3, 2350, 0, 0.35);
  },
  /** A short plop. */
  pop: (ctx, out, gain) => blip(ctx, out, gain, 420, 110, 0.1),
  /** A low thump, for a stat moving. */
  thud: (ctx, out, gain) => blip(ctx, out, gain, 150, 70, 0.22),
  /** A quick run of notes, like a sparkle. */
  sparkle: (ctx, out, gain) => {
    note(ctx, out, gain * 0.5, 1047, 0, 0.14);
    note(ctx, out, gain * 0.5, 1319, 0.06, 0.14);
    note(ctx, out, gain * 0.5, 1568, 0.12, 0.2);
  },
  /** A swoosh, for something arriving or moving on. */
  whoosh: (ctx, out, gain) => rustle(ctx, out, gain, 500, 4000, 0.28, "bandpass"),
  /** A tiny key tick, for typing. */
  type: (ctx, out, gain) => rustle(ctx, out, gain * 0.7, 3000, 1800, 0.045, "highpass"),

  // Five short, quiet chat sounds, in the same family as `rise` and `fall`:
  // a sweep or two soft notes, over in a moment, never bright or loud enough to
  // pull attention away from what is being read.
  /** A short step up, low. */
  chat1: (ctx, out, gain) => blip(ctx, out, gain * 0.55, 520, 660, 0.14),
  /** A short step down, low. */
  chat2: (ctx, out, gain) => blip(ctx, out, gain * 0.55, 660, 520, 0.14),
  /** A low warm lift. */
  chat3: (ctx, out, gain) => blip(ctx, out, gain * 0.5, 329.63, 392, 0.16),
  /** A fifth, swept upward. */
  chat4: (ctx, out, gain) => blip(ctx, out, gain * 0.45, 587.33, 880, 0.18),
  /** A brief, low tick. */
  chat5: (ctx, out, gain) => blip(ctx, out, gain * 0.4, 1000, 900, 0.07),

};

export function createSounds(
  files: Record<string, string>,
  config: SoundConfig | undefined,
): SoundPlayer {
  const events = config?.events ?? {};
  /** The story's own levels; the player's sliders multiply these. */
  const effectsBase = config?.volume ?? 0.6;
  const ambientBase = config?.ambient?.volume ?? 0.22;
  const defaultAmbient = config?.ambient?.default ?? null;
  const enabled = config?.enabled !== false;
  let volumes: SoundVolumes = { master: 1, ambient: 1, effects: 1 };

  let ctx: AudioContext | null = null;
  // masterGain -> the speakers; the two buses hang off it, so a slider on one
  // never disturbs the other.
  let masterGain: GainNode | null = null;
  let effectsBus: GainNode | null = null;
  let ambientBus: GainNode | null = null;
  const buffers = new Map<string, AudioBuffer>();
  let ambientSource: AudioBufferSourceNode | null = null;
  let ambientGain: GainNode | null = null;
  let currentAmbient: string | null = null;
  let unlocked = false;

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      masterGain = ctx.createGain();
      effectsBus = ctx.createGain();
      ambientBus = ctx.createGain();
      masterGain.gain.value = volumes.master;
      effectsBus.gain.value = volumes.effects;
      ambientBus.gain.value = volumes.ambient;
      effectsBus.connect(masterGain);
      ambientBus.connect(masterGain);
      masterGain.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  };

  /** The URL of a sound file: by name, or by a path that ends with it. */
  const urlFor = (name: string): string | undefined => {
    if (files[name]) return files[name];
    const path = name.includes("/") ? name : `sounds/${name}`;
    if (files[path]) return files[path];
    const hits = Object.keys(files).filter((key) => key.endsWith(`/${name}`));
    return hits.length === 1 ? files[hits[0]] : undefined;
  };

  const decode = async (url: string): Promise<AudioBuffer | null> => {
    const audio = context();
    if (!audio) return null;
    const cached = buffers.get(url);
    if (cached) return cached;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      const buffer = await audio.decodeAudioData(data);
      buffers.set(url, buffer);
      return buffer;
    } catch {
      return null;
    }
  };

  const stopAmbient = (): void => {
    if (!ambientSource) return;
    const source = ambientSource;
    const gain = ambientGain;
    ambientSource = null;
    ambientGain = null;
    if (gain && ctx) {
      // A short fade, so swapping tracks does not click.
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      window.setTimeout(() => {
        try { source.stop(); } catch { /* already stopped */ }
      }, 400);
    } else {
      try { source.stop(); } catch { /* already stopped */ }
    }
  };

  const startAmbient = async (name: string): Promise<void> => {
    const url = urlFor(name);
    if (!url) return;
    const buffer = await decode(url);
    const audio = context();
    if (!buffer || !audio || !ambientBus) return;
    if (currentAmbient !== name) return;
    if (volumes.master === 0 || volumes.ambient === 0) return;
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.0001;
    source.connect(gain).connect(ambientBus);
    source.start();
    gain.gain.linearRampToValueAtTime(ambientBase, audio.currentTime + 0.8);
    ambientSource = source;
    ambientGain = gain;
  };

  const player: SoundPlayer = {
    play(event: string): void {
      player.named(events[event] ?? null, event === "quiz" || event === "choice");
    },

    named(sound: string | null, high = false): void {
      if (!enabled) return;
      if (volumes.master === 0 || volumes.effects === 0) return;
      const audio = context();
      if (!audio || !effectsBus) return;
      if (typeof sound === "string" && sound.trim() !== "" && VOICES[sound]) {
        VOICES[sound](audio, effectsBus, effectsBase * 0.5, high);
        return;
      }
      if (!isSoundFile(sound)) return;
      const url = urlFor(sound);
      if (!url) return;
      void decode(url).then((buffer) => {
        if (!buffer || !ctx || !effectsBus) return;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = effectsBase;
        source.connect(gain).connect(effectsBus);
        source.start();
      });
    },

    ambient(track: string | null): void {
      if (!enabled) return;
      const wanted = track ?? defaultAmbient;
      if (wanted === currentAmbient) return;
      currentAmbient = wanted;
      stopAmbient();
      if (!isSoundFile(wanted)) return;
      void startAmbient(wanted);
    },

    setVolumes(next: SoundVolumes): void {
      const clamp = (value: number): number =>
        Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
      volumes = { master: clamp(next.master), ambient: clamp(next.ambient), effects: clamp(next.effects) };
      if (!ctx || !masterGain || !effectsBus || !ambientBus) return;
      const now = ctx.currentTime;
      // A short ramp, so dragging a slider never clicks.
      masterGain.gain.setTargetAtTime(volumes.master, now, 0.02);
      effectsBus.gain.setTargetAtTime(volumes.effects, now, 0.02);
      ambientBus.gain.setTargetAtTime(volumes.ambient, now, 0.02);
      // Silence the loop itself when it cannot be heard, to save the CPU.
      const quiet = volumes.master === 0 || volumes.ambient === 0;
      if (quiet && ambientSource) stopAmbient();
      else if (!quiet && !ambientSource && currentAmbient) void startAmbient(currentAmbient);
    },

    unlock(): void {
      if (unlocked) return;
      unlocked = true;
      const audio = context();
      if (audio && audio.state === "suspended") void audio.resume();
    },
  };

  return player;
}
