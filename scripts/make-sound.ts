// Writes a short story sound file without dependencies or downloads.
//
//   bun scripts/make-sound.ts             # a notification chime
//   bun scripts/make-sound.ts --ambient   # a seamless local ambience loop
//
// It needs no dependencies and no downloads: a couple of sine waves with a
// soft envelope, written straight out as a 16-bit PCM WAV. Edit the notes at
// the top and run it again to hear a different chime.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const root = join(dirname(fileURLToPath(import.meta.url)), "../src/story/assets/sounds");
const ambientMode = process.argv.includes("--ambient");
const OUT = ambientMode
  ? join(root, "mai/room/ambience.wav")
  : join(root, "them_chime.wav");

/** The chime: a soft two-note rise, like a message arriving. */
const NOTES = [
  { hz: 783.99, at: 0.0, len: 0.26, gain: 0.5 }, // G5
  { hz: 1174.66, at: 0.1, len: 0.34, gain: 0.42 }, // D6
];

const seconds = ambientMode ? 3 : 0.5;
const samples = new Float32Array(Math.round(RATE * seconds));

if (ambientMode) {
  // Integer-cycle tones meet at the loop boundary without a click.
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] = Math.sin(2 * Math.PI * 110 * t) * 0.07 + Math.sin(2 * Math.PI * 164 * t) * 0.035;
  }
} else {
  for (const note of NOTES) {
    const start = Math.round(note.at * RATE);
    const length = Math.round(note.len * RATE);
    for (let i = 0; i < length && start + i < samples.length; i++) {
      const t = i / RATE;
      // A soft attack, a quick decay, and a little harmonic so it is not flat.
      const envelope = Math.min(1, t / 0.006) * Math.exp(-t * 9);
      const wave =
        Math.sin(2 * Math.PI * note.hz * t) * 0.85 +
        Math.sin(2 * Math.PI * note.hz * 2 * t) * 0.12 +
        Math.sin(2 * Math.PI * note.hz * 3 * t) * 0.05;
      samples[start + i] += wave * envelope * note.gain;
    }
  }
}

// Normalize the notification chime to about -3 dB; keep ambience intentionally quiet.
let peak = 0;
for (const value of samples) peak = Math.max(peak, Math.abs(value));
const scale = ambientMode || peak === 0 ? 1 : 0.7 / peak;

const pcm = Buffer.alloc(samples.length * 2);
for (let i = 0; i < samples.length; i++) {
  const value = Math.max(-1, Math.min(1, samples[i] * scale));
  pcm.writeInt16LE(Math.round(value * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, pcm]));
console.log(`wrote ${OUT} (${44 + pcm.length} bytes, ${seconds}s)`);
