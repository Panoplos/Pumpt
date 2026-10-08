// The logo: Pixi's head over the PUMPT! slab, on a clear background, as the
// README shows it. The head is the logo's own pixels (hooks/head.js) and the
// wordmark the mod's arcade lettering; the head is the bigger of the two.
//
//   node tools/make-logo.mjs            → docs/logo.png (and docs/logo-wide.png, head beside the word)
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Canvas, drawTitle } from '../hooks/pixi.js'
import { HEAD_ROWS, HEAD_PALETTE } from '../hooks/head.js'
import { encodePNG, upscale } from './png.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HW = HEAD_ROWS[0].length, HH = HEAD_ROWS.length // 50 x 44
const K = 8 // output px per art px

function drawHead(cv, ox, oy) {
  HEAD_ROWS.forEach((row, y) => {
    for (let x = 0; x < HW; x++) if (row[x] !== '.') cv.set(ox + x, oy + y, parseInt(HEAD_PALETTE[row[x]].slice(1), 16))
  })
}

// stacked: the head, a gap, the word at font scale 1 (6 px a letter: 38 px wide, under a 50 px head)
{
  const w = 60, h = HH + 4 + 9 + 2
  const cv = new Canvas(w, h)
  drawHead(cv, Math.round((w - HW) / 2), 0)
  drawTitle(cv, ['PUMPT!'], w / 2 + 1, HH + 4 + 4, 1)
  mkdirSync(join(ROOT, 'docs'), { recursive: true })
  writeFileSync(join(ROOT, 'docs', 'logo.png'), encodePNG(upscale(cv.rgba, w, h, K), w * K, h * K))
  console.log(`docs/logo.png ${w * K}x${h * K}`)
}
// wide: the head beside the word, for a banner
{
  const w = HW + 6 + 40, h = HH
  const cv = new Canvas(w, h)
  drawHead(cv, 0, 0)
  drawTitle(cv, ['PUMPT!'], HW + 6 + 19, Math.round(HH / 2) + 2, 1)
  writeFileSync(join(ROOT, 'docs', 'logo-wide.png'), encodePNG(upscale(cv.rgba, w, h, K), w * K, h * K))
  console.log(`docs/logo-wide.png ${w * K}x${h * K}`)
}
