// The showcase's opening act, drawn in Pixi's own style: a 240 x 135 room (an
// eighth of 1080p, so every pixel lands on an 8 x 8 block of the video) where
// Pixi prompts Claude all day, waits on the phone, grows a belly, has the idea,
// and builds the mod.
//
//   node showcase/tools/story.mjs --sheet out.png [frame ...]   contact sheet of frames (default: one per beat)
//
// `drawStory(cv, i)` draws frame i (12 fps) into a 240 x 135 canvas and returns
// the joints, so the caller can assert every IK target was reached.
import { writeFileSync } from 'node:fs'
import { Canvas, RIG, EXERCISES, READY, OUTRO, introOf, renderFrame, drawPose, drawTitle, shapes, PALETTE as C, OUTLINE as OUT, ease, drawFx } from '../../hooks/pixi.js'
import { encodePNG, upscale } from '../../tools/png.mjs'

const { capsule, ellipse, polygon, flat, paintPart } = shapes
const { mix, smooth, seg, clamp01 } = ease

export const W = 240
export const H = 135
const FLOOR_Y = 104 // the room's floor: Pixi's soles rest on it

// the acts, in frames at 12 fps
export const ACT1 = 96 // a day at the desk
export const ACT2 = 36 // the realization
export const ACT3 = 48 // the build
export const ACT4 = 84 // the payoff: Pumpt! on the monitor, Pixi up and exercising, the belly going
export const STORY_FRAMES = ACT1 + ACT2 + ACT3 + ACT4

const hex = (s) => parseInt(s.slice(1), 16)
const ROOM = {
  wall: hex('#2a2342'),
  wallLight: hex('#352c52'),
  floor: hex('#3a2f55'),
  floorLine: hex('#1e1733'),
  screen: hex('#0f0f1a'),
  screenText: hex('#5a47a3'),
  screenBright: hex('#9ad5f5'),
  keys: hex('#b8b0c8'),
  phone: hex('#1a1a2e'),
  donut: hex('#e86a8a'),
  card: hex('#c9c3dd'),
}
const SKY = [
  [0.0, hex('#7fc3ea')],
  [0.35, hex('#a9dcf5')],
  [0.62, hex('#f2a35b')],
  [0.82, hex('#2b2f66')],
  [1.0, hex('#141838')],
]
const mixRgb = (a, b, t) => {
  const ch = (s) => Math.round(mix((a >> s) & 255, (b >> s) & 255, t))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}
const skyAt = (p) => {
  let i = 0
  while (i < SKY.length - 2 && SKY[i + 1][0] < p) i++
  const [t0, c0] = SKY[i], [t1, c1] = SKY[i + 1]
  return mixRgb(c0, c1, clamp01((p - t0) / (t1 - t0)))
}

const fill = (cv, x0, y0, x1, y1, rgb) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cv.set(x, y, rgb)
}

// The scene is two layers, so the video can move them apart (parallax): `bg`
// is the room (opaque), `fg` the furniture and Pixi on a clear canvas. The
// video composites over its own dark background, so a translucent fg pixel (a
// ground shadow, a fading card) is blended here over the room's colour under
// it and made opaque; clear pixels stay clear.
function flattenOver(fg, bg) {
  for (let p = 0; p < fg.rgba.length; p += 4) {
    const a = fg.rgba[p + 3]
    if (a === 255 || a === 0) continue
    const k = a / 255
    for (let c = 0; c < 3; c++) fg.rgba[p + c] = Math.round(fg.rgba[p + c] * k + bg.rgba[p + c] * (1 - k))
    fg.rgba[p + 3] = 255
  }
}

// --- the room ----------------------------------------------------------------

/** Walls, floor, the window at `day` (0 morning .. 1 night), the clock two laps round. */
function drawRoom(cv, day) {
  fill(cv, 0, 0, W, FLOOR_Y, ROOM.wall)
  // a lighter band along the top of the wall, like a frieze
  fill(cv, 0, 0, W, 6, ROOM.wallLight)
  fill(cv, 0, FLOOR_Y, W, H, ROOM.floor)
  fill(cv, 0, FLOOR_Y, W, FLOOR_Y + 1, ROOM.floorLine)
  for (let x = 0; x < W; x += 16) fill(cv, x, FLOOR_Y + 12, x + 8, FLOOR_Y + 13, ROOM.floorLine) // floorboards

  // the window: sky, sun or moon, then the frame
  const [wx0, wy0, wx1, wy1] = [16, 16, 66, 56]
  fill(cv, wx0, wy0, wx1, wy1, skyAt(day))
  if (day < 0.78) {
    // the sun crosses the window on an arc
    const u = day / 0.78
    const sx = mix(wx0 + 6, wx1 - 6, u), sy = wy1 - 6 - 26 * Math.sin(Math.PI * u)
    paintPart(cv, [ellipse(sx, sy, 5, 5, day > 0.55 ? hex('#f28b4b') : C.spark)], { outline: false, highlight: false, depth: 1, shade: (c) => c })
  }
  // the room is opaque throughout: a translucent pixel here would show the
  // video's background, not the sky. The moon rises in, the stars come out one
  // by one, the clouds drift off through the morning.
  if (day > 0.86) {
    const rise = clamp01((day - 0.86) / 0.08)
    paintPart(cv, [ellipse(wx1 - 12, wy0 + 11 + Math.round(8 * (1 - rise)), 4, 4, C.light)], { outline: false, highlight: false, depth: 1, shade: (c) => c })
    const stars = [[22, 22], [30, 40], [44, 20], [56, 34], [26, 48]]
    stars.slice(0, Math.round(rise * stars.length)).forEach(([x, y]) => cv.set(x, y, C.light))
  }
  if (day < 0.45) {
    const dx = Math.round(day * 90)
    for (const [x, y, w] of [[22 + dx, 24, 10], [8 + dx, 36, 8]]) {
      const x0 = Math.max(wx0, x), x1 = Math.min(wx1, x + w)
      if (x1 > x0) paintPart(cv, [capsule(x0, y, x1, y, 2.5, C.light)], { outline: false, highlight: false, shade: (c) => c })
    }
  }
  // frame and cross bars, a sill
  const frame = OUT
  fill(cv, wx0 - 2, wy0 - 2, wx1 + 2, wy0, frame)
  fill(cv, wx0 - 2, wy1, wx1 + 2, wy1 + 2, frame)
  fill(cv, wx0 - 2, wy0, wx0, wy1, frame)
  fill(cv, wx1, wy0, wx1 + 2, wy1, frame)
  fill(cv, Math.round((wx0 + wx1) / 2) - 1, wy0, Math.round((wx0 + wx1) / 2) + 1, wy1, frame)
  fill(cv, wx0, Math.round((wy0 + wy1) / 2) - 1, wx1, Math.round((wy0 + wy1) / 2) + 1, frame)
  paintPart(cv, [polygon([[wx0 - 5, wy1 + 2], [wx1 + 5, wy1 + 2], [wx1 + 5, wy1 + 5], [wx0 - 5, wy1 + 5]], C.boot)], { depth: 1 })

  // the clock, on the open wall between Pixi and the monitor: two laps of the hour hand over the day
  const [cx, cy] = [140, 22]
  paintPart(cv, [ellipse(cx, cy, 9, 9, C.light)], { depth: 1, highlight: false })
  for (let k = 0; k < 12; k += 3) cv.set(Math.round(cx + 6.5 * Math.sin((k * Math.PI) / 6)), Math.round(cy - 6.5 * Math.cos((k * Math.PI) / 6)), OUT)
  const th = day * 4 * Math.PI
  drawFx(cv, { type: 'line', x: cx, y: cy, x2: cx + 5.5 * Math.sin(th), y2: cy - 5.5 * Math.cos(th), color: OUT })
  drawFx(cv, { type: 'line', x: cx, y: cy, x2: cx + 3.5 * Math.sin(th / 12), y2: cy - 3.5 * Math.cos(th / 12), color: OUT })

  // a poster above the monitor: the gym Pixi never went to
  drawTitle(cv, ['GYM'], 188, 20, 1)
  fill(cv, 175, 10, 201, 11, OUT)
  fill(cv, 175, 29, 201, 30, OUT)
  fill(cv, 175, 10, 176, 30, OUT)
  fill(cv, 200, 10, 201, 30, OUT)
}

/** The desk with the keyboard, the monitor (its screen drawn by `screen(cv, x, y, w, h)`), a mug, and a donut while it lasts. */
function drawDesk(cv, { donut = 1, screen } = {}) {
  // the chair, behind Pixi: a seat on a post, a back
  paintPart(cv, [polygon([[82, 50], [90, 50], [90, 86], [82, 86]], C.pants), polygon([[84, 86], [120, 86], [120, 91], [84, 91]], C.pants)], { depth: 1 })
  paintPart(cv, [capsule(102, 91, 102, 101, 1.5, dimc(C.pants)), capsule(92, 102, 112, 102, 1.8, dimc(C.pants))], { depth: 1, highlight: false })

  // the desk: a top on two legs
  paintPart(cv, [polygon([[112, 76], [232, 76], [232, 80], [112, 80]], C.boot)], { depth: 1 })
  paintPart(cv, [polygon([[116, 80], [121, 80], [121, FLOOR_Y], [116, FLOOR_Y]], dimc(C.boot)), polygon([[223, 80], [228, 80], [228, FLOOR_Y], [223, FLOOR_Y]], dimc(C.boot))], { depth: 1, highlight: false })
  // the keyboard, under the hands
  paintPart(cv, [polygon([[115, 73], [137, 73], [138, 76], [114, 76]], ROOM.keys)], { depth: 1, highlight: false })
  for (let x = 117; x < 136; x += 3) cv.set(x, 74, dimc(ROOM.keys))
  // the monitor: a foot, a neck, a bezel, the screen
  paintPart(cv, [ellipse(188, 75, 9, 2, dimc(C.pants))], { depth: 1, highlight: false })
  paintPart(cv, [capsule(188, 68, 188, 75, 2, C.pants)], { depth: 1, highlight: false })
  paintPart(cv, [polygon([[162, 36], [214, 36], [214, 70], [162, 70]], C.pants)], { depth: 2 })
  fill(cv, 166, 40, 210, 66, ROOM.screen)
  if (screen) screen(cv, 166, 40, 44, 26)
  // a mug, and the donut
  paintPart(cv, [polygon([[216, 66], [224, 66], [223, 76], [217, 76]], C.drop), capsule(225, 69, 225, 73, 1.5, C.drop)], { depth: 1 })
  if (donut > 0) {
    const r = 4 * donut
    paintPart(cv, [ellipse(150, 73, r + 1.5, r * 0.55 + 1, ROOM.donut), ellipse(150, 73, Math.max(0.5, r - 2.5), Math.max(0.3, r * 0.3), C.boot)], { depth: 1 })
  } else {
    for (const [x, y] of [[146, 75], [151, 74], [155, 75]]) cv.set(x, y, ROOM.donut)
  }
}
const dimc = (rgb) => {
  const c = (v) => Math.round(v * 0.72)
  return (c((rgb >> 16) & 255) << 16) | (c((rgb >> 8) & 255) << 8) | c(rgb & 255)
}

/** The phone in Pixi's hands, upright, with X's mark on its screen. */
function drawPhone(cv, x, y) {
  paintPart(cv, [polygon([[x, y], [x + 7, y], [x + 7, y + 12], [x, y + 12]], ROOM.phone)], { depth: 1, highlight: false })
  fill(cv, x + 1, y + 1, x + 6, y + 11, hex('#15151f'))
  // the screen stays blank here: the video draws X's logo on it (tools/media.mjs exports the position)
}

/** Posts drifting up from the phone and fading: the feed. */
function drawFeed(cv, x, y, k) {
  for (let i = 0; i < 4; i++) {
    const age = (k * 1.4 + i * 11) % 44
    const px = Math.round(x + 10 + 5 * Math.sin((age + i * 7) / 6)), py = Math.round(y - age)
    const a = Math.round(230 * clamp01(1 - age / 44))
    if (py < 2) continue
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 11; dx++) cv.set(px + dx, py + dy, dy === 0 || dy === 5 || dx === 0 || dx === 10 ? OUT : ROOM.card, a)
    for (let dx = 2; dx < 9; dx++) cv.set(px + dx, py + 2, ROOM.screenText, a)
    for (let dx = 2; dx < 7; dx++) cv.set(px + dx, py + 4, ROOM.screenText, a)
  }
}

/** The thought bubble with the lightbulb, and a dumbbell beside it. */
function drawIdea(cv, x, y, s) {
  // the bubble grows in
  const r = 13 * s
  paintPart(cv, [ellipse(x, y, r * 1.35, r, C.light), ellipse(x - r * 1.1, y + r * 1.1, 2.5 * s, 2.5 * s, C.light), ellipse(x - r * 1.6, y + r * 1.7, 1.5 * s, 1.5 * s, C.light)], { depth: 1, highlight: false })
  if (s < 0.9) return
  // the bulb: a glass, a base, rays
  paintPart(cv, [ellipse(x - 5, y - 2, 4.5, 4.5, C.spark), polygon([[x - 7, y + 3], [x - 3, y + 3], [x - 3, y + 6], [x - 7, y + 6]], C.goldShade)], { depth: 1 })
  for (const [dx, dy] of [[-12, -2], [2, -2], [-5, -9], [-10, -8], [0, -8]]) cv.set(x + dx, y + dy, C.spark)
  // the dumbbell
  paintPart(cv, [capsule(x + 3, y + 1, x + 11, y + 1, 1, OUT), polygon([[x + 2, y - 2], [x + 4, y - 2], [x + 4, y + 4], [x + 2, y + 4]], C.drop), polygon([[x + 10, y - 2], [x + 12, y - 2], [x + 12, y + 4], [x + 10, y + 4]], C.drop)], { depth: 1, highlight: false })
}

// --- Pixi at the desk ------------------------------------------------------------

const HIP = [102, 84]
// knees forward: facing right, a knee's natural bend is -1 (the rig's rule), seated or not
const SEATED_LEGS = { L: { target: [116, 99.5], bend: -1, toe: 0 }, R: { target: [119, 99.5], bend: -1, toe: 0 } }

/** A seated pose: `lean` degrees of torso (forward is positive), arms by `arms`, the belly by `bulk`. */
function seated({ lean = 8, arms, head = {}, bulk = 0, fx = [] }) {
  // the head a touch higher and in front of the near shoulder, which otherwise covers the chin
  return { view: 'side', facing: 1, hip: HIP, torso: lean, bulk, floor: FLOOR_Y, legs: SEATED_LEGS, arms, head: { dy: -3, z: 5.5, ...head }, fx }
}
// every target is within the arm's 25 px of the neck at the lean it is used with
const TYPING = (k) => ({
  L: { target: [122 + (k % 2), 73.5], bend: 1, grip: 'flat' },
  R: { target: [126 - (k % 2), 72], bend: 1, grip: 'flat' },
})
const PHONE_HANDS = (flick) => ({
  L: { target: [117, 60], bend: 1, grip: 'fist' },
  R: { target: [120, 58 + flick], bend: 1, grip: 'fist' },
})
const LAP = { L: { target: [109, 80], bend: 1, grip: 'open' }, R: { target: [113, 81], bend: 1, grip: 'open' } }

/** The monitor while Pixi waits for Claude: a prompt line and a spinner. */
const screenWaiting = (k, typed) => (cv, x, y, w, h) => {
  // earlier lines of the conversation
  for (let r = 0; r < 4; r++) fill(cv, x + 2, y + 2 + r * 4, x + 2 + [18, 30, 12, 24][r], y + 3 + r * 4, ROOM.screenText)
  // the prompt: "> " and the typed width, with a blinking caret
  fill(cv, x + 2, y + 20, x + 4, y + 22, ROOM.screenBright)
  fill(cv, x + 6, y + 20, x + 6 + typed, y + 22, ROOM.screenBright)
  if (k % 8 < 4) fill(cv, x + 7 + typed, y + 19, x + 9, y + 23, ROOM.screenBright)
  // the spinner, three dots in turn
  if (typed >= 28) for (let d = 0; d < 3; d++) cv.set(x + 34 + d * 3, y + 14, Math.floor(k / 2) % 3 === d ? ROOM.screenBright : ROOM.screenText)
}

/** The monitor during the build: code filling the screen, then a bar. */
const screenBuilding = (k) => (cv, x, y, w, h) => {
  const rows = Math.min(6, Math.floor(k / 3))
  for (let r = 0; r < rows; r++) {
    const widths = [20, 34, 14, 28, 38, 10]
    fill(cv, x + 2, y + 2 + r * 3, x + 2 + widths[r], y + 3 + r * 3, ROOM.screenBright)
  }
  if (k >= 24) {
    drawTitle(cv, ['BUILD'], x + 22, y + 15, 1)
    const p = clamp01((k - 24) / 18)
    fill(cv, x + 4, y + 21, x + 40, y + 24, OUT)
    fill(cv, x + 5, y + 22, x + 5 + Math.round(34 * p), y + 23, C.spark)
  }
  if (k >= 45) fill(cv, x, y, x + w, y + h, C.light)
}

// --- the acts ----------------------------------------------------------------------

/** Act 1: prompt, wait, scroll; the day passes and the belly grows. */
function act1(bg, cv, i) {
  const day = i / (ACT1 - 1)
  const bulk = smooth(day)
  drawRoom(bg, day)
  // the beats: typing / scrolling, twice
  const phase = i < 18 ? 'type' : i < 50 ? 'scroll' : i < 62 ? 'type' : 'scroll'
  const typed = phase === 'type' ? Math.min(28, (i < 18 ? i : i - 50) * 2) : 28
  const donut = i < 66 ? 1 : i < 72 ? 1 - (i - 66) / 6 : 0
  drawDesk(cv, { donut, screen: screenWaiting(i, typed) })
  let pose, fx = []
  if (phase === 'type') {
    pose = seated({ lean: 8 + 4 * bulk, arms: TYPING(i), head: { rot: 6, eyes: 'open', mouth: i % 12 < 6 ? 'smirk' : 'o' }, bulk })
  } else {
    const k = i < 50 ? i - 18 : i - 62
    const slump = i >= 62 ? 1 : 0.5
    const flick = k % 6 === 0 ? -1 : 0
    const sleepy = i >= 62 && k % 14 > 10
    pose = seated({ lean: -6 - 8 * slump, arms: PHONE_HANDS(flick), head: { rot: 16, eyes: sleepy ? 'closed' : 'down', mouth: 'smirk' }, bulk })
  }
  const joints = drawPose(cv, pose)
  if (phase !== 'type') {
    // the phone sits in the near hand; the feed drifts up from it
    const [hx, hy] = joints.handR
    drawPhone(cv, hx - 2, hy - 8)
    drawFeed(cv, hx, hy - 10, i)
    joints.phone = [hx - 2 + 3.5, hy - 8 + 6] // the screen's centre, for the logo
  }
  for (const f of fx) drawFx(cv, f)
  flattenOver(cv, bg)
  return joints
}

/** Act 2: the phone sags, a look down at the belly, the idea. */
function act2(bg, cv, i) {
  drawRoom(bg, 1)
  drawDesk(cv, { donut: 0 })
  const down = smooth(seg(i, 0, 8))
  const idea = smooth(seg(i, 18, 26))
  const arms = i < 10
    ? { L: { target: [mix(117, 109, down), mix(60, 80, down)], bend: 1, grip: 'fist' }, R: { target: [mix(120, 113, down), mix(58, 81, down)], bend: 1, grip: 'fist' } }
    : LAP
  const looking = i >= 6 && i < 20
  const fx = []
  if (i >= 8 && i < 20) fx.push({ type: 'drop', x: 118, y: 44 + Math.round((i - 8) * 0.6) })
  const pose = seated({
    lean: mix(-14, 2, down),
    arms,
    head: looking ? { rot: 30, eyes: 'wide', mouth: 'o' } : i >= 20 ? { rot: -6, eyes: 'happy', mouth: 'grin' } : { rot: 16, eyes: 'down', mouth: 'smirk' },
    bulk: 1,
    fx,
  })
  const joints = drawPose(cv, pose)
  if (i < 6) {
    drawPhone(cv, joints.handR[0] - 2, joints.handR[1] - 8)
    joints.phone = [joints.handR[0] + 1.5, joints.handR[1] - 2]
  }
  if (i >= 12 && i < 19) drawTitle(cv, ['!'], 126, 18, 1)
  if (idea > 0) drawIdea(cv, 148, 42, idea)
  flattenOver(cv, bg)
  return joints
}

/** Act 3: the build, then up out of the chair. */
function act3(bg, cv, i) {
  drawRoom(bg, 1)
  drawDesk(cv, { donut: 0, screen: screenBuilding(i) })
  const fx = []
  if (i < 40) {
    // keys flying: sparks off the keyboard, motion ticks over the hands, sweat
    if (i % 3 === 0) fx.push({ type: 'sparkSmall', x: 116 + (i % 9), y: 64 })
    fx.push({ type: 'line', x: 121, y: 62 + (i % 2), x2: 124, y2: 62 + (i % 2), color: C.light }, { type: 'line', x: 128, y: 60 + ((i + 1) % 2), x2: 130, y2: 60 + ((i + 1) % 2), color: C.light })
    if (i % 12 < 5) fx.push({ type: 'drop', x: 131, y: 28 + (i % 12) * 2 })
  }
  const rise = smooth(seg(i, 40, 47))
  if (rise === 0) {
    const pose = seated({ lean: 14, arms: TYPING(i), head: { rot: 8, eyes: i < 30 ? 'squint' : 'wide', mouth: i < 30 ? 'grit' : 'grin' }, bulk: 1, fx })
    const joints = drawPose(cv, pose)
    flattenOver(cv, bg)
    return joints
  }
  // standing up: the hips come up off the seat, the arms go up, the eyes light up
  const hipY = mix(HIP[1], FLOOR_Y - 4.5 - (RIG.thigh + RIG.shin) + 1, rise)
  const hipX = mix(HIP[0], 100, rise)
  const ankle = [mix(116, 104, rise), FLOOR_Y - 4.5]
  const pose = {
    view: 'side',
    facing: 1,
    hip: [hipX, hipY],
    torso: mix(14, 0, rise),
    bulk: 1,
    floor: FLOOR_Y,
    legs: { L: { target: [ankle[0] - 2, ankle[1]], bend: -1, toe: 0 }, R: { target: ankle, bend: -1, toe: 0 } },
    // the arms swing from the keyboard up over the head as the body rises
    arms: { L: { a: mix(75, 150, rise), b: mix(45, -10, rise) }, R: { a: mix(70, 150, rise), b: mix(50, -10, rise) } },
    head: { rot: mix(8, -4, rise), eyes: 'wide', mouth: 'grin' },
    fx: i >= 46 ? [{ type: 'spark', x: 80, y: 18 }, { type: 'sparkSmall', x: 124, y: 14 }] : [],
  }
  const joints = drawPose(cv, pose)
  flattenOver(cv, bg)
  return joints
}

/** An exercise pose moved by (dx, dy): the clips are laid out for the mod's 128 px canvas. */
function movePose(pose, dx, dy) {
  const pt = (p) => (p ? [p[0] + dx, p[1] + dy] : p)
  const limb = (l) => (l?.target ? { ...l, target: pt(l.target) } : l)
  return {
    ...pose,
    hip: pt(pose.hip),
    legs: { L: limb(pose.legs?.L), R: limb(pose.legs?.R) },
    arms: { L: limb(pose.arms?.L), R: limb(pose.arms?.R) },
    fx: (pose.fx ?? []).map((f) => ({ ...f, x: f.x + dx, y: f.y + dy, x2: f.x2 == null ? undefined : f.x2 + dx, y2: f.y2 == null ? undefined : f.y2 + dy })),
  }
}
const SQUATS = EXERCISES.find((e) => e.id === 'squats')
const JACKS = EXERCISES.find((e) => e.id === 'jumping-jacks')
// where Pixi stands to work out: between the window and the desk, feet on the room's floor
const GYM_DX = 72 - 64, GYM_DY = FLOOR_Y - 118

/** The monitor running Pumpt!: the prompt, Claude's lines, and the band with the sprite doing `clip` frame `k`. */
const screenPumpt = (clip, k, lines) => (cv, x, y, w, h) => {
  fill(cv, x + 2, y + 2, x + 4, y + 4, ROOM.screenBright)
  fill(cv, x + 6, y + 2, x + 30, y + 4, ROOM.screenBright)
  for (let r = 0; r < lines; r++) fill(cv, x + 2, y + 7 + r * 3, x + 2 + [14, 20, 11, 17][r % 4], y + 8 + r * 3, ROOM.screenText)
  // the band: the sprite at 20 px, sampled from the clip's own frame
  const src = renderFrame(clip, k).canvas
  const S = 20
  for (let v = 0; v < S; v++)
    for (let u = 0; u < S; u++) {
      const p = (Math.floor((v * src.h) / S) * src.w + Math.floor((u * src.w) / S)) * 4
      if (src.rgba[p + 3] > 128) cv.set(x + w - S - 2 + u, y + h - S - 4 + v, (src.rgba[p] << 16) | (src.rgba[p + 1] << 8) | src.rgba[p + 2])
    }
  fill(cv, x + w - 18, y + h - 3, x + w - 2, y + h - 2, ROOM.screenText) // the status line
}

/** Act 4: a new morning. Pumpt! is on the screen; Pixi gets up and does the set, the belly going with it. */
function act4(bg, cv, i) {
  drawRoom(bg, 0.2)
  const phase = i < 14 ? 'look' : i < 52 ? 'squats' : i < 72 ? 'jacks' : 'flex'
  const bulk = i < 14 ? 1 : i < 52 ? mix(1, 0.45, smooth((i - 14) / 38)) : i < 72 ? mix(0.45, 0, smooth((i - 52) / 20)) : 0
  const clip = i < 6 ? READY : i < 14 ? introOf(SQUATS) : i < 52 ? SQUATS : i < 72 ? JACKS : OUTRO
  const k = i < 6 ? i : i < 14 ? Math.min(17, (i - 6) * 2) : i < 52 ? (i - 14) % SQUATS.frames : i < 72 ? (i - 52) % JACKS.frames : Math.min(35, 12 + (i - 72) * 2)
  drawDesk(cv, { donut: 0, screen: screenPumpt(clip, k, Math.min(4, Math.floor(i / 16))) })
  let pose
  if (phase === 'look') {
    // standing at the desk, a look at the screen, the eyes lighting up
    const hipY = FLOOR_Y - 4.5 - (RIG.thigh + RIG.shin) + 1
    pose = {
      view: 'side', facing: 1, hip: [100, hipY], torso: 4,
      legs: { L: { target: [102, FLOOR_Y - 4.5], bend: -1, toe: 0 }, R: { target: [104, FLOOR_Y - 4.5], bend: -1, toe: 0 } },
      arms: { L: { a: 20, b: 10 }, R: { a: 25, b: 12 } },
      head: { rot: 4, eyes: i < 7 ? 'open' : 'wide', mouth: i < 7 ? 'smirk' : 'grin' },
      fx: i >= 8 ? [{ type: 'sparkSmall', x: 128, y: 30 }] : [],
    }
  } else if (phase === 'squats') pose = movePose(SQUATS.pose(((i - 14) % SQUATS.frames) / SQUATS.frames), GYM_DX, GYM_DY)
  else if (phase === 'jacks') pose = movePose(JACKS.pose(((i - 52) % JACKS.frames) / JACKS.frames), GYM_DX, GYM_DY)
  else {
    // slim, arms up, sparks: the flex
    const hipY = FLOOR_Y - 4.5 - (RIG.thigh + RIG.shin) + 1
    pose = {
      view: 'front', hip: [72, hipY],
      legs: { L: { target: [63, FLOOR_Y - 4.5], bend: 1 }, R: { target: [81, FLOOR_Y - 4.5], bend: -1 } },
      arms: { L: { a: 150, b: -20 }, R: { a: 150, b: -20 } },
      head: { eyes: 'happy', mouth: 'grin' },
      fx: [{ type: 'spark', x: 22 + (i % 4) * 2, y: 14 }, { type: 'sparkSmall', x: 112, y: 22 }, { type: 'sparkSmall', x: 30, y: 60 }],
    }
  }
  // the belly's sweat, while it lasts
  const fx = [...(pose.fx ?? [])]
  if (phase === 'squats' && (i - 14) % 11 < 4) fx.push({ type: 'drop', x: 96, y: 40 + ((i - 14) % 11) * 2 })
  const joints = drawPose(cv, { ...pose, bulk, floor: FLOOR_Y, head: { ...(pose.head ?? {}), cap: 0 }, fx })
  flattenOver(cv, bg)
  return joints
}

/** Frame `i` of the story as two 240 x 135 layers, the room and the rest; returns { bg, fg, joints }. */
export function drawStoryLayers(i) {
  const bg = new Canvas(W, H), fg = new Canvas(W, H)
  const joints =
    i < ACT1 ? act1(bg, fg, i) : i < ACT1 + ACT2 ? act2(bg, fg, i - ACT1) : i < ACT1 + ACT2 + ACT3 ? act3(bg, fg, i - ACT1 - ACT2) : act4(bg, fg, i - ACT1 - ACT2 - ACT3)
  return { bg, fg, joints }
}

/** Frame `i` of the story composited into one canvas; returns the joints. */
export function drawStory(cv, i) {
  const { bg, fg, joints } = drawStoryLayers(i)
  for (let p = 0; p < cv.rgba.length; p += 4) {
    const a = fg.rgba[p + 3]
    for (let c = 0; c < 3; c++) cv.rgba[p + c] = a ? fg.rgba[p + c] : bg.rgba[p + c]
    cv.rgba[p + 3] = 255
  }
  return joints
}

// --- a contact sheet, for looking at it ------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('story.mjs')) {
  const args = process.argv.slice(2)
  const si = args.indexOf('--sheet')
  const out = si >= 0 ? args[si + 1] : null
  const picked = args.filter((a, k) => !a.startsWith('--') && args[k - 1] !== '--sheet').map(Number)
  const frames = picked.length ? picked : [0, 30, 60, 95, 96 + 10, 96 + 30, 96 + 36 + 20, 96 + 36 + 47]
  const K = 3, COLS = 4, cell = W * K + 4
  const rows = Math.ceil(frames.length / COLS)
  const sheet = new Canvas(COLS * cell, rows * (H * K + 4))
  for (let p = 0; p < sheet.rgba.length; p += 4) sheet.rgba[p] = 0x10, sheet.rgba[p + 1] = 0x10, sheet.rgba[p + 2] = 0x14, sheet.rgba[p + 3] = 255
  frames.forEach((f, n) => {
    const cv = new Canvas(W, H)
    const joints = drawStory(cv, f)
    if (!joints.reached) console.log(`frame ${f}: an IK target is out of reach`)
    const up = upscale(cv.rgba, W, H, K)
    const ox = (n % COLS) * cell + 2, oy = Math.floor(n / COLS) * (H * K + 4) + 2
    for (let y = 0; y < H * K; y++)
      for (let x = 0; x < W * K; x++) {
        const s = (y * W * K + x) * 4
        if (!up[s + 3]) continue
        const d = ((oy + y) * sheet.w + ox + x) * 4
        sheet.rgba[d] = up[s]; sheet.rgba[d + 1] = up[s + 1]; sheet.rgba[d + 2] = up[s + 2]; sheet.rgba[d + 3] = 255
      }
  })
  if (out) writeFileSync(out, encodePNG(sheet.rgba, sheet.w, sheet.h))
  console.log(`${frames.length} frames${out ? ` → ${out}` : ''}`)
}
