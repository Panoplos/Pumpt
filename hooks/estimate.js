// The difficulty question, asked the way torchcast-decision-12b is meant to be
// asked: a typed decision — one forward pass that reads the probability of
// each option letter at the answer slot — not free-form JSON.
//
// Two transports, picked by the URL:
//  - the official shim, `…/v1/systemone`: a `score` question over the seven
//    levels; the shim does the readout on its vLLM.
//  - any OpenAI-compatible chat endpoint that returns logprobs (mlx_lm.server,
//    llama-server, vLLM): the mod renders the shim's own prompt, asks for one
//    token with top_logprobs, and reads the letters itself.
//
// Every function takes the knobs (hooks/config.js) as an optional last
// argument, so tools/eval can score alternatives without touching the file.
// Shared with tools/ask.mjs and tools/eval so a live check runs this code.
import config from './config.js'

export { config }
export const LEVELS = config.levels
export const MINUTES = config.minutes
export const INSTRUCTIONS = config.instructions
// The shim's scaffolding (torchcast_shim.py), kept verbatim: without it the model answers in prose.
export const SYSTEM =
  'You are a calibration engine. You never answer in prose. You are given a state, a question and ' +
  'a numbered set of options, and you choose exactly one option. You reply with that option\'s ' +
  'LETTER and nothing else — a single character, no words, no punctuation, no explanation.'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export const isDecisionEndpoint = (url) => /\/v1\/systemone\b/.test(url)

/**
 * The recent conversation to send: the last `exchanges` spoken prompt/answer
 * pairs, `chars` each. Messages come as `$.session.messages()` gives them;
 * tool results are user messages with no text and are skipped.
 */
export function contextOf(messages, cfg = config) {
  const said = messages.filter((m) => m?.text?.trim() && (m.role === 'user' || m.role === 'assistant'))
  const n = cfg.context?.exchanges ?? 1
  const users = said.filter((m) => m.role === 'user').slice(-n)
  const assistants = said.filter((m) => m.role === 'assistant').slice(-n)
  return [...users, ...assistants].map((m) => `${m.role}: ${m.text.trim().replace(/\s+/g, ' ').slice(0, cfg.context?.chars ?? 300)}`).join('\n')
}

/** The decision's state: the prompt, after a little recent conversation. */
export const stateOf = (text, context = '') => (context ? `Recent conversation:\n${context}\n\n` : '') + `New task:\n${text.slice(0, 4000)}`

/** The body for POST /v1/systemone: a score question over the levels. */
export function decisionRequest(text, context = '', cfg = config) {
  return { state: stateOf(text, context), questions: { decision: { type: 'score', instructions: cfg.instructions, criteria: cfg.levels } } }
}

/** The shim's prompt rendering (build_prompt), for a chat endpoint with logprobs. */
export function renderPrompt(state, cfg = config) {
  const lines = [state.trimEnd(), '', cfg.instructions, '', 'Options:']
  cfg.levels.forEach((desc, i) => lines.push(`${LETTERS[i]}. ${desc}`))
  lines.push('', 'Answer with the letter of exactly one option, and nothing else:')
  return lines.join('\n')
}

/** The chat-completions body for the readout: one token, its top logprobs. */
export function readoutRequest(model, text, context = '', cfg = config) {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: renderPrompt(stateOf(text, context), cfg) },
    ],
    max_tokens: 1,
    temperature: 1,
    logprobs: true,
    top_logprobs: 11, // mlx_lm.server's cap; plenty for seven letters
    chat_template_kwargs: { enable_thinking: false },
  }
}

const TOKEN_LETTER = /^[\s(\[{'"]*([A-Za-z])[\s.,:)\]}'"]*$/
/**
 * Probability per level from the answer slot's top_logprobs. A letter can
 * surface as several tokens ("A", " A", "A."), so mass is summed per letter.
 */
export function letterProbs(top, n = LEVELS.length) {
  const acc = new Array(n).fill(0)
  let any = false
  for (const { token, logprob } of top) {
    const m = TOKEN_LETTER.exec(token ?? '')
    if (!m) continue
    const i = LETTERS.indexOf(m[1].toUpperCase())
    if (i < 0 || i >= n) continue
    acc[i] += Math.exp(logprob)
    any = true
  }
  if (!any) throw new Error('no option letter at the answer slot')
  const total = acc.reduce((a, b) => a + b, 0)
  return acc.map((p) => p / total)
}

/** The distribution at a readout temperature: p^(1/T), renormalised. */
export function tempered(probabilities, T = 1) {
  if (!T || T === 1) return probabilities
  const z = probabilities.map((p) => Math.max(p, 1e-12) ** (1 / T))
  const s = z.reduce((a, b) => a + b, 0)
  return z.map((v) => v / s)
}

/** A verdict from a distribution over the levels: the level, how sure, the expected minutes. */
export function verdictOf(raw, cfg = config) {
  const probabilities = tempered(raw, cfg.temperature)
  let level = 0
  if (cfg.decision === 'median') {
    let c = 0
    while (level < probabilities.length - 1 && (c += probabilities[level]) < 0.5) level++
  } else probabilities.forEach((p, i) => p > probabilities[level] && (level = i))
  // the geometric expectation: the table spans two orders of magnitude, and an
  // arithmetic mean would let a few percent on the top level dominate
  const minutes = Math.round(100 * Math.exp(probabilities.reduce((sum, p, i) => sum + p * Math.log(cfg.minutes[i]), 0))) / 100
  const expected = probabilities.reduce((sum, p, i) => sum + p * (i + 1), 0)
  return { difficulty: level + 1, confidence: probabilities[level], minutes, expected, probabilities }
}

/** Minutes for people: `~40 s`, `~2.5 min`, `~20 min`. */
export function formatMinutes(minutes) {
  if (minutes < 1) return `~${Math.max(5, Math.round((minutes * 60) / 5) * 5)} s`
  if (minutes < 10) return `~${Math.round(minutes * 10) / 10} min`
  return `~${Math.round(minutes)} min`
}

/** The verdict in a /v1/systemone reply. */
export function parseDecision(json, cfg = config) {
  const d = json?.answers?.decision
  if (!d?.probabilities) throw new Error(json?.error ?? 'no decision in the reply')
  return verdictOf(cfg.levels.map((_, i) => Number(d.probabilities[String(i)]) || 0), cfg)
}

/** The verdict in a chat-completions reply that carries logprobs. */
export function parseReadout(json, cfg = config) {
  const top = json?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs
  if (!Array.isArray(top)) throw new Error(json?.error?.message ?? json?.error ?? 'no top_logprobs at the answer slot: the server must return logprobs')
  return verdictOf(letterProbs(top, cfg.levels.length), cfg)
}

/**
 * The model name to send: the configured one if the server lists it, else
 * the server's first model (mlx_lm.server reports the loaded path and would
 * try to download anything else; llama-server reports the GGUF's name).
 * `get(url) → { ok, text }`; any failure keeps the configured name.
 */
export async function resolveModel(get, url, configured) {
  if (isDecisionEndpoint(url)) return configured
  try {
    const res = await get(url.replace(/\/v1\/.*$/, '/v1/models'))
    const ids = (JSON.parse(res.text || '{}')?.data ?? []).map((m) => m?.id).filter((id) => typeof id === 'string')
    if (!ids.length || ids.includes(configured)) return configured
    return ids[0]
  } catch {
    return configured
  }
}

/** One estimate over `fetch`-like `post(url, body) → { ok, status, text }`. */
export async function estimateWith(post, url, model, text, context = '', cfg = config) {
  const decision = isDecisionEndpoint(url)
  const res = await post(url, decision ? decisionRequest(text, context, cfg) : readoutRequest(model, text, context, cfg))
  let json = {}
  try {
    json = JSON.parse(res.text || '{}')
  } catch {}
  if (!res.ok) throw new Error(`HTTP ${res.status}${json?.error ? `: ${json.error?.message ?? json.error}` : ''}`)
  return decision ? parseDecision(json, cfg) : parseReadout(json, cfg)
}
