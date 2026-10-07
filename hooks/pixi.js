// Pixi's rig, the seven exercise clips and the pixel-art rasterizer.
//
// Pure ES module (no Node, no DOM): shared by the mod (register.js), the frame
// builder (tools/render.mjs) and the preview player (tools/player.mjs). Every
// frame is drawn from a pose, so position, size and timing never drift: the
// head is the logo's own pixels (hooks/head.js), moved by transforms that keep
// them crisp, and the body is a jointed rig rasterized with a 1 px outline,
// a shade band, a rim light and the logo's palette at the logical resolution.
import { HEAD_ROWS, HEAD_PALETTE } from './head.js'

export const SIZE = 128 // logical canvas edge, px
export const FPS = 12
export const FLOOR = 118 // the ground: soles rest on this row

// --- palette -----------------------------------------------------------------

const hex = (s) => parseInt(s.slice(1), 16)
const OUT = hex('#230438') // the logo's outline color, used on every part
const C = {
  skin: hex('#945276'),
  tunic: hex('#3b2d7a'),
  tunicLight: hex('#5a47a3'),
  pants: hex('#241a44'),
  boot: hex('#7a4a33'),
  bootLight: hex('#a3684a'),
  gold: hex('#f1be58'),
  goldShade: hex('#b8842a'),
  drop: hex('#69a8bd'),
  light: hex('#fdfacc'),
  spark: hex('#fed363'),
}
const mul = (rgb, k) => {
  const c = (v) => Math.min(255, Math.round(v * k))
  return (c((rgb >> 16) & 255) << 16) | (c((rgb >> 8) & 255) << 8) | c(rgb & 255)
}
const dim = (rgb, k) => mul(rgb, k)
// the rim light: lighter and a touch warmer than the base
const lighten = (rgb) => {
  const c = (v, k) => Math.min(255, Math.round(v * k + 16))
  return (c((rgb >> 16) & 255, 1.25) << 16) | (c((rgb >> 8) & 255, 1.2) << 8) | c(rgb & 255, 1.15)
}

// --- the head bitmap ---------------------------------------------------------

const HW = HEAD_ROWS[0].length // 50
const HH = HEAD_ROWS.length // 44
const NECK = [25, 40] // the pivot: where the head meets the torso
const CAP_ROWS = 13 // rows 0..12 are hair only; they bounce on their own
const HEAD_CHARS = Object.keys(HEAD_PALETTE)
const HEAD_RGB = HEAD_CHARS.map((k) => hex(HEAD_PALETTE[k]))
const charIndex = (ch) => (ch === '.' ? 0 : HEAD_CHARS.indexOf(ch) + 1)
const BASE_HEAD = new Uint8Array(HW * HH)
HEAD_ROWS.forEach((row, y) => {
  for (let x = 0; x < HW; x++) BASE_HEAD[y * HW + x] = charIndex(row[x])
})

// Expression overlays: patches in the head's own palette letters, '.' = keep.
// Coordinates are head-local; 'S' is skin, 'O' outline, 'J' highlight.
const EYES = {
  open: null,
  // a relaxed blink: lids down, one dark line per eye
  closed: { x: 17, y: 28, rows: ['SSSS........SSSS', 'OOOO........OOOO', 'SSSS........SSSS'] },
  // happy ^ ^
  happy: { x: 17, y: 28, rows: ['.OO..........OO.', 'O..O........O..O', 'SSSS........SSSS'] },
  // effort: upper lid pushed down, eye two rows tall
  squint: { x: 17, y: 28, rows: ['SSSS........SSSS'] },
  // surprise / joy: eye a row taller
  wide: { x: 17, y: 27, rows: ['GJUV........VUJG'] },
  // the pupils look down (a chin tuck, the floor of a plank)
  down: { x: 17, y: 28, rows: ['SSSS........SSSS', 'GJUV........VUJG', 'GJGQ........QGJG'] },
}
const MOUTHS = {
  smirk: null,
  // a small o: an exhale
  o: { x: 20, y: 35, rows: ['SSSSSSSSSSS', 'SSSSOOOSSSS', 'SSSOPKPOSSS', 'SSSSOOOSSSS'] },
  // a big breath, a shout at the apex
  open: { x: 20, y: 35, rows: ['SSSOOOOOSSS', 'SSOPPKPPOSS', 'SSOPKKKPOSS', 'SSSOOOOOSSS'] },
  // gritted teeth: effort
  grit: { x: 20, y: 35, rows: ['SOOOOOOOOOS', 'SOJOJOJOJOS', 'SOOOOOOOOOS', 'SSSSSSSSSSS'] },
  // a wide grin with teeth
  grin: { x: 19, y: 35, rows: ['OSSSSSSSSSSSO', 'SOJJJJJJJJJOS', 'SSOJJJJJJJOSS', 'SSSOOOOOOOSSS'] },
}

const headCache = new Map()
/** The head grid with an expression applied; cached per (eyes, mouth). */
function headGrid(eyes, mouth) {
  const key = `${eyes}|${mouth}`
  let g = headCache.get(key)
  if (g) return g
  g = Uint8Array.from(BASE_HEAD)
  for (const patch of [EYES[eyes], MOUTHS[mouth]]) {
    if (!patch) continue
    patch.rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] !== '.') g[(patch.y + dy) * HW + patch.x + dx] = charIndex(row[dx])
    })
  }
  headCache.set(key, g)
  return g
}

// --- canvas and rasterizer ---------------------------------------------------

export class Canvas {
  constructor(w = SIZE, h = SIZE) {
    this.w = w
    this.h = h
    this.rgba = new Uint8Array(w * h * 4)
  }
  set(x, y, rgb, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    this.rgba[i] = (rgb >> 16) & 255
    this.rgba[i + 1] = (rgb >> 8) & 255
    this.rgba[i + 2] = rgb & 255
    this.rgba[i + 3] = a
  }
}

// Primitives answer "is this pixel centre inside?" over a bounding box.
const capsule = (ax, ay, bx, by, r, color) => {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  return {
    color,
    bbox: [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r],
    inside(x, y) {
      let t = ((x - ax) * dx + (y - ay) * dy) / len2
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const px = ax + dx * t - x, py = ay + dy * t - y
      return px * px + py * py <= r * r
    },
  }
}
const ellipse = (cx, cy, rx, ry, color) => ({
  color,
  bbox: [cx - rx, cy - ry, cx + rx, cy + ry],
  inside(x, y) {
    const u = (x - cx) / rx, v = (y - cy) / ry
    return u * u + v * v <= 1
  },
})
const polygon = (pts, color) => ({
  color,
  bbox: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
  inside(x, y) {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  },
})
// trim, soles, seams: painted as they are, with no shade band or rim light
const flat = (prim) => ({ ...prim, flat: true })

/**
 * Paints one part: the union of its primitives (later ones on top), cel-shaded
 * along the bottom-right rim, rim-lit along the top-left (light from the
 * top-left) and outlined in the logo's outline color. `shade` maps a fill
 * color to its shadow tone; a `flat` primitive takes neither band.
 */
function paintPart(cv, prims, { shade = (c) => dim(c, 0.72), depth = 2, outline = true, alpha = 255, highlight = true } = {}) {
  if (!prims.length) return
  const x0 = Math.max(0, Math.floor(Math.min(...prims.map((p) => p.bbox[0]))) - 1)
  const y0 = Math.max(0, Math.floor(Math.min(...prims.map((p) => p.bbox[1]))) - 1)
  const x1 = Math.min(cv.w - 1, Math.ceil(Math.max(...prims.map((p) => p.bbox[2]))) + 1)
  const y1 = Math.min(cv.h - 1, Math.ceil(Math.max(...prims.map((p) => p.bbox[3]))) + 1)
  const W = x1 - x0 + 1, H = y1 - y0 + 1
  if (W <= 0 || H <= 0) return
  const mask = new Uint8Array(W * H) // 0 outside, else 1 + index of the top primitive
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let i = prims.length - 1; i >= 0; i--)
        if (prims[i].inside(x0 + x + 0.5, y0 + y + 0.5)) {
          mask[y * W + x] = i + 1
          break
        }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x])
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const m = at(x, y)
      if (!m) continue
      const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)
      const prim = prims[m - 1]
      let rgb = prim.color
      if (edge && outline) rgb = OUT
      else if (!prim.flat) {
        for (let d = 1; d <= depth; d++) if (!at(x + d, y + d)) rgb = shade(prim.color)
        if (rgb === prim.color && highlight && !at(x - 2, y - 2)) rgb = lighten(prim.color)
      }
      cv.set(x0 + x, y0 + y, rgb, alpha)
    }
}

// --- head transforms ---------------------------------------------------------
// Everything stays on the pixel grid: the hair cap and the lean slide whole
// rows; a rotation goes the RotSprite way (EPX upscale, rotate, sample the
// centres), which keeps 0° and 90° exact and diagonals clean.

/** The head as a small indexed image with the hair cap shifted by `capDy`. */
function deformedHead(grid, capDy) {
  const h = HH + 2
  const g = new Uint8Array(HW * h)
  // the face first, the cap over it: a shift stretches or squashes the hair
  for (let y = CAP_ROWS - 1; y < HH; y++) for (let x = 0; x < HW; x++) if (grid[y * HW + x]) g[(y + 1) * HW + x] = grid[y * HW + x]
  for (let y = 0; y < CAP_ROWS; y++) for (let x = 0; x < HW; x++) if (grid[y * HW + x]) g[(y + 1 + capDy) * HW + x] = grid[y * HW + x]
  return { g, w: HW, h, px: NECK[0], py: NECK[1] + 1 }
}

/** A sideways lean: rows slide, nothing else changes. */
function shearHead(img, deg) {
  if (!deg) return img
  const k = Math.tan((deg * Math.PI) / 180)
  const pad = Math.ceil(Math.abs(k) * img.h) + 1
  const w = img.w + 2 * pad
  const g = new Uint8Array(w * img.h)
  for (let y = 0; y < img.h; y++) {
    const s = Math.round(k * (y - img.py))
    for (let x = 0; x < img.w; x++) if (img.g[y * img.w + x]) g[y * w + x + pad + s] = img.g[y * img.w + x]
  }
  return { g, w, h: img.h, px: img.px + pad, py: img.py }
}

/** EPX / Scale2x: doubles an indexed image, smoothing staircase edges. */
function scale2x(g, w, h) {
  const W = w * 2
  const out = new Uint8Array(W * h * 2)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const P = g[y * w + x]
      const A = y > 0 ? g[(y - 1) * w + x] : 0
      const B = x < w - 1 ? g[y * w + x + 1] : 0
      const Cc = x > 0 ? g[y * w + x - 1] : 0
      const D = y < h - 1 ? g[(y + 1) * w + x] : 0
      let p1 = P, p2 = P, p3 = P, p4 = P
      if (Cc === A && Cc !== D && A !== B) p1 = A
      if (A === B && A !== Cc && B !== D) p2 = B
      if (D === Cc && D !== B && Cc !== A) p3 = Cc
      if (B === D && B !== A && D !== Cc) p4 = D
      const o = y * 2 * W + x * 2
      out[o] = p1
      out[o + 1] = p2
      out[o + W] = p3
      out[o + W + 1] = p4
    }
  return out
}

/** Pixels of the head image rotated `deg` clockwise about its pivot, as [x, y, index]. */
function rotateHead(img, deg) {
  const out = []
  if (!deg) {
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.g[y * img.w + x]) out.push([x - img.px, y - img.py, img.g[y * img.w + x]])
    return out
  }
  let g = img.g, w = img.w, h = img.h
  for (let k = 0; k < 3; k++) {
    g = scale2x(g, w, h)
    w *= 2
    h *= 2
  }
  const th = (deg * Math.PI) / 180
  const cos = Math.cos(th), sin = Math.sin(th)
  const r = Math.ceil(Math.hypot(img.w, img.h)) + 1
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const cx = x + 0.5, cy = y + 0.5
      const sx = cos * cx + sin * cy, sy = -sin * cx + cos * cy
      const ix = Math.floor((sx + img.px) * 8), iy = Math.floor((sy + img.py) * 8)
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue
      const v = g[iy * w + ix]
      if (v) out.push([x, y, v])
    }
  return out
}

function drawHead(cv, h) {
  let img = deformedHead(headGrid(h.eyes || 'open', h.mouth || 'smirk'), h.cap || 0)
  img = shearHead(img, h.tilt || 0)
  const px = rotateHead(img, h.rot || 0)
  const ox = Math.round(h.x), oy = Math.round(h.y)
  for (const [x, y, i] of px) cv.set(ox + x, oy + y, HEAD_RGB[i - 1])
}

// --- small bitmaps: effects --------------------------------------------------

const FX = {
  drop: ['..O..', '.OWO.', 'OWJWO', 'OWWWO', '.OWO.', '..O..'],
  spark: ['..G..', '.GJG.', 'GJJJG', '.GJG.', '..G..'],
  sparkSmall: ['.G.', 'GJG', '.G.'],
  puff: ['.JJJ..', 'JJJJJJ', '.JJJJ.'],
}
const FX_RGB = { O: OUT, W: C.drop, J: C.light, G: C.spark }
function drawFx(cv, fx) {
  if (fx.type === 'line') {
    const n = Math.max(Math.abs(fx.x2 - fx.x), Math.abs(fx.y2 - fx.y)) || 1
    for (let i = 0; i <= n; i++) cv.set(Math.round(fx.x + ((fx.x2 - fx.x) * i) / n), Math.round(fx.y + ((fx.y2 - fx.y) * i) / n), fx.color ?? OUT, fx.alpha ?? 255)
    return
  }
  if (fx.type === 'ghost') {
    // a translucent motion-trail ghost of a hand
    paintPart(cv, [ellipse(fx.x, fx.y, fx.r, fx.r, C.skin)], { outline: false, alpha: fx.alpha ?? 110, highlight: false })
    return
  }
  const rows = FX[fx.type]
  const ox = Math.round(fx.x), oy = Math.round(fx.y)
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) if (row[dx] !== '.') cv.set(ox + dx, oy + dy, FX_RGB[row[dx]])
  })
}

// --- the rig -----------------------------------------------------------------

export const RIG = {
  torso: 24,
  shoulderHalf: 12,
  hipHalf: 6,
  upperArm: 13,
  foreArm: 12,
  hand: 3.5,
  thigh: 14,
  shin: 13,
}
const REACH_ARM = RIG.upperArm + RIG.foreArm
const REACH_LEG = RIG.thigh + RIG.shin

const rad = (d) => (d * Math.PI) / 180
// A direction from "down", turning toward `facing` (+x): dir(90) is forward, dir(180) up.
const dir = (deg, facing = 1) => [facing * Math.sin(rad(deg)), Math.cos(rad(deg))]
/** Where the neck is for a hip and torso lean (clips place effects by it). */
export const neckOf = (hip, torso = 0, facing = 1, len = RIG.torso) => {
  const u = dir(180 - torso, facing)
  return [hip[0] + u[0] * len, hip[1] + u[1] * len]
}

/**
 * Two-bone IK: the middle joint for root `a`, target `t` and bone lengths.
 * `bend` +1 puts the joint on the left of a→t in screen space, -1 on the right
 * (for a limb hanging down, +1 is the viewer's left). Facing right in side
 * view, a knee's natural bend is always -1 and an elbow's +1; in front view
 * knees point out (L +1, R -1). Returns { mid, end, reached }: `end` is `t`
 * when it is reachable.
 */
function ik(a, t, l1, l2, bend) {
  let dx = t[0] - a[0], dy = t[1] - a[1]
  let d = Math.hypot(dx, dy)
  const max = l1 + l2 - 0.01, min = Math.abs(l1 - l2) + 0.01
  let reached = true
  if (d > max || d < min) {
    const k = (d > max ? max : min) / (d || 1)
    dx *= k
    dy *= k
    d = Math.hypot(dx, dy)
    reached = false
  }
  const end = [a[0] + dx, a[1] + dy]
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along))
  const ux = dx / d, uy = dy / d
  const mid = [a[0] + ux * along - uy * h * bend, a[1] + uy * along + ux * h * bend]
  return { mid, end, reached }
}

function limb(root, spec, l1, l2, facing, torsoDeg) {
  if (spec.target && spec.straight) {
    // a straight limb to a projected point: shorter than its length when it
    // points toward or away from the viewer, the joint on the line
    const k = l1 / (l1 + l2)
    const mid = [root[0] + (spec.target[0] - root[0]) * k, root[1] + (spec.target[1] - root[1]) * k]
    return { mid, end: spec.target, reached: true }
  }
  if (spec.target) return ik(root, spec.target, l1, l2, spec.bend ?? 1)
  // forward kinematics: `a` from the torso's own "down", `b` the elbow / knee
  const a = (spec.a ?? 0) - torsoDeg
  const d1 = dir(a, facing)
  const mid = [root[0] + d1[0] * l1, root[1] + d1[1] * l1]
  const d2 = dir(a + (spec.b ?? 0), facing)
  return { mid, end: [mid[0] + d2[0] * l2, mid[1] + d2[1] * l2], reached: true }
}

/**
 * A hand at the wrist: `d` runs along the forearm, `n` is the thumb's side.
 * `grip`: 'fist' (a stubby palm, thumb folded, two knuckles), 'open' (fingers
 * out, for a reach) or 'flat' (palm down on the floor, fingers forward).
 */
function handPrims(wrist, d, n, grip, r, facing, k) {
  const [wx, wy] = wrist
  const at = (a, b = 0) => [wx + d[0] * a + n[0] * b, wy + d[1] * a + n[1] * b]
  const skin = k(C.skin), crease = k(dim(C.skin, 0.7))
  const thumb = (a, b) => ellipse(...at(a, b), 1.7, 1.7, skin)
  if (grip === 'flat') return [ellipse(wx + facing * 2.5, wy + 0.5, 4.6, 2.4, skin), ellipse(wx - facing * 1.5, wy - 0.8, 1.8, 1.6, skin)]
  if (grip === 'open') {
    return [capsule(wx, wy, ...at(4.5), r - 0.4, skin), thumb(1.5, r - 0.6), flat(capsule(...at(5, -1.4), ...at(5, 1.4), 0.5, crease))]
  }
  return [capsule(wx, wy, ...at(2.2), r, skin), thumb(1.2, r - 0.1), flat(capsule(...at(r + 0.9, -1.6), ...at(r + 0.9, 1.6), 0.55, crease))]
}

/**
 * A boot below the ankle: from the front a rounded block with a toe cap and a
 * sole; from the side a shaft and a foot pointing `toe` degrees off the floor
 * (0 flat, 90 on the toes), with a rounded toe cap and a sole line. Returns
 * the primitives and the lowest point, for the shadow.
 */
function bootPrims(ankle, facing, toe, side, k) {
  const [ax, ay] = ankle
  const sole = k(dim(C.boot, 0.55))
  if (!side) {
    return {
      prims: [
        polygon([[ax - 4.5, ay - 1], [ax + 4.5, ay - 1], [ax + 5.5, ay + 4.5], [ax - 5.5, ay + 4.5]], k(C.boot)),
        ellipse(ax, ay + 2.4, 3.2, 1.5, k(C.bootLight)),
        flat(capsule(ax - 4.6, ay + 3.6, ax + 4.6, ay + 3.6, 0.6, sole)),
      ],
      bottom: ay + 4.5,
    }
  }
  const t = rad(toe)
  const f = [facing * Math.cos(t), Math.sin(t)] // where the toes point
  const nrm = [-f[1] * facing, f[0] * facing] // the sole's side
  const r = 2.8
  const heel = [ax - f[0] * 2, ay + 1.5 - f[1] * 2], tip = [ax + f[0] * 7.5, ay + 1.5 + f[1] * 7.5]
  return {
    prims: [
      capsule(ax, ay - 1.5, ax, ay + 1.5, 3.6, k(C.boot)), // the shaft
      capsule(heel[0], heel[1], tip[0], tip[1], r, k(C.boot)), // the foot
      ellipse(tip[0] + f[0] * 0.5, tip[1] + f[1] * 0.5, 2, 1.8, k(C.bootLight)), // the toe cap
      flat(capsule(heel[0] + nrm[0] * (r - 1.2), heel[1] + nrm[1] * (r - 1.2), tip[0] + nrm[0] * (r - 1.2), tip[1] + nrm[1] * (r - 1.2), 0.6, sole)),
    ],
    bottom: Math.max(heel[1], tip[1]) + r,
  }
}

/**
 * Draws a pose. Returns the resolved joints and whether every IK target was
 * reached, which the frame builder checks.
 *
 * A pose: { view: 'front' | 'side', facing, hip: [x, y], torso (degrees of
 * lean toward facing; -90 lies on the back, 90 on the front), torsoLen,
 * head: { rot, tilt, dx, dy, eyes, mouth, z }, arms / legs: { L, R } each
 * { a, b } (angles) or { target, bend, toe, straight, grip, hand }, fx: [...] }.
 * In side view L is the far limb and R the near one.
 */
export function drawPose(cv, pose) {
  const side = pose.view === 'side'
  const facing = pose.facing ?? 1
  const [hx, hy] = pose.hip
  const torsoDeg = pose.torso ?? 0
  const torsoLen = pose.torsoLen ?? RIG.torso
  const up = dir(180 - torsoDeg, facing) // the spine, hip → neck
  const neck = [hx + up[0] * torsoLen, hy + up[1] * torsoLen]
  const right = [-up[1] * facing, up[0] * facing] // across the chest, toward facing
  const sh = side ? 0 : RIG.shoulderHalf
  const hh = side ? 0 : RIG.hipHalf
  const shoulder = (s) => [neck[0] + right[0] * sh * s, neck[1] + right[1] * sh * s]
  const hipJoint = (s) => [hx + right[0] * hh * s, hy + right[1] * hh * s]
  const joints = { neck, hip: [hx, hy], reached: true }
  const parts = []
  let footBottom = -Infinity

  // the far limb sits a step back and draws darker
  const farOff = side ? [-2 * facing, 0] : [0, 0]
  const limbRoot = (base, isFar) => (isFar ? [base[0] + farOff[0], base[1] + farOff[1]] : base)
  const tone = (isFar) => (isFar ? (c) => dim(c, 0.78) : (c) => c)

  for (const key of ['L', 'R']) {
    const isFar = side && key === 'L'
    const s = key === 'L' ? -1 : 1
    const k = tone(isFar)
    const spec = pose.legs?.[key] ?? { a: 0, b: 0 }
    const root = limbRoot(hipJoint(s), isFar)
    const leg = limb(root, spec, RIG.thigh, RIG.shin, facing, 0)
    joints.reached &&= leg.reached
    joints[`ankle${key}`] = leg.end
    const boot = bootPrims(leg.end, facing, spec.toe ?? 0, side, k)
    footBottom = Math.max(footBottom, boot.bottom)
    const prims = [
      capsule(root[0], root[1], leg.mid[0], leg.mid[1], 4.5, k(C.pants)),
      capsule(leg.mid[0], leg.mid[1], leg.end[0], leg.end[1], 4, k(C.pants)),
      ...boot.prims,
    ]
    parts.push({ z: isFar ? 1 : 3, prims, shade: (c) => dim(c, 0.7) })
  }

  // torso: a tunic from the hips to the neck, narrow at the waist, belted,
  // with a V-neck trim (and a pouch on the belt from the side)
  {
    const w0 = side ? 5 : 8, w1 = side ? 7 : 12 // half-widths at the hip and the chest
    const pt = (u, v) => [hx + right[0] * u + up[0] * v, hy + right[1] * u + up[1] * v]
    const body = polygon(
      [pt(-w0, -2), pt(w0, -2), pt(w0 + 0.5, torsoLen * 0.35), pt(w1, torsoLen * 0.8), pt(w1, torsoLen + 1), pt(-w1, torsoLen + 1), pt(-w1, torsoLen * 0.8), pt(-w0 - 0.5, torsoLen * 0.35)],
      C.tunic,
    )
    const belt = polygon([pt(-w0 - 1, 3), pt(w0 + 1, 3), pt(w0 + 1, 6), pt(-w0 - 1, 6)], C.gold)
    const prims = [body, belt]
    if (!side) {
      prims.push(polygon([pt(-2, 2), pt(2, 2), pt(2, 7), pt(-2, 7)], C.goldShade))
      prims.push(flat(capsule(...pt(-5.5, torsoLen), ...pt(0, torsoLen - 5.5), 0.7, C.gold)), flat(capsule(...pt(5.5, torsoLen), ...pt(0, torsoLen - 5.5), 0.7, C.gold)))
    } else {
      prims.push(flat(capsule(...pt(w1 - 1, torsoLen), ...pt(1.5, torsoLen - 4.5), 0.7, C.gold)))
      prims.push(ellipse(...pt(w0 + 1.5, 0.5), 2.8, 2.5, C.boot))
    }
    parts.push({ z: 2, prims, shade: (c) => dim(c, 0.72), depth: 3 })
  }

  for (const key of ['L', 'R']) {
    const isFar = side && key === 'L'
    const s = key === 'L' ? -1 : 1
    const k = tone(isFar)
    const spec = pose.arms?.[key] ?? { a: 8, b: 6 }
    const root = limbRoot(shoulder(s), isFar)
    const arm = limb(root, spec, RIG.upperArm, RIG.foreArm, side ? facing : s, torsoDeg)
    joints.reached &&= arm.reached
    joints[`hand${key}`] = arm.end
    const [mx, my] = arm.mid, [wx, wy] = arm.end
    const len = Math.hypot(wx - mx, wy - my) || 1
    const d = [(wx - mx) / len, (wy - my) / len] // along the forearm
    // the thumb's side: toward the body from the front, up from the side
    let n = [-d[1], d[0]]
    if (side ? n[1] > 0 : n[0] * (hx - wx) < 0) n = [-n[0], -n[1]]
    const prims = [
      capsule(root[0], root[1], mx, my, 3.5, k(C.tunic)),
      flat(capsule(mx - d[0] * 1.5, my - d[1] * 1.5, mx + d[0] * 0.5, my + d[1] * 0.5, 3.6, k(C.tunicLight))), // the sleeve's hem
      capsule(mx, my, wx, wy, 3, k(C.skin)),
      flat(capsule(wx - d[0] * 2.5, wy - d[1] * 2.5, wx - d[0] * 1, wy - d[1] * 1, 3.3, k(C.gold))), // a wristband
      ...handPrims([wx, wy], d, n, spec.grip ?? 'fist', spec.hand ?? RIG.hand, facing, k),
    ]
    parts.push({ z: isFar ? 0 : 5, prims, shade: (c) => dim(c, 0.72) })
  }

  // the head, pivoting at the neck
  const h = pose.head ?? {}
  parts.push({ z: h.z ?? 4, head: { ...h, x: neck[0] + up[0] + (h.dx ?? 0), y: neck[1] + up[1] + (h.dy ?? 0) } })

  // the ground shadow: the footprint, fading as the feet leave the floor
  {
    const lift = Math.max(0, FLOOR - footBottom)
    const k = Math.max(0.25, 1 - lift / 30)
    const cx = (joints.ankleL[0] + joints.ankleR[0]) / 2 + (side ? 3 * facing : 0)
    const rx = (side ? 14 : Math.abs(joints.ankleL[0] - joints.ankleR[0]) / 2 + 9) * k
    parts.push({ z: -1, shadow: [cx, FLOOR + 2, rx, 2.2 * k] })
  }

  parts.sort((a, b) => a.z - b.z)
  for (const p of parts) {
    if (p.head) drawHead(cv, p.head)
    else if (p.shadow) {
      const [cx, cy, rx, ry] = p.shadow
      const e = ellipse(cx, cy, rx, ry)
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (e.inside(x + 0.5, y + 0.5)) cv.set(x, y, OUT, 96)
    } else paintPart(cv, p.prims, { shade: p.shade, depth: p.depth })
  }
  for (const fx of pose.fx ?? []) drawFx(cv, fx)
  return joints
}

// --- clips -------------------------------------------------------------------

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t)
const mix = (a, b, t) => a + (b - a) * t
const smooth = (t) => ((t = clamp01(t)), t * t * (3 - 2 * t))
const easeOut = (t) => ((t = clamp01(t)), 1 - (1 - t) * (1 - t))
const easeIn = (t) => ((t = clamp01(t)), t * t)
const seg = (t, a, b) => clamp01((t - a) / (b - a))
const STAND_HIP_Y = FLOOR - 3 - REACH_LEG + 1 // feet planted, knees a touch soft
const CX = 64

/**
 * Keyframed values: `keys` holds values at times in [0, 1); numbers (and
 * arrays and objects of them) interpolate with the key's `ease` (smooth by
 * default), anything else holds the earlier key's value. Cyclic.
 */
function keyed(keys) {
  const EASE = { smooth, in: easeIn, out: easeOut, linear: clamp01, hold: () => 0 }
  const lerp = (a, b, u) => {
    if (typeof a === 'number' && typeof b === 'number') return mix(a, b, u)
    if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerp(v, b[i], u))
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const o = {}
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = k in a && k in b ? lerp(a[k], b[k], u) : a[k] ?? b[k]
      return o
    }
    return a
  }
  return (t) => {
    t -= Math.floor(t)
    let i = keys.length - 1
    while (i > 0 && keys[i].t > t) i--
    const a = keys[i], b = keys[(i + 1) % keys.length]
    const span = ((((b.t - a.t) % 1) + 1) % 1) || 1
    const u = EASE[a.ease ?? 'smooth']((((t - a.t) % 1) + 1) % 1 / span)
    return lerp(a.v, b.v, u)
  }
}

// 1. Neck rolls: the head rolls along a crescent, ear to shoulder on the left,
//    chin to the chest, ear to shoulder on the right, and back the same way;
//    eyes close through the bottom of the roll.
function neckRoll(t) {
  const phi = (Math.PI * (1 - Math.cos(2 * Math.PI * t))) / 2 // 0 → π → 0: left, down, right, down, left
  const side = -Math.cos(phi) // -1 at the left, +1 at the right
  const low = Math.sin(phi) // 1 at the bottom of the crescent
  const tilt = 18 * side
  const dx = 4 * side
  const dy = 6 * low
  const eyes = low > 0.85 ? 'closed' : low > 0.35 ? 'down' : 'open'
  const mouth = low > 0.7 ? 'o' : 'smirk'
  return {
    view: 'front',
    hip: [CX, STAND_HIP_Y],
    torso: 1.5 * side,
    torsoLen: RIG.torso - Math.round(1.5 * low), // the shoulders ride up as the chin drops
    head: { tilt, dx, dy: Math.round(dy), eyes, mouth },
    arms: { L: { a: 10 - 3 * side, b: 6 }, R: { a: 10 + 3 * side, b: 6 } },
    legs: { L: { target: [CX - 8, FLOOR - 3], bend: 1 }, R: { target: [CX + 8, FLOOR - 3], bend: -1 } },
  }
}

// 2. Arm circles: arms straight out, each hand sweeping a big circle around
//    the shoulder line; seen from the front the arm rises and dips, shortening
//    as the hand comes toward the viewer, and the body sways on the beat.
function armCircles(t) {
  const th = 2 * Math.PI * t
  const sway = 1.5 * Math.sin(th)
  const neckY = STAND_HIP_Y - RIG.torso
  const CONE = rad(40) // the circle's half-angle at the shoulder
  const reach = REACH_ARM + 1
  const hand = (s) => [
    CX + sway + s * (RIG.shoulderHalf + reach * Math.cos(CONE) + 4 * Math.cos(th)), // nearer the viewer: a touch wider
    neckY - reach * Math.sin(CONE) * Math.sin(th),
  ]
  return {
    view: 'front',
    hip: [CX + sway, STAND_HIP_Y],
    torso: -1.5 * Math.sin(th),
    head: { tilt: 4 * Math.sin(th), dy: Math.round(Math.cos(th)), eyes: 'open', mouth: t > 0.5 ? 'grin' : 'smirk' },
    arms: { L: { target: hand(-1), straight: true, grip: 'open' }, R: { target: hand(1), straight: true, grip: 'open' } },
    legs: { L: { target: [CX - 9, FLOOR - 3], bend: 1 }, R: { target: [CX + 9, FLOOR - 3], bend: -1 } },
  }
}

// 3. Jumping jacks: two hops a cycle, arms leading the legs, a squash on
//    each landing and sparks at the top.
function jumpingJacks(t) {
  const opening = t < 0.5
  const h = opening ? t * 2 : (t - 0.5) * 2
  const air = Math.sin(Math.PI * h)
  const spread = opening ? smooth(h) : 1 - smooth(h)
  const armRaw = opening ? smooth(seg(h, 0, 0.85)) : 1 - smooth(seg(h, 0, 0.85))
  const landing = h > 0.9 || h < 0.08
  // straight legs: the hips sit where the stance puts them, and in the air
  // the feet rise with them; only the landing dips into a bend
  const feet = 7 + 13 * spread
  const legLen = REACH_LEG - 0.3
  const legDrop = Math.sqrt(legLen * legLen - (feet - RIG.hipHalf) ** 2)
  const hipY = FLOOR - 3 - legDrop + (landing ? 2 : 0) - 9 * air
  const ankleY = landing ? FLOOR - 3 : hipY + legDrop
  const a = 12 + 118 * armRaw
  const b = 12 - 8 * armRaw
  const fx = []
  if (opening && h > 0.8) fx.push({ type: 'spark', x: 14, y: 30 }, { type: 'sparkSmall', x: 110, y: 26 })
  if (!opening && h > 0.9) fx.push({ type: 'line', x: CX - 30, y: FLOOR - 1, x2: CX - 36, y2: FLOOR - 1 }, { type: 'line', x: CX + 30, y: FLOOR - 1, x2: CX + 36, y2: FLOOR - 1 })
  return {
    view: 'front',
    hip: [CX, hipY],
    torsoLen: RIG.torso - (landing ? 2 : 0),
    head: { dy: landing ? 2 : air > 0.8 ? -1 : 0, eyes: air > 0.7 ? 'wide' : landing ? 'closed' : 'open', mouth: opening && h > 0.55 ? 'grin' : 'smirk' },
    arms: { L: { a, b }, R: { a, b } },
    legs: { L: { target: [CX - feet, ankleY], bend: 1 }, R: { target: [CX + feet, ankleY], bend: -1 } },
    fx,
  }
}

// 4. Sit-ups (side view): the torso rolls up from the floor, slow and
//    straining, holds, and lowers; the arms stay straight, reaching for the
//    knees and sweeping down to the shins at the top.
function sitUps(t) {
  const up = t < 0.5 ? smooth(seg(t, 0.02, 0.46)) : 1 - smooth(seg(t, 0.56, 0.98))
  const torso = mix(-88, 14, up)
  const hip = [74, FLOOR - 7]
  const neck = neckOf(hip, torso)
  const reach = [92 + 2 * up, 96 + 12 * up] // where the hands point: past the knees, then the shins
  const arm = (dx) => {
    const root = [neck[0] + dx, neck[1]]
    const v = [reach[0] - root[0], reach[1] - root[1]]
    const n = Math.hypot(v[0], v[1]) || 1
    return { target: [root[0] + (v[0] / n) * REACH_ARM, root[1] + (v[1] / n) * REACH_ARM], straight: true, grip: 'open' }
  }
  const effort = up > 0.25 && up < 0.95
  const top = up >= 0.95
  const fx = []
  if (top && t < 0.5) fx.push({ type: 'drop', x: neck[0] + 22, y: neck[1] - 30 })
  if (effort && t < 0.5) fx.push({ type: 'line', x: neck[0] + 26, y: neck[1] - 20, x2: neck[0] + 30, y2: neck[1] - 24 }, { type: 'line', x: neck[0] + 28, y: neck[1] - 12, x2: neck[0] + 33, y2: neck[1] - 13 })
  return {
    view: 'side',
    hip,
    torso,
    // the head stays off the floor (chin tucked); flat on the back her ear would sink into it
    head: { rot: mix(-56, 22, up), eyes: top ? 'happy' : effort ? 'squint' : up < 0.05 ? 'closed' : 'open', mouth: top ? 'o' : effort ? 'grit' : 'smirk' },
    arms: { L: arm(-2), R: arm(0) },
    legs: { L: { target: [hip[0] + 20, FLOOR - 3], bend: -1 }, R: { target: [hip[0] + 22, FLOOR - 3], bend: -1 } },
    fx,
  }
}

// 5. Squats (facing the viewer): a wide stance, knees out as the hips drop,
//    arms reaching toward the viewer, a trembling hold at the bottom, then up.
function squats(t) {
  const down = t < 0.42 ? smooth(seg(t, 0.02, 0.42)) : t < 0.56 ? 1 : 1 - easeOut(seg(t, 0.56, 0.96))
  const hold = t >= 0.42 && t < 0.56
  const tremble = hold ? Math.floor(t * 60) % 2 : 0
  const stance = 15
  const legLen = REACH_LEG - 0.3
  const topHipY = FLOOR - 3 - Math.sqrt(legLen * legLen - (stance - RIG.hipHalf) ** 2)
  const hip = [CX, topHipY + 15 * down + tremble]
  const torsoLen = RIG.torso - 4 * down // leaning forward foreshortens the torso
  const neckY = hip[1] - torsoLen
  const bottom = down > 0.8
  // arms straight toward the viewer: short on screen, the hands big and close
  const hand = (s) => ({ target: [CX + s * (RIG.shoulderHalf - 2 + 2 * down), neckY + 11 + 2 * down], straight: true, hand: 4, grip: 'open' })
  return {
    view: 'front',
    hip,
    torsoLen,
    head: { dy: bottom ? 1 : 0, eyes: bottom ? 'squint' : down > 0.3 ? 'down' : 'open', mouth: bottom ? 'grit' : t > 0.85 ? 'o' : 'smirk' },
    arms: { L: hand(-1), R: hand(1) },
    legs: { L: { target: [CX - stance, FLOOR - 3], bend: 1 }, R: { target: [CX + stance, FLOOR - 3], bend: -1 } },
    fx: hold ? [{ type: 'drop', x: CX + 26, y: neckY - 30 + Math.round(seg(t, 0.42, 0.56) * 8) }] : [],
  }
}

// A plank on the toes: the body a straight line from the ankle, `phi` degrees
// above horizontal; the knee a touch soft so IK always reaches. On the toes
// the boot reaches 12 px below the ankle, so the ankle sits that far up.
const PLANK_ANKLE = [30, FLOOR - 12]
const PLANK_TOP = 18
const PLANK_HAND = [PLANK_ANKLE[0] + (REACH_LEG - 0.6 + RIG.torso) * Math.cos(rad(PLANK_TOP)) + 1, FLOOR - 3]
function plank(phi) {
  const [ax, ay] = PLANK_ANKLE
  const leg = REACH_LEG - 0.6
  const hip = [ax + leg * Math.cos(rad(phi)), ay - leg * Math.sin(rad(phi))]
  return { hip, torso: 90 - phi }
}

// 6. Push-ups (side view): the body a straight line pivoting on the toes,
//    hands planted; strain at the bottom, a push back up.
function pushUps(t) {
  const down = t < 0.4 ? smooth(seg(t, 0.02, 0.4)) : t < 0.5 ? 1 : 1 - easeOut(seg(t, 0.5, 0.86))
  const { hip, torso } = plank(mix(PLANK_TOP, 8, down))
  const neck = neckOf(hip, torso)
  const bottom = down > 0.85
  const fx = []
  if (bottom) fx.push({ type: 'drop', x: neck[0] + 22, y: neck[1] - 26 })
  if (t > 0.5 && t < 0.7) fx.push({ type: 'puff', x: neck[0] + 30, y: neck[1] - 4 })
  return {
    view: 'side',
    hip,
    torso,
    head: { rot: 24 + 8 * down, eyes: bottom ? 'squint' : down > 0.4 ? 'down' : 'open', mouth: bottom ? 'grit' : t > 0.5 && t < 0.75 ? 'open' : 'smirk', z: 3.5 },
    arms: { L: { target: [PLANK_HAND[0] - 3, PLANK_HAND[1]], bend: 1, grip: 'flat' }, R: { target: PLANK_HAND, bend: 1, grip: 'flat' } },
    legs: { L: { target: [PLANK_ANKLE[0] - 2, PLANK_ANKLE[1]], bend: -1, toe: 90 }, R: { target: PLANK_ANKLE, bend: -1, toe: 90 } },
    fx,
  }
}

// 7. Burpees (side view): squat, kick back, push-up, hop in, leap, land.
const CROUCH = { hip: [48, FLOOR - 14], torso: 64, ankle: [54, FLOOR - 3], hand: [76, FLOOR - 3] }
const STAND = { hip: [52, STAND_HIP_Y], torso: 0, ankle: [54, FLOOR - 3] }
const burpeeKeys = keyed([
  { t: 0.0, v: { ...STAND, headRot: 0, toe: 0, arm: { a: 10, b: 6 }, hand: null, lift: 0 } },
  { t: 0.12, v: { hip: CROUCH.hip, torso: CROUCH.torso, headRot: 12, ankle: CROUCH.ankle, toe: 0, arm: { a: 0, b: 0 }, hand: CROUCH.hand, lift: 0 }, ease: 'in' },
  { t: 0.24, v: { ...plank(PLANK_TOP), headRot: 24, ankle: PLANK_ANKLE, toe: 90, arm: { a: 0, b: 0 }, hand: PLANK_HAND, lift: 10 } },
  { t: 0.34, v: { ...plank(8), headRot: 32, ankle: PLANK_ANKLE, toe: 90, arm: { a: 0, b: 0 }, hand: PLANK_HAND, lift: 0 }, ease: 'out' },
  { t: 0.44, v: { ...plank(PLANK_TOP), headRot: 24, ankle: PLANK_ANKLE, toe: 90, arm: { a: 0, b: 0 }, hand: PLANK_HAND, lift: 0 } },
  // the hands leave the floor here: the arms swing back for the leap
  { t: 0.56, v: { hip: CROUCH.hip, torso: CROUCH.torso, headRot: 12, ankle: CROUCH.ankle, toe: 0, arm: { a: 30, b: 10 }, hand: null, lift: 10 }, ease: 'out' },
  { t: 0.62, v: { hip: [50, FLOOR - 36], torso: 14, headRot: 2, ankle: [54, FLOOR - 10], toe: 50, arm: { a: -50, b: -10 }, hand: null, lift: 0 }, ease: 'out' },
  { t: 0.7, v: { hip: [52, FLOOR - 50], torso: -4, headRot: -4, ankle: [54, FLOOR - 26], toe: 70, arm: { a: 95, b: -10 }, hand: null, lift: 0 }, ease: 'in' },
  { t: 0.82, v: { hip: [50, FLOOR - 22], torso: 26, headRot: 8, ankle: [54, FLOOR - 3], toe: 0, arm: { a: 60, b: 10 }, hand: null, lift: 0 }, ease: 'out' },
  { t: 0.92, v: { ...STAND, headRot: 0, toe: 0, arm: { a: 10, b: 6 }, hand: null, lift: 0 } },
])
function burpees(t) {
  const k = burpeeKeys(t)
  const arms = k.hand ? { L: { target: [k.hand[0] - 3, k.hand[1]], bend: 1, grip: 'flat' }, R: { target: k.hand, bend: 1, grip: 'flat' } } : { L: k.arm, R: k.arm }
  const ankle = [k.ankle[0], k.ankle[1] - k.lift]
  const neck = neckOf(k.hip, k.torso)
  const airborne = t > 0.6 && t < 0.8
  const apex = t > 0.66 && t < 0.76
  const pushing = t > 0.3 && t < 0.42
  const fx = []
  if (apex) fx.push({ type: 'spark', x: neck[0] - 34, y: neck[1] - 30 }, { type: 'sparkSmall', x: neck[0] + 30, y: neck[1] - 36 }, { type: 'sparkSmall', x: neck[0] - 26, y: neck[1] + 4 })
  if (t > 0.84 && t < 0.98) fx.push({ type: 'drop', x: neck[0] + 22, y: neck[1] - 30 + Math.round((t - 0.84) * 40) })
  if (pushing) fx.push({ type: 'line', x: neck[0] + 26, y: neck[1] - 22, x2: neck[0] + 30, y2: neck[1] - 26 }, { type: 'line', x: neck[0] + 29, y: neck[1] - 14, x2: neck[0] + 34, y2: neck[1] - 15 })
  return {
    view: 'side',
    hip: k.hip,
    torso: k.torso,
    head: { rot: k.headRot, eyes: apex ? 'wide' : pushing ? 'squint' : t > 0.8 && t < 0.92 ? 'closed' : 'open', mouth: apex ? 'grin' : pushing ? 'grit' : t > 0.84 ? 'open' : 'smirk', z: airborne ? 4 : 3.5 },
    arms,
    legs: { L: { target: [ankle[0] - 2, ankle[1]], bend: -1, toe: k.toe }, R: { target: ankle, bend: -1, toe: k.toe } },
    fx,
  }
}

export const EXERCISES = [
  { id: 'neck-roll', name: 'neck rolls', difficulty: 1, seconds: 3.0, pose: neckRoll },
  { id: 'arm-circles', name: 'arm circles', difficulty: 2, seconds: 1.2, pose: armCircles },
  { id: 'jumping-jacks', name: 'jumping jacks', difficulty: 3, seconds: 0.85, pose: jumpingJacks },
  { id: 'sit-ups', name: 'sit-ups', difficulty: 4, seconds: 1.7, pose: sitUps },
  { id: 'squats', name: 'squats', difficulty: 5, seconds: 1.8, pose: squats },
  { id: 'push-ups', name: 'push-ups', difficulty: 6, seconds: 1.5, pose: pushUps },
  { id: 'burpees', name: 'burpees', difficulty: 7, seconds: 2.5, pose: burpees },
].map((ex) => ({ ...ex, frames: Math.round(ex.seconds * FPS) }))

export const byDifficulty = (d) => EXERCISES.find((x) => x.difficulty === Math.min(7, Math.max(1, d | 0))) ?? EXERCISES[0]

/** The path of a pre-rendered frame, relative to the plugin root. */
export const framePath = (ex, i) => `assets/frames/${ex.id}/f${i}.png`

/**
 * The canvas as terminal cells, `columns` wide and `rows` tall, two pixels a
 * cell (▀ over a background color). Each pixel takes the majority color of
 * its source box, so the palette stays exact. Returns [codePoint, fg, bg] per
 * cell, row-major; -1 is the terminal's own color.
 */
export function halfBlocks(cv, columns, rows) {
  const W = columns, H = rows * 2
  const pick = (px, py) => {
    const x0 = Math.floor((px * cv.w) / W), x1 = Math.max(x0 + 1, Math.floor(((px + 1) * cv.w) / W))
    const y0 = Math.floor((py * cv.h) / H), y1 = Math.max(y0 + 1, Math.floor(((py + 1) * cv.h) / H))
    const votes = new Map()
    let n = 0, opaque = 0
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        n++
        const i = (y * cv.w + x) * 4
        if (cv.rgba[i + 3] < 128) continue
        opaque++
        const c = (cv.rgba[i] << 16) | (cv.rgba[i + 1] << 8) | cv.rgba[i + 2]
        votes.set(c, (votes.get(c) ?? 0) + 1)
      }
    if (opaque * 2 < n) return -1
    let best = -1, most = 0
    for (const [c, k] of votes) if (k > most) (most = k), (best = c)
    return best
  }
  const cells = []
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < columns; cx++) {
      const top = pick(cx, cy * 2), bottom = pick(cx, cy * 2 + 1)
      if (top >= 0 && bottom >= 0) cells.push([0x2580, top, bottom])
      else if (top >= 0) cells.push([0x2580, top, -1])
      else if (bottom >= 0) cells.push([0x2584, bottom, -1])
      else cells.push([32, -1, -1])
    }
  return cells
}

/**
 * Renders frame `i` of an exercise into a fresh canvas. The hair cap trails
 * the head's vertical motion by a pixel, read off the previous frame.
 */
export function renderFrame(ex, i, cv = new Canvas()) {
  const t = (i % ex.frames) / ex.frames
  const pose = ex.pose(t)
  const prev = ex.pose(t - 1 / ex.frames)
  const vy = neckOf(pose.hip, pose.torso)[1] + (pose.head?.dy ?? 0) - neckOf(prev.hip, prev.torso)[1] - (prev.head?.dy ?? 0)
  const head = { ...(pose.head ?? {}), cap: vy > 2.5 ? -1 : vy < -2.5 ? 1 : 0 }
  const joints = drawPose(cv, { ...pose, head })
  return { canvas: cv, joints, pose }
}
