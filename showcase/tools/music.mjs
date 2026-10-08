// The showcase's score, synthesised: an 8-bit track (square, triangle, noise)
// with every sound effect baked in at the cut's absolute times, written to
// media/music.wav (44.1 kHz, 16-bit, mono). node showcase/tools/music.mjs
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SR = 44100
const LENGTH = 64.5
const out = new Float32Array(Math.ceil(SR * LENGTH))

// --- instruments -------------------------------------------------------------
const midi = (m) => 440 * 2 ** ((m - 69) / 12)
const N = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** "E5" → midi number; "-" is a rest */
const note = (s) => (s === '-' ? null : N[s[0]] + (s[1] === '#' ? 1 : 0) + 12 * (Number(s[s.length - 1]) + 1))
let seed = 1
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

/** Adds a tone: `wave` square (with duty), tri, sine, noise; a quick attack and an exponential decay. */
function tone({ at, dur, freq, wave = 'square', vol = 0.2, duty = 0.25, decay = 6, slide = 0, vib = 0 }) {
  const n0 = Math.floor(at * SR), n1 = Math.min(out.length, Math.floor((at + dur) * SR))
  let phase = 0
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR, u = t / dur
    const f = (freq ?? 0) * 2 ** ((slide * u) / 12) * (1 + vib * Math.sin(2 * Math.PI * 6 * t))
    phase += f / SR
    const p = phase - Math.floor(phase)
    let s
    if (wave === 'square') s = p < duty ? 1 : -1
    else if (wave === 'tri') s = 4 * Math.abs(p - 0.5) - 1
    else if (wave === 'sine') s = Math.sin(2 * Math.PI * p)
    else s = rnd() * 2 - 1
    const env = Math.min(1, t / 0.004) * Math.exp(-decay * u)
    out[n] += s * env * vol
  }
}

// --- the sequencer -------------------------------------------------------------
const BPM = 130
const BEAT = 60 / BPM
/** Plays `pattern` ("E5 G5 - A5", one token per `step` beats) from `at`, `times` over. */
function play(at, pattern, { step = 0.5, wave = 'square', vol = 0.16, duty = 0.25, decay = 5, times = 1, octave = 0 } = {}) {
  const toks = pattern.trim().split(/\s+/)
  for (let r = 0; r < times; r++)
    toks.forEach((tok, i) => {
      const m = note(tok)
      if (m == null) return
      tone({ at: at + (r * toks.length + i) * step * BEAT, dur: step * BEAT * 0.9, freq: midi(m + 12 * octave), wave, vol, duty, decay })
    })
  return at + times * toks.length * step * BEAT
}
function hats(at, beats, { every = 0.5, vol = 0.05 } = {}) {
  for (let b = 0; b < beats; b += every) tone({ at: at + b * BEAT, dur: 0.04, wave: 'noise', vol, decay: 10 })
}

// --- effects -----------------------------------------------------------------------
const whoosh = (at) => tone({ at, dur: 0.12, wave: 'noise', vol: 0.22, decay: 4 })
const hit = (at) => {
  tone({ at, dur: 0.25, freq: 55, wave: 'sine', vol: 0.5, decay: 8 })
  tone({ at, dur: 0.08, wave: 'noise', vol: 0.3, decay: 12 })
}
const pop = (at) => {
  tone({ at, dur: 0.07, freq: 520, wave: 'sine', vol: 0.3, decay: 10, slide: -12 })
  tone({ at, dur: 0.02, wave: 'noise', vol: 0.15, decay: 20 })
}
const ding = (at) => {
  ;['C5', 'E5', 'G5', 'C6'].forEach((n, i) => tone({ at: at + i * 0.06, dur: 0.5, freq: midi(note(n)), wave: 'square', duty: 0.5, vol: 0.14, decay: 4 }))
  tone({ at: at + 0.24, dur: 1.2, freq: midi(note('C6')), wave: 'tri', vol: 0.12, decay: 3 })
}
const scratch = (at) => {
  tone({ at, dur: 0.3, freq: 900, wave: 'square', duty: 0.5, vol: 0.18, decay: 3, slide: -30, vib: 0.3 })
  tone({ at, dur: 0.3, wave: 'noise', vol: 0.12, decay: 6 })
}

// --- the cut (the times are lib.rs's) ------------------------------------------------
// A. cold open: a sting, the freeze with a record scratch, a rewind
hit(0.2)
tone({ at: 0.2, dur: 1.0, freq: midi(note('C2')), wave: 'square', duty: 0.5, vol: 0.12, decay: 2 })
scratch(1.0)
tone({ at: 1.1, dur: 1.6, freq: midi(note('C2')), wave: 'tri', vol: 0.08, decay: 1 })
;['C5', 'E5', 'G5', 'C6', 'E6', 'G6'].forEach((n, i) => tone({ at: 2.7 + i * 0.06, dur: 0.05, freq: midi(note(n)), wave: 'square', vol: 0.1, decay: 2 }))

// B. the day: a bright loop, then softer and lower as the day wears on, then the staccato hits
let t = 3.2
const dayMelody = 'E5 G5 A5 G5 E5 D5 C5 D5  E5 G5 A5 C6 B5 A5 G5 -  C6 B5 A5 G5 A5 G5 E5 D5  C5 D5 E5 G5 E5 - - -'
const dayBass = 'C3 C3 G2 G2 A2 A2 F2 F2'
play(t, dayMelody, { vol: 0.15 })
play(t, dayBass, { step: 1, wave: 'tri', vol: 0.2, decay: 2, times: 2 })
hats(t, 16)
play(t + 16 * BEAT, dayMelody.split('  ').slice(0, 2).join('  '), { vol: 0.1, octave: -1, duty: 0.5 })
hats(t + 16 * BEAT, 6, { every: 1 })
for (const at of [10.0, 12.0, 12.5, 13.0]) {
  hit(at)
  tone({ at, dur: 0.2, freq: midi(note('C3')), wave: 'square', duty: 0.5, vol: 0.14, decay: 6 })
}
// the snap zoom on the belly: a thump, a boing, the pointer's pings
hit(13.5)
tone({ at: 13.52, dur: 0.35, freq: 320, wave: 'square', duty: 0.5, vol: 0.14, decay: 3, slide: -14, vib: 0.4 })
for (let n = 0; n < 3; n++) tone({ at: 13.75 + n * 0.36, dur: 0.12, freq: midi(note('G6')), wave: 'sine', vol: 0.1, decay: 8 })

// C. the realization: a sparse minor arpeggio, the "!", the idea
play(15.1, 'A3 - C4 - E4 - - -  A3 - C4 - E4 - G4 -', { step: 0.25, wave: 'tri', vol: 0.16, decay: 3 })
tone({ at: 16.2, dur: 0.12, freq: midi(note('A5')), wave: 'square', vol: 0.16, decay: 6 })
ding(16.8)
whoosh(17.7)

// D. the build: driving arpeggios, hats, a riser into the crash
t = 18.6
for (let n = 0; n < 40; n++) {
  const r = note(['C', 'D', 'E', 'F'][Math.floor(n / 16) % 4] + '4')
  const d = [0, 4, 7, 12, 7, 4, 0, 4, 7, 12, 7, 4, 0, 4, 7, 12][n % 16]
  tone({ at: t + n * 0.25 * BEAT, dur: 0.25 * BEAT * 0.8, freq: midi(r + d), wave: 'square', vol: 0.13, decay: 6 })
}
for (let bar = 0; bar < 3; bar++) tone({ at: t + bar * 4 * BEAT, dur: 4 * BEAT, freq: midi(note(['C', 'D', 'E'][bar] + '2')), wave: 'tri', vol: 0.18, decay: 1 })
hats(t, 10, { every: 0.25, vol: 0.04 })
for (let n = 0; n < 24; n++) tone({ at: 22.6 + n * 0.033, dur: 0.05, freq: 200 * 2 ** (n / 8), wave: 'square', vol: 0.05 + n * 0.006, decay: 2 })

// E. the title crash and the main theme, through the demo, the levels and the workout
hit(23.4)
;['C4', 'E4', 'G4', 'C5'].forEach((n) => tone({ at: 23.4, dur: 1.4, freq: midi(note(n)), wave: 'square', duty: 0.5, vol: 0.09, decay: 2 }))
t = 24.1
const theme = 'G5 G5 A5 C6 B5 G5 E5 -  C6 B5 A5 G5 A5 - G5 -  E5 G5 A5 C6 D6 C6 B5 A5  G5 - E5 - C5 - - -'
const themeBass = 'C3 C4 C3 C4 G2 G3 G2 G3 A2 A3 A2 A3 F2 F3 F2 F3'
const bars = 18
for (let r = 0; r < 4; r++) play(t + r * 16 * BEAT, theme, { vol: 0.15 })
for (let r = 0; r < bars / 2; r++) play(t + r * 8 * BEAT, themeBass, { step: 0.5, wave: 'tri', vol: 0.2, decay: 3 })
hats(t, bars * 4 - 2, { every: 0.5 })
// the demo: the bars growing, the pick's tick, the band's pop, the hillclimb rising, the plateau's ding
for (let n = 0; n < 7; n++) tone({ at: 30.1 + n * 0.09, dur: 0.08, freq: 300 + n * 60, wave: 'square', vol: 0.06, decay: 6 })
tone({ at: 31.6, dur: 0.1, freq: midi(note('E6')), wave: 'square', vol: 0.14, decay: 8 })
pop(32.45)
;['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'C7'].forEach((n, i) => tone({ at: 35.3 + i * 0.21, dur: 0.18, freq: midi(note(n)), wave: 'square', vol: 0.09, decay: 5 }))
ding(38.0)
// the workout for real: a huff on each squat, a ding as the belly goes
for (let n = 0; n < 4; n++) tone({ at: 50.2 + n * 1.85, dur: 0.12, wave: 'noise', vol: 0.16, decay: 8 })
ding(55.0)
// the bow: a fanfare and confetti
play(57.0, 'G5 G5 G5 C6', { step: 0.25, vol: 0.18, duty: 0.5 })
;['E6', 'G6', 'C7'].forEach((n, i) => tone({ at: 57.4 + i * 0.1, dur: 0.6, freq: midi(note(n)), wave: 'square', duty: 0.5, vol: 0.12, decay: 3 }))
for (let i = 0; i < 6; i++) pop(57.2 + i * 0.17 + rnd() * 0.05)

// F. the end card: a held chord, out
;['C3', 'G3', 'C4', 'E4', 'G4'].forEach((n) => tone({ at: 59.5, dur: 4, freq: midi(note(n)), wave: n[1] === '3' ? 'tri' : 'square', duty: 0.5, vol: 0.08, decay: 1.2 }))

// the captions' whooshes
for (const at of [1.0, 3.7, 6.5, 8.3, 15.6, 17.7, 19.2, 21.6, 24.6, 26.6, 28.4, 30.0, 31.65, 33.2, 35.0, 36.6, 39.3, 41.6, 43.5, 44.7, 46.2, 51.0, 53.4, 55.0, 58.0, 60.5, 61.0]) whoosh(at)

// --- master: a soft limiter, a fade at the end, 16-bit PCM --------------------------------
const pcm = new Int16Array(out.length)
for (let n = 0; n < out.length; n++) {
  const fade = Math.min(1, (LENGTH - n / SR) / 1.5)
  pcm[n] = Math.round(Math.tanh(out[n] * 1.6) * 0.9 * fade * 32767)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length * 2, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(pcm.length * 2, 40)
writeFileSync(join(ROOT, 'media', 'music.wav'), Buffer.concat([header, Buffer.from(pcm.buffer)]))
console.log(`music.wav: ${LENGTH}s`)
