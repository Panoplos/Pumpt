// Renders every exercise clip to an animated GIF under docs/gifs/<id>.gif for
// the README, on a solid dark card (GIF has 1-bit transparency, so a soft
// pixel-art edge needs a background to sit on).
//
// Usage: node tools/make-gifs.mjs [--scale 3] [id ...]
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXERCISES, SIZE, FPS, renderFrame } from '../hooks/pixi.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const si = args.indexOf('--scale')
const SCALE = si < 0 ? 3 : Number(args[si + 1])
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--scale')
const picked = ids.length ? EXERCISES.filter((e) => ids.includes(e.id)) : EXERCISES

const BG = [0x1b, 0x1b, 0x2a]
const W = SIZE * SCALE

/** One frame as packed 0xRRGGBB pixels: the sprite over the card, upscaled. */
function compose(canvas) {
  const out = new Uint32Array(W * W)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const s = (y * SIZE + x) * 4
      const a = canvas.rgba[s + 3] / 255
      const c = [0, 1, 2].map((k) => Math.round(canvas.rgba[s + k] * a + BG[k] * (1 - a)))
      const px = (c[0] << 16) | (c[1] << 8) | c[2]
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) out[(y * SCALE + dy) * W + x * SCALE + dx] = px
    }
  return out
}

/** A palette of at most 256 colours (the most used) and each frame as indexes into it. */
function quantize(frames) {
  const count = new Map()
  for (const f of frames) for (const px of f) count.set(px, (count.get(px) ?? 0) + 1)
  const palette = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(([px]) => px)
  const index = new Map(palette.map((px, i) => [px, i]))
  const nearest = (px) => {
    let best = 0, bd = Infinity
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]
      const d = ((px >> 16) - (p >> 16)) ** 2 + (((px >> 8) & 255) - ((p >> 8) & 255)) ** 2 + ((px & 255) - (p & 255)) ** 2
      if (d < bd) bd = d, best = i
    }
    return best
  }
  const lookup = (px) => index.get(px) ?? (index.set(px, nearest(px)), index.get(px))
  return { palette, frames: frames.map((f) => Uint8Array.from(f, lookup)) }
}

/** GIF's variable-width LZW. */
function lzw(pixels, minCode) {
  const clear = 1 << minCode, end = clear + 1
  const bytes = []
  let acc = 0, bits = 0
  const emit = (code, size) => {
    acc |= code << bits
    bits += size
    while (bits >= 8) bytes.push(acc & 255), (acc >>= 8), (bits -= 8)
  }
  let size = minCode + 1, next = end + 1
  let dict = new Map()
  emit(clear, size)
  let prefix = pixels[0]
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = prefix * 256 + k
    const hit = dict.get(key)
    if (hit !== undefined) { prefix = hit; continue }
    emit(prefix, size)
    if (next > (1 << size) - 1 && size < 12) size++ // the decoder's table runs one entry behind
    if (next < 4096) {
      dict.set(key, next++)
    } else {
      emit(clear, size)
      dict = new Map(); size = minCode + 1; next = end + 1
    }
    prefix = k
  }
  emit(prefix, size)
  emit(end, size)
  if (bits) bytes.push(acc & 255)
  return bytes
}

function encodeGIF({ palette, frames }, delayCs) {
  let depth = 1
  while (1 << depth < palette.length) depth++
  const out = [Buffer.from('GIF89a'), Buffer.from([W & 255, W >> 8, W & 255, W >> 8, 0x80 | (depth - 1), 0, 0])]
  const table = Buffer.alloc(3 << depth)
  palette.forEach((px, i) => table.set([px >> 16, (px >> 8) & 255, px & 255], i * 3))
  out.push(table, Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]))
  const minCode = Math.max(2, depth)
  for (const f of frames) {
    out.push(Buffer.from([0x21, 0xf9, 4, 0x04, delayCs & 255, delayCs >> 8, 0, 0])) // dispose: leave
    out.push(Buffer.from([0x2c, 0, 0, 0, 0, W & 255, W >> 8, W & 255, W >> 8, 0, minCode]))
    const data = lzw(f, minCode)
    for (let i = 0; i < data.length; i += 255) {
      const part = data.slice(i, i + 255)
      out.push(Buffer.from([part.length, ...part]))
    }
    out.push(Buffer.from([0]))
  }
  out.push(Buffer.from([0x3b]))
  return Buffer.concat(out)
}

mkdirSync(join(ROOT, 'docs', 'gifs'), { recursive: true })
for (const ex of picked) {
  const frames = Array.from({ length: ex.frames }, (_, i) => compose(renderFrame(ex, i).canvas))
  const gif = encodeGIF(quantize(frames), Math.round(100 / FPS))
  writeFileSync(join(ROOT, 'docs', 'gifs', `${ex.id}.gif`), gif)
  console.log(`${ex.id}: ${ex.frames} frames, ${(gif.length / 1024).toFixed(0)} KB`)
}
