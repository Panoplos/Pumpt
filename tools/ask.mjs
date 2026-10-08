// Sends one prompt to the difficulty model exactly as the mod does and shows
// the distribution it read: a quick check that the model is up and the readout
// works, and a way to see how it rates things.
//
// Usage: node tools/ask.mjs "refactor the auth module across three services"
//   PUMPT_LLM_URL / PUMPT_LLM_MODEL override the manifest defaults.
//   A URL ending in /v1/systemone talks to the official shim; any other is an
//   OpenAI-compatible chat endpoint that must return logprobs.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVELS, estimateWith, formatMinutes, isDecisionEndpoint, resolveModel } from '../hooks/estimate.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
const url = process.env.PUMPT_LLM_URL || manifest.userConfig.llm_url.default
const configured = process.env.PUMPT_LLM_MODEL || manifest.userConfig.llm_model.default
const text = process.argv.slice(2).join(' ') || 'fix the typo in the readme'

const post = async (u, body) => {
  const res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, status: res.status, text: await res.text() }
}
const get = async (u) => {
  const res = await fetch(u)
  return { ok: res.ok, status: res.status, text: await res.text() }
}
const model = await resolveModel(get, url, configured)
console.log(`${model} @ ${url} (${isDecisionEndpoint(url) ? 'typed decision via the shim' : 'logprobs readout'})`)
console.log(`prompt: ${text}\n`)
const started = Date.now()
try {
  const v = await estimateWith(post, url, model, text)
  v.probabilities.forEach((p, i) => {
    const bar = '█'.repeat(Math.round(p * 40)).padEnd(40, '·')
    console.log(`${String(i + 1).padStart(2)} ${LEVELS[i].split(':')[0].padEnd(12)} ${bar} ${String(Math.round(p * 100)).padStart(3)}%`)
  })
  console.log(`\nverdict: difficulty ${v.difficulty}/7 (${Math.round(v.confidence * 100)}% sure) · ${formatMinutes(v.minutes)} · ${Date.now() - started} ms`)
} catch (err) {
  const why = err.cause?.code ?? err.cause?.message ?? err.message
  console.log(`no verdict: ${why}`)
  if (/ECONNREFUSED|fetch failed/.test(why)) console.log('nothing is listening there: start the server, or point PUMPT_LLM_URL at it')
  process.exit(1)
}
