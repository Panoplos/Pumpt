// thinkercise — Pixi works out while Claude works.
//
// prompt.submit → ask the local model how hard the task is → draw Pixi doing
// the matching exercise in the band above the prompt → turn.complete clears it.
//
// The band is drawn straight over the terminal's own background, no frame and
// no dock: the sprite's transparent pixels show whatever is behind them.
//
// Every frame comes from hooks/pixi.js. Terminals that draw pictures get the
// pre-rendered PNGs under assets/frames (true pixels, read by the terminal
// itself); the rest get the same drawing rendered live into half-block cells.
import { FPS, byDifficulty, framePath, halfBlocks, renderFrame } from './pixi.js'
import { contextOf, estimateWith, resolveModel } from './estimate.js'

const KEY = 'pixi'
const FRAME_MS = Math.round(1000 / FPS)
const WARM_UP = 'warm up: fix the typo in the readme'
const LOG_KEEP = { exchanges: 2, chars: 1000 } // recent messages kept with a logged decision, for re-rendering other context policies

let llmUrl = ''
let llmModel = ''
let renderer = 'auto' // 'auto' | 'image' | 'raster' (THINKERCISE_RENDERER)
let imageDenied = false // the PNG frames stayed refused for a second: cells for the rest of this workout (the next prompt tries them again)
let imageDenies = 0 // refusals of the picture in a row: the first ones are the terminal still putting it up
let workout = null // { ex, frame, startedAt, seq, pending, result, guess }
let mounted = null // what the last render drew: { requestId, kind, columns, rows }
let remountIn = 0 // ticks until a refused blit's site is drawn again (a second, not every frame)
let seq = 0 // prompts seen; a stale estimate must not overwrite a newer one
let logDir = '' // where decisions and their outcomes are recorded ('' = off)
let turnLog = null // the turn being recorded: { ts, cwd, prompt, messages, guess, verdict, latencyMs, toolCalls }
let cwd = ''

// Until the model answers: length, nudged by what the prompt asks for.
function guessDifficulty(text) {
  const n = text.trim().length
  let d = n < 40 ? 1 : n < 120 ? 2 : n < 300 ? 3 : n < 700 ? 4 : 5
  if (/\b(refactor|migrat|rewrite|redesign|architect|implement|build|integrat)/i.test(text)) d += 1
  if (/\b(typo|rename|quick|small|minor|just)\b/i.test(text)) d -= 1
  return Math.min(7, Math.max(1, d))
}

// The recent conversation, as $.session.messages() gives it; [] when unreadable.
async function recentMessages($) {
  try {
    return await $.session.messages()
  } catch {
    return []
  }
}

async function estimate($, text, messages = []) {
  // Context is the last spoken exchange (hooks/config.js says how much): the
  // person's previous prompt and the answer it got. Kept short: every prompt
  // token costs about a millisecond of prefill.
  const post = (url, body) => $.http.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return estimateWith(post, llmUrl, llmModel, text, contextOf(messages))
}

// Records a finished turn next to its decision, one file per turn, so the
// estimator can be scored and tuned on what prompts really cost (tools/eval).
async function recordTurn($, e) {
  const t = turnLog
  turnLog = null
  if (!logDir || !t) return
  const record = {
    version: 1,
    ts: t.ts,
    cwd: t.cwd,
    prompt: t.prompt,
    messages: t.messages,
    guess: t.guess,
    verdict: t.verdict,
    latencyMs: t.latencyMs,
    model: llmModel,
    url: llmUrl,
    actual: {
      seconds: Math.round((e.durationMs ?? 0) / 100) / 10,
      reason: e.reason,
      toolCalls: t.toolCalls,
      inputTokens: e.usage?.input_tokens ?? e.usage?.inputTokens ?? null,
      outputTokens: e.usage?.output_tokens ?? e.usage?.outputTokens ?? null,
    },
  }
  try {
    await $.fs.write(`${logDir}/${t.ts.replace(/[:.]/g, '-')}.json`, JSON.stringify(record))
  } catch (err) {
    $.ui.log(`thinkercise: could not record the turn (${err?.message ?? err})`, { to: 'debug' })
  }
}

function statusLine(kind) {
  const w = workout
  const seconds = Math.max(0, (Date.now() - w.startedAt) / 1000)
  const reps = Math.floor(seconds / w.ex.seconds)
  const clock = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  const verdict = w.pending
    ? 'sizing up the task…'
    : w.result
      ? `difficulty ${w.result.difficulty}/7 (${Math.round(w.result.confidence * 100)}%) · ~${w.result.minutes} min`
      : `difficulty ~${w.guess}/7`
  // `cells` flags the half-block fallback: the terminal refused the PNG frames
  return `Pixi · ${w.ex.name} · ${verdict} · ${reps} reps · ${clock}${kind === 'raster' ? ' · cells' : ''}`
}

const DEFAULT = 0x01000000 // the terminal's own color
function rasterCells(ex, frame, columns, rows) {
  const cells = halfBlocks(renderFrame(ex, frame).canvas, columns, rows)
  const words = new Uint32Array(columns * rows * 3)
  cells.forEach(([ch, fg, bg], i) => words.set([ch, fg < 0 ? DEFAULT : fg, bg < 0 ? DEFAULT : bg], i * 3))
  return new Uint8Array(words.buffer).toBase64()
}

const useImage = () => renderer === 'image' || (renderer === 'auto' && !imageDenied)

// A refusal that is about the picture itself, not about the site: the band
// collapsed or a survey holding it say nothing about what the terminal can draw.
const cannotDrawImages = (deny) => /\balt\b|placeholder|cannot read|no image/i.test(deny)

export function register(on, options) {
  llmUrl = options.llm_url
  llmModel = options.llm_model

  on('session.start', async ($, e, next) => {
    cwd = e.cwd ?? ''
    llmUrl = (await $.env.get('THINKERCISE_LLM_URL')) || llmUrl
    llmModel = (await $.env.get('THINKERCISE_LLM_MODEL')) || llmModel
    const r = (await $.env.get('THINKERCISE_RENDERER')) || 'auto'
    renderer = r === 'image' || r === 'raster' ? r : 'auto'
    const home = (await $.env.get('HOME')) || ''
    const logEnv = await $.env.get('THINKERCISE_LOG_DIR')
    logDir = options.log_decisions === false || logEnv === 'off' ? '' : logEnv || (home ? `${home}/.thinkercise/decisions` : '')
    // Ask the server what it serves, so the model name matches whatever it loaded.
    resolveModel((url) => $.http.fetch(url, { method: 'GET' }), llmUrl, llmModel).then((name) => {
      if (name !== llmModel) $.ui.log(`thinkercise: the server at ${llmUrl} serves ${name}; using that instead of ${llmModel}`, { to: 'debug' })
      llmModel = name
      // Warm the server up: its first decision compiles kernels and takes
      // seconds, and the system prompt's prefix then sits in its cache.
      estimate($, WARM_UP).catch(() => {})
    })

    // The animation: the mounted sprite is repainted in place at the frame
    // rate; the status line (reps, clock) redraws once a second.
    $.clock.every(FRAME_MS, async () => {
      if (!workout) return
      if (!mounted) {
        if (remountIn > 0 && --remountIn === 0) $.ui.invalidate('ui.render')
        return
      }
      workout.frame = (workout.frame + 1) % workout.ex.frames
      const { ex, frame } = workout
      const { requestId, kind, columns, rows } = mounted
      const res =
        kind === 'image'
          ? await $.ui.blit({ requestId, key: KEY, source: { file: `${$.plugin.root}/${framePath(ex, frame)}`, format: 'png' } })
          : await $.ui.blit({ requestId, key: KEY, cells: rasterCells(ex, frame, columns, rows) })
      if (res?.deny) {
        if (kind === 'image' && cannotDrawImages(res.deny)) {
          // The picture is not up yet: right after a render the terminal is
          // still placing it, and the blit lands at the next frame. Only a
          // second of this means it never will.
          if (++imageDenies < FPS) return
          imageDenied = true
          $.ui.log(`thinkercise: this terminal cannot show the PNG frames (${res.deny}); drawing cells instead`, { to: 'debug' })
          mounted = null
          remountIn = 1
          return
        }
        // The site itself refused (the band collapsed, a survey holding it):
        // stop blitting, and try drawing again in a second.
        mounted = null
        remountIn = FPS
      } else {
        imageDenies = 0
        if (frame % FPS === 0) $.ui.invalidate('ui.render')
      }
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const mine = ++seq
    const guess = guessDifficulty(e.text)
    imageDenied = false
    imageDenies = 0
    workout = { ex: byDifficulty(guess), frame: 0, startedAt: Date.now(), seq: mine, pending: true, result: null, guess }
    const messages = await recentMessages($)
    const kept = messages.filter((m) => m?.text?.trim() && (m.role === 'user' || m.role === 'assistant'))
    turnLog = {
      ts: new Date().toISOString(),
      cwd,
      prompt: e.text,
      messages: kept.slice(-2 * LOG_KEEP.exchanges).map((m) => ({ role: m.role, text: m.text.trim().slice(0, LOG_KEEP.chars) })),
      guess,
      verdict: null,
      latencyMs: null,
      toolCalls: 0,
    }
    const asked = Date.now()
    // Fire and forget: the hook must not wait on the model.
    estimate($, e.text, messages)
      .then((result) => {
        if (turnLog?.ts && workout?.seq === mine) Object.assign(turnLog, { verdict: result, latencyMs: Date.now() - asked })
        if (workout?.seq !== mine) return // a newer prompt took over
        workout.result = result
        const ex = byDifficulty(result.difficulty)
        if (ex !== workout.ex) Object.assign(workout, { ex, frame: 0, startedAt: Date.now() })
      })
      .catch((err) => {
        if (workout?.seq !== mine) return
        $.ui.log(`thinkercise: no verdict from ${llmModel} at ${llmUrl} (${err?.message ?? err}); keeping the guess`, { to: 'debug' })
      })
      .finally(() => {
        if (workout?.seq !== mine) return
        workout.pending = false
        $.ui.invalidate('ui.render')
      })

    // Pixi steps into the band above the prompt.
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Tool calls of the main turn, one of the measures of what a prompt cost.
  on('tool.call', async ($, e, next) => {
    if (turnLog && !e.agentId) turnLog.toolCalls++
    return next(e)
  })

  // The main turn is done: Pixi leaves the band. A subagent's turn ending
  // mid-task is not the end of the workout.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    if (workout) {
      workout = null
      mounted = null
      $.ui.invalidate('ui.render')
    }
    await recordTurn($, e)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is one shared instance: with nothing to show, or a survey
    // holding it, pass it on untouched.
    if (!workout || e.props.hasSurvey) {
      mounted = null
      if (workout) remountIn = FPS // come back in a second, in case the band is not redrawn on its own
      return next(e)
    }
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text, Raster, Image } = $.ui.resolve(e)
    const w = workout
    // A square box for the sprite (square in pixels given the cell's aspect
    // ratio) over one row for the status line, never taller than the band
    // shows whole: a sprite that scrolls is no sprite.
    const bodyColumns = e.props.bodyColumns ?? e.viewport?.columns ?? 40
    const maxRows = e.props.maxRows ?? 20
    const aspect = options.cell_aspect > 0 ? options.cell_aspect : 0.5
    const wanted = Math.round(options.sprite_rows ?? 14)
    const rows = Math.max(2, Math.min(maxRows - 1, wanted, Math.floor(bodyColumns * aspect)))
    const columns = Math.min(bodyColumns, Math.round(rows / aspect))
    const kind = useImage() ? 'image' : 'raster'
    mounted = { requestId: e.requestId, kind, columns, rows }
    const sprite =
      kind === 'image'
        ? Image({ key: KEY, source: { file: `${$.plugin.root}/${framePath(w.ex, w.frame)}`, format: 'png' }, columns, rows, alt: `Pixi doing ${w.ex.name}` })
        : Raster({ key: KEY, columns, rows, cells: rasterCells(w.ex, w.frame, columns, rows) })
    // At the right end, by the prompt, out of the way of what Claude writes.
    return Box({ flexDirection: 'column', alignItems: 'flex-end', children: [sprite, Text({ children: [statusLine(kind)], dimColor: true })] })
  })
}
