// Preview player: Pixi's exercises in your terminal, outside Claude Code.
//
// Usage: node tools/player.mjs [exercise-id] [--cells] [--direct] [--probe] [--size <rows>]
//   ←/→ switch exercise · q or Esc quit
//
// In Ghostty, kitty and WezTerm the PNG frames are shown as true pixels over
// the kitty graphics protocol, the way Claude Code's Image element shows
// them: the terminal reads each PNG from disk itself (`t=f`). `--direct`
// sends the bytes instead; `--probe` draws one frame each way with the
// terminal's replies turned on and prints them. Elsewhere (or with --cells)
// the frames are rendered live into half-block cells, the mod's fallback.
// Run `node tools/render.mjs` first so assets/frames exists.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXERCISES, FPS, framePath, halfBlocks, renderFrame } from '../hooks/pixi.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--size')
const out = process.stdout
const term = `${process.env.TERM_PROGRAM ?? ''} ${process.env.TERM ?? ''}`
const pixels = !flag('--cells') && /ghostty|kitty|wezterm/i.test(term)
const direct = flag('--direct')

let ex = Math.max(0, EXERCISES.findIndex((e) => e.id === ids[0]))
let frame = 0
let timer = null
let shown = 0 // the kitty image id on screen (1 or 2, alternating)

// The sprite box in cells: square-ish, a cell being about twice as tall as wide.
function box() {
  const rows = Math.max(4, Number(opt('--size', 0)) || Math.min((out.rows ?? 30) - 3, Math.floor(((out.columns ?? 80) - 2) / 2)))
  return { rows, columns: rows * 2 }
}

const apc = (keys, payload = '') => `\x1b_G${keys};${payload}\x1b\\`
const file = (e, i) => join(ROOT, framePath(e, i))

/** Transmits and displays one frame as image `id` at the cursor. */
function putFrame(e, i, id, { columns, rows }, quiet = true) {
  const q = quiet ? ',q=2' : ''
  if (!direct) {
    // the file medium: the terminal opens the PNG itself
    out.write(apc(`a=T,t=f,f=100,i=${id},c=${columns},r=${rows}${q}`, Buffer.from(file(e, i)).toString('base64')))
    return
  }
  const b64 = readFileSync(file(e, i)).toString('base64')
  for (let p = 0; p < b64.length; p += 4096) {
    const last = p + 4096 >= b64.length
    const head = p === 0 ? `a=T,f=100,i=${id},c=${columns},r=${rows}${q},` : ''
    out.write(apc(`${head}m=${last ? 0 : 1}`, b64.slice(p, p + 4096)))
  }
}

function draw() {
  const e = EXERCISES[ex]
  const size = box()
  const title = `${e.name}  (difficulty ${e.difficulty}/7)  ${ex + 1}/${EXERCISES.length}  frame ${frame + 1}/${e.frames}`
  if (pixels) {
    const next = shown === 1 ? 2 : 1
    out.write('\x1b[H')
    putFrame(e, frame, next, size)
    if (shown) out.write(apc(`a=d,d=I,i=${shown},q=2`)) // the old frame, placement and bytes
    shown = next
    out.write(`\x1b[${size.rows + 1};1H\x1b[2m←/→ exercise · q quit\x1b[0m\x1b[K\n${title}\x1b[K`)
    return
  }
  const cells = halfBlocks(renderFrame(e, frame).canvas, size.columns, size.rows)
  const lines = []
  for (let y = 0; y < size.rows; y++) {
    let line = ''
    for (let x = 0; x < size.columns; x++) {
      const [ch, fg, bg] = cells[y * size.columns + x]
      const col = (v, k) => (v < 0 ? `\x1b[${k === 'fg' ? 39 : 49}m` : `\x1b[${k === 'fg' ? 38 : 48};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}m`)
      line += col(fg, 'fg') + col(bg, 'bg') + String.fromCodePoint(ch)
    }
    lines.push(line + '\x1b[0m')
  }
  out.write('\x1b[H' + lines.join('\n') + `\n\x1b[2m←/→ exercise · q quit\x1b[0m\x1b[K\n${title}\x1b[K`)
}

function tick() {
  frame = (frame + 1) % EXERCISES[ex].frames
  draw()
}

function select(i) {
  ex = (i + EXERCISES.length) % EXERCISES.length
  frame = 0
  if (pixels) {
    out.write(apc('a=d,d=A,q=2')) // drop every placement and image
    shown = 0
  }
  out.write('\x1b[2J')
  draw()
}

function cleanup() {
  if (timer) clearInterval(timer)
  process.stdin.setRawMode?.(false)
  process.stdin.pause()
  if (pixels) out.write(apc('a=d,d=A,q=2'))
  out.write('\x1b[?25h\x1b[0m\x1b[?1049l')
  process.exit(0)
}

// --probe: one frame by file, one by bytes, replies on; prints what the terminal said.
async function probe() {
  const e = EXERCISES[ex]
  const size = { columns: 24, rows: 12 }
  const replies = []
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.on('data', (d) => replies.push(d.toString('latin1')))
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  out.write('\x1b[2J\x1b[H')
  out.write(apc('a=q,i=31,s=1,v=1,f=24', 'AAAA')) // the protocol's own support query
  await wait(300)
  out.write('\x1b[H')
  out.write(apc(`a=T,t=f,f=100,i=1,c=${size.columns},r=${size.rows}`, Buffer.from(file(e, 0)).toString('base64')))
  await wait(400)
  out.write(`\x1b[1;${size.columns + 4}H`)
  const b64 = readFileSync(file(e, 0)).toString('base64')
  for (let p = 0; p < b64.length; p += 4096) {
    const last = p + 4096 >= b64.length
    out.write(apc(`${p === 0 ? `a=T,f=100,i=2,c=${size.columns},r=${size.rows},` : ''}m=${last ? 0 : 1}`, b64.slice(p, p + 4096)))
  }
  await wait(400)
  out.write(`\x1b[${size.rows + 2};1H`)
  out.write(`terminal: ${term.trim()}  ghostty-ish: ${pixels}\n`)
  out.write(`left: file medium (what the mod uses) · right: direct bytes\n`)
  const seen = replies.join('').split('\x1b\\').filter(Boolean).map((s) => s.replace(/\x1b/g, 'ESC'))
  out.write(seen.length ? `replies:\n  ${seen.join('\n  ')}\n` : 'replies: none (a terminal that does not speak the protocol stays silent)\n')
  process.stdin.setRawMode?.(false)
  process.stdin.pause()
  process.exit(0)
}

if (flag('--probe')) {
  await probe()
} else if (!out.isTTY) {
  // piped: one frame of cells and out
  const e = EXERCISES[ex]
  const { rows, columns } = { rows: 24, columns: 48 }
  const cells = halfBlocks(renderFrame(e, 0).canvas, columns, rows)
  for (let y = 0; y < rows; y++) out.write(cells.slice(y * columns, (y + 1) * columns).map(([ch]) => String.fromCodePoint(ch)).join('') + '\n')
  process.exit(0)
} else {
  out.write('\x1b[?1049h\x1b[?25l')
  select(ex)
  timer = setInterval(tick, 1000 / FPS)
  out.on('resize', () => select(ex))
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', (d) => {
    const s = d.toString()
    if (s === 'q' || s === '\x03' || s === '\x1b' || s === '\x1b\x1b') return cleanup()
    if (s === '\x1b[D') select(ex - 1)
    else if (s === '\x1b[C') select(ex + 1)
  })
}
