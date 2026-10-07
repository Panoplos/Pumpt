// Renders every exercise clip to assets/frames/<id>/f<n>.png (true-pixel
// frames for the terminal's image renderer) and checks each frame: every IK
// target reached (feet and hands land where the clip put them) and nothing
// clipped at the canvas edge.
//
// Usage: node tools/render.mjs [--scale 8] [--sheets <dir>] [--no-frames] [id ...]
//   --scale <k>     nearest-neighbour upscale of the 128 px canvas (default 8: 1024 px, crisp on HiDPI)
//   --sheets <dir>  also write one contact sheet per exercise for review
//   --no-frames     skip the PNG frames (sheets and checks only)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePNG, upscale } from './png.mjs'
import { EXERCISES, SIZE, Canvas, renderFrame, framePath } from '../hooks/pixi.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i < 0 ? fallback : args[i + 1]
}
const SCALE = Number(opt('--scale', 8))
const SHEETS = opt('--sheets', null)
const FRAMES = !args.includes('--no-frames')
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--scale' && args[i - 1] !== '--sheets')
const picked = ids.length ? EXERCISES.filter((e) => ids.includes(e.id)) : EXERCISES

let problems = 0
for (const ex of picked) {
  const frames = []
  for (let i = 0; i < ex.frames; i++) {
    const { canvas, joints } = renderFrame(ex, i)
    frames.push(canvas)
    if (!joints.reached) problems++, console.log(`  ${ex.id} f${i}: an IK target is out of reach`)
    // nothing may touch the canvas edge: that is a clipped drawing
    const px = canvas.rgba
    let clipped = false
    for (let k = 0; k < SIZE; k++) {
      if (px[(k * SIZE + 0) * 4 + 3] === 255 || px[(k * SIZE + SIZE - 1) * 4 + 3] === 255) clipped = true
      if (px[(0 * SIZE + k) * 4 + 3] === 255 || px[((SIZE - 1) * SIZE + k) * 4 + 3] === 255) clipped = true
    }
    if (clipped) problems++, console.log(`  ${ex.id} f${i}: drawing touches the canvas edge`)
  }
  if (FRAMES) {
    const dir = join(ROOT, 'assets', 'frames', ex.id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    frames.forEach((cv, i) => writeFileSync(join(ROOT, framePath(ex, i)), encodePNG(upscale(cv.rgba, SIZE, SIZE, SCALE), SIZE * SCALE, SIZE * SCALE)))
  }
  if (SHEETS) {
    // a contact sheet at 2x over a terminal-dark background, 6 frames a row
    const K = 2, COLS = Math.min(6, frames.length), ROWS = Math.ceil(frames.length / COLS)
    const cell = SIZE * K + 2
    const sheet = new Canvas(COLS * cell, ROWS * cell)
    sheet.rgba.fill(0)
    for (let i = 0; i < sheet.rgba.length; i += 4) sheet.rgba[i] = 0x2b, sheet.rgba[i + 1] = 0x2b, sheet.rgba[i + 2] = 0x33, sheet.rgba[i + 3] = 255
    frames.forEach((cv, i) => {
      const ox = (i % COLS) * cell + 1, oy = Math.floor(i / COLS) * cell + 1
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const s = (y * SIZE + x) * 4
          const a = cv.rgba[s + 3]
          if (!a) continue
          for (let dy = 0; dy < K; dy++)
            for (let dx = 0; dx < K; dx++) {
              const d = ((oy + y * K + dy) * sheet.w + ox + x * K + dx) * 4
              const k = a / 255
              sheet.rgba[d] = Math.round(cv.rgba[s] * k + sheet.rgba[d] * (1 - k))
              sheet.rgba[d + 1] = Math.round(cv.rgba[s + 1] * k + sheet.rgba[d + 1] * (1 - k))
              sheet.rgba[d + 2] = Math.round(cv.rgba[s + 2] * k + sheet.rgba[d + 2] * (1 - k))
            }
        }
      // a frame number: tiny tick marks along the top edge
      for (let n = 0; n <= i; n++) for (let dy = 0; dy < 2; dy++) sheet.set(ox + 2 + n * 3, oy + dy, 0xffffff)
    })
    mkdirSync(SHEETS, { recursive: true })
    writeFileSync(join(SHEETS, `${ex.id}.png`), encodePNG(sheet.rgba, sheet.w, sheet.h))
  }
  console.log(`${ex.id}: ${ex.frames} frames (${ex.seconds}s)`)
}
if (problems) {
  console.log(`${problems} problem(s)`)
  process.exit(1)
}
