// Hill-climbs the estimator's knobs (hooks/config.js) against what prompts
// really cost.
//
// Data: the mod's own records (~/.thinkercise/decisions/*.json: prompt, recent
// messages, verdict, and the turn's measured duration and tool calls) plus,
// optionally, transcript prompts from extract.py with hand labels. The target
// for a logged turn is its duration's level (DURATION_LEVELS); for a labelled
// transcript prompt, the label.
//
// Fitness is the ranked probability score of the level distribution against
// the target (a proper scoring rule for ordinal outcomes: it rewards putting
// mass near the truth and penalises confidence that is not earned, so a
// sharper distribution only wins when it is right), averaged over the rows;
// the readout is deterministic, so it is smooth and repeatable. A candidate
// is accepted when it beats the incumbent by a margin on the whole set and
// on at least three of four folds. Readouts are cached by the rendered
// prompt, so the numeric knobs cost nothing to try; a wording costs one
// readout a row.
//
// Usage: node tools/eval/hillclimb.mjs [--prompts prompts.json --labels labels.json]
//          [--rounds 3] [--mutate N] [--min-rows 50] [--apply]
//   --mutate N    also ask Claude (`claude -p`) for N rewrites of the instructions
//                 and the level descriptions each round, once --min-rows rows exist
//   --apply       write an accepted config to hooks/config.js (else dry run)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as incumbent, contextOf, letterProbs, readoutRequest, resolveModel, stateOf, verdictOf } from '../../hooks/estimate.js'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const flag = (name) => args.includes(name)
const HOME = homedir()
const LOG_DIR = process.env.THINKERCISE_LOG_DIR || join(HOME, '.thinkercise', 'decisions')
const CACHE = join(HOME, '.thinkercise', 'readouts.json')
const LEDGER = join(HOME, '.thinkercise', 'ledger.jsonl')
const DURATION_LEVELS = [1, 3, 8, 20, 45, 120] // minutes; a turn shorter than the first is level 1, longer than the last 7
const MARGIN = 0.01 // in ranked probability score (0 perfect, 1 worst)

const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
const url = process.env.THINKERCISE_LLM_URL || manifest.userConfig.llm_url.default
const http = async (u, body) => {
  const res = await fetch(u, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  return { ok: res.ok, status: res.status, text: await res.text() }
}
const model = await resolveModel((u) => http(u), url, process.env.THINKERCISE_LLM_MODEL || manifest.userConfig.llm_model.default)

// --- data ---------------------------------------------------------------------

const levelOfMinutes = (min) => DURATION_LEVELS.filter((t) => min >= t).length + 1
const rows = []
if (existsSync(LOG_DIR))
  for (const f of readdirSync(LOG_DIR).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(join(LOG_DIR, f), 'utf8'))
    if (r.actual?.reason === 'aborted' || !(r.actual?.seconds > 0)) continue
    rows.push({ key: f, text: r.prompt, messages: r.messages ?? [], target: levelOfMinutes(r.actual.seconds / 60), minutes: r.actual.seconds / 60, source: 'log' })
  }
if (opt('--prompts')) {
  const labels = opt('--labels') ? JSON.parse(readFileSync(opt('--labels'), 'utf8')) : {}
  for (const r of JSON.parse(readFileSync(opt('--prompts'), 'utf8'))) {
    const label = labels[`${r.session}#${r.index}`]
    if (label == null) continue
    rows.push({ key: `${r.session}#${r.index}`, text: r.text, messages: r.before, target: label, minutes: null, source: 'transcript' })
  }
}
if (!rows.length) {
  console.log(`no data: nothing under ${LOG_DIR} and no --prompts/--labels`)
  process.exit(1)
}
console.log(`${model} @ ${url}\n${rows.length} rows (${rows.filter((r) => r.source === 'log').length} logged turns, ${rows.filter((r) => r.source === 'transcript').length} labelled prompts)`)

// --- readouts, cached by the rendered prompt --------------------------------------

mkdirSync(dirname(CACHE), { recursive: true })
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
let calls = 0
async function readout(text, context, cfg) {
  const body = readoutRequest(model, text, context, cfg)
  const key = createHash('sha256').update(model + '\n' + body.messages[1].content).digest('hex')
  if (!cache[key]) {
    const res = await http(url, body)
    const json = JSON.parse(res.text || '{}')
    const top = json?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs
    if (!Array.isArray(top)) throw new Error(`no logprobs: HTTP ${res.status} ${res.text.slice(0, 200)}`)
    cache[key] = letterProbs(top, cfg.levels.length)
    calls++
  }
  return cache[key]
}
const saveCache = () => {
  mkdirSync(dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(cache))
}

// --- fitness ------------------------------------------------------------------------

// The ranked probability score of a distribution over levels 1..n for a target level.
const rps = (probabilities, target) => {
  let cdf = 0, sum = 0
  probabilities.forEach((p, i) => {
    cdf += p
    sum += (cdf - (i + 1 >= target ? 1 : 0)) ** 2
  })
  return sum / (probabilities.length - 1)
}
async function score(cfg, subset = rows) {
  const scores = [], discrete = [], logErr = []
  for (const r of subset) {
    const v = verdictOf(await readout(r.text, contextOf(r.messages, cfg), cfg), cfg)
    scores.push(rps(v.probabilities, r.target))
    discrete.push(Math.abs(v.difficulty - r.target))
    if (r.minutes) logErr.push(Math.abs(Math.log((v.minutes || 1) / Math.max(r.minutes, 0.5))))
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
  return { fitness: mean(scores), mae: mean(discrete), within1: discrete.filter((d) => d <= 1).length / discrete.length, minutesLogErr: mean(logErr) }
}
const folds = (n = 4) => Array.from({ length: n }, (_, k) => rows.filter((_, i) => i % n !== k))
async function beats(candidate, base) {
  const whole = await score(candidate)
  if (!(whole.fitness < base.fitness - MARGIN)) return { ok: false, whole }
  let wins = 0
  for (const fold of folds()) if ((await score(candidate, fold)).fitness < (await score(base.cfg, fold)).fitness) wins++
  return { ok: wins >= 3, whole, wins }
}
const fmt = (s) => `RPS ${s.fitness.toFixed(3)} · MAE ${s.mae.toFixed(2)} · within 1: ${(s.within1 * 100).toFixed(0)}%${Number.isNaN(s.minutesLogErr) ? '' : ` · minutes log-error ${s.minutesLogErr.toFixed(2)}`}`

// --- candidates ------------------------------------------------------------------------

function* numericCandidates(cfg) {
  for (const decision of ['argmax', 'median']) if (decision !== cfg.decision) yield { ...cfg, decision, note: `decision ${decision}` }
  for (const temperature of [0.5, 0.75, 1, 1.5]) if (temperature !== cfg.temperature) yield { ...cfg, temperature, note: `temperature ${temperature}` }
  for (const chars of [150, 300, 600]) if (chars !== cfg.context.chars) yield { ...cfg, context: { ...cfg.context, chars }, note: `context ${chars} chars` }
  for (const exchanges of [1, 2]) if (exchanges !== cfg.context.exchanges) yield { ...cfg, context: { ...cfg.context, exchanges }, note: `context ${exchanges} exchange(s)` }
}

// The minutes per level, refit from logged durations: the median minutes of
// the turns the model put at each level, shrunk toward the current table.
async function refitMinutes(cfg) {
  const logged = rows.filter((r) => r.minutes)
  if (logged.length < 20) return null
  const byLevel = cfg.minutes.map(() => [])
  for (const r of logged) byLevel[verdictOf(await readout(r.text, contextOf(r.messages, cfg), cfg), cfg).difficulty - 1].push(r.minutes)
  const minutes = cfg.minutes.map((m, i) => {
    const xs = byLevel[i].sort((a, b) => a - b)
    if (xs.length < 3) return m
    const med = xs[Math.floor(xs.length / 2)]
    const w = Math.min(1, xs.length / 10)
    return Math.round(Math.exp(w * Math.log(med) + (1 - w) * Math.log(m)))
  })
  return minutes.some((m, i) => m !== cfg.minutes[i]) ? { ...cfg, minutes, note: `minutes ${minutes.join('/')}` } : null
}

// Wording rewrites from Claude, shown the worst-rated rows.
async function mutations(cfg, n) {
  const worst = []
  for (const r of rows) {
    const v = verdictOf(await readout(r.text, contextOf(r.messages, cfg), cfg), cfg)
    worst.push({ r, err: Math.abs(v.expected - r.target), got: v.difficulty })
  }
  worst.sort((a, b) => b.err - a.err)
  const examples = worst.slice(0, 6).map(({ r, got }) => `- prompt ${JSON.stringify(r.text.slice(0, 160))}: rated ${got}, really ${r.target}`).join('\n')
  const ask =
    `A 7-level difficulty question is put to a calibrated decision model about coding prompts. ` +
    `Current instructions:\n${JSON.stringify(cfg.instructions)}\nCurrent level descriptions:\n${JSON.stringify(cfg.levels, null, 1)}\n` +
    `Its worst misses (level 1 trivial … 7 huge; the truth is how long the agent then worked):\n${examples}\n\n` +
    `Propose ${n} alternative versions, each a JSON object {"instructions": string, "levels": [7 strings]} that could fix such misses while staying short and general. ` +
    `Keep the level order and meaning. Reply with ONLY a JSON array of ${n} objects.`
  let out = ''
  try {
    out = execFileSync('claude', ['-p', ask, '--output-format', 'text'], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (err) {
    console.log(`  claude -p failed: ${err.message.split('\n')[0]}`)
    return []
  }
  const m = out.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    return JSON.parse(m[0])
      .filter((v) => typeof v?.instructions === 'string' && Array.isArray(v?.levels) && v.levels.length === cfg.levels.length)
      .map((v, i) => ({ ...cfg, instructions: v.instructions, levels: v.levels, note: `wording #${i + 1}` }))
  } catch {
    return []
  }
}

// --- the climb ---------------------------------------------------------------------------

function writeConfig(cfg) {
  const path = join(ROOT, 'hooks', 'config.js')
  copyFileSync(path, path + '.bak')
  const body = { ...cfg }
  delete body.note
  body.version = (incumbent.version ?? 0) + 1
  writeFileSync(path, `// The estimator's tunable knobs; written by tools/eval/hillclimb.mjs (previous version in config.js.bak).\n// See hooks/config.js.bak or git history for the hand-written comments.\nexport default ${JSON.stringify(body, null, 2)}\n`)
}

let best = { cfg: incumbent, ...(await score(incumbent)) }
console.log(`incumbent: ${fmt(best)}`)
const rounds = Number(opt('--rounds', 3))
const mutate = Number(opt('--mutate', 0))
const minRows = Number(opt('--min-rows', 50))
for (let round = 1; round <= rounds; round++) {
  console.log(`\nround ${round}`)
  const candidates = [...numericCandidates(best.cfg)]
  const refit = await refitMinutes(best.cfg)
  if (refit) candidates.push(refit)
  if (mutate > 0) {
    if (rows.length >= minRows) candidates.push(...(await mutations(best.cfg, mutate)))
    else console.log(`  (wording mutations need ${minRows} rows; ${rows.length} so far)`)
  }
  let improved = false
  for (const cand of candidates) {
    const { ok, whole, wins } = await beats(cand, best)
    const line = `  ${cand.note.padEnd(28)} ${fmt(whole)}${wins != null ? ` · folds ${wins}/4` : ''}`
    appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), rows: rows.length, note: cand.note, ...whole, accepted: ok, cfg: { ...cand, note: undefined } }) + '\n')
    if (ok) {
      best = { cfg: cand, ...whole }
      improved = true
      console.log(`${line}  ← accepted`)
      break
    } else console.log(line)
  }
  saveCache()
  if (!improved) {
    console.log('  no candidate beat the incumbent by the margin')
    break
  }
}
saveCache()
console.log(`\n${calls} readouts, ${Object.keys(cache).length} cached · ledger: ${LEDGER}`)
if (best.cfg !== incumbent) {
  if (flag('--apply')) {
    writeConfig(best.cfg)
    console.log(`applied to hooks/config.js (${best.cfg.note}); run \`claude plugin test\` next`)
  } else console.log(`best: ${best.cfg.note} — rerun with --apply to write hooks/config.js`)
} else console.log('hooks/config.js stays as it is')
