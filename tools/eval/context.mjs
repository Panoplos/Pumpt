// Scores context policies for the difficulty readout on real prompts: how
// well each policy's verdicts match hand labels (MAE, exact, within one level,
// Spearman ρ) and the effort proxies, and what each costs per decision.
//
// Usage: node tools/eval/context.mjs prompts.json labels.json
//   prompts.json from tools/eval/extract.py; labels.json maps "<session>#<index>" to 1-7.
//   PUMPT_LLM_URL / PUMPT_LLM_MODEL as for tools/ask.mjs.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { estimateWith, resolveModel } from '../../hooks/estimate.js'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
const url = process.env.PUMPT_LLM_URL || manifest.userConfig.llm_url.default
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const labels = JSON.parse(readFileSync(process.argv[3], 'utf8'))

const post = async (u, body) => {
  const res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, status: res.status, text: await res.text() }
}
const get = async (u) => ({ ...(await fetch(u).then(async (r) => ({ ok: r.ok, status: r.status, text: await r.text() }))) })
const model = await resolveModel(get, url, process.env.PUMPT_LLM_MODEL || manifest.userConfig.llm_model.default)

const said = (ms) => ms.filter((m) => m.text && m.text.trim())
const line = (m, n) => `${m.role}: ${m.text.trim().replace(/\s+/g, ' ').slice(0, n)}`
const lastOf = (ms, role, n = 1) => said(ms).filter((m) => m.role === role).slice(-n)
const exchange = (ms, n) => [...lastOf(ms, 'user'), ...lastOf(ms, 'assistant')].map((m) => line(m, n)).join('\n')

// What the mod would send from the messages before the prompt.
const POLICIES = {
  'none': () => '',
  'raw last 2 messages × 300': (ms) => ms.slice(-2).map((m) => line(m, 300)).join('\n'),
  'last spoken exchange × 300 (the mod)': (ms) => exchange(ms, 300),
  'last spoken exchange × 600': (ms) => exchange(ms, 600),
  'last 2 exchanges × 300': (ms) => said(ms).slice(-4).map((m) => line(m, 300)).join('\n'),
  'opening prompt + last exchange × 300': (ms) => [lastOf(ms, 'user', 99)[0], ...lastOf(ms, 'user'), ...lastOf(ms, 'assistant')].filter((m, i, a) => m && a.indexOf(m) === i).map((m) => line(m, 300)).join('\n'),
}

const spearman = (a, b) => {
  const rank = (xs) => {
    const sorted = xs.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(xs.length)
    for (let i = 0; i < sorted.length; ) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++
      for (let k = i; k <= j; k++) r[sorted[k][1]] = (i + j) / 2 + 1
      i = j + 1
    }
    return r
  }
  const ra = rank(a), rb = rank(b), n = a.length
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) (num += (ra[i] - ma) * (rb[i] - mb)), (da += (ra[i] - ma) ** 2), (db += (rb[i] - mb) ** 2)
  return num / Math.sqrt(da * db || 1)
}

const key = (r) => `${r.session}#${r.index}`
const results = {}
for (const [name, policy] of Object.entries(POLICIES)) {
  results[name] = []
  for (const r of rows) {
    const t0 = performance.now()
    const v = await estimateWith(post, url, model, r.text, policy(r.before))
    results[name].push({ ...v, ms: Math.round(performance.now() - t0), expected: v.probabilities.reduce((s, p, i) => s + p * (i + 1), 0) })
  }
}

const labelled = rows.map((r, i) => [r, i]).filter(([r]) => labels[key(r)] != null)
console.log(`${model} @ ${url}\n${rows.length} prompts, ${labelled.length} labelled\n`)
console.log('policy'.padEnd(40), ' MAE', 'exact', 'within 1', 'ρ label', 'ρ seconds', 'ρ tools', 'median ms')
for (const [name, out] of Object.entries(results)) {
  const lab = labelled.map(([r]) => labels[key(r)]), got = labelled.map(([, i]) => out[i].difficulty), exp = labelled.map(([, i]) => out[i].expected)
  const mae = got.reduce((s, g, i) => s + Math.abs(g - lab[i]), 0) / (got.length || 1)
  const pct = (f) => ((got.filter(f).length / (got.length || 1)) * 100).toFixed(0).padStart(4) + '%'
  const allExp = out.map((o) => o.expected)
  const ms = out.map((o) => o.ms).sort((a, b) => a - b)[Math.floor(out.length / 2)]
  console.log(name.padEnd(40), mae.toFixed(2), pct((g, i) => g === lab[i]), pct((g, i) => Math.abs(g - lab[i]) <= 1).padStart(8), spearman(exp, lab).toFixed(2).padStart(7), spearman(allExp, rows.map((r) => Math.log1p(r.effort.seconds))).toFixed(2).padStart(9), spearman(allExp, rows.map((r) => r.effort.toolUses)).toFixed(2).padStart(7), String(ms).padStart(9))
}
console.log('\nper prompt (verdict and confidence per policy, in the order above):')
rows.forEach((r, i) => console.log(`${key(r).padEnd(13)} ${Object.values(results).map((out) => `${out[i].difficulty}(${Math.round(out[i].confidence * 100)})`.padStart(6)).join(' ')}  label ${labels[key(r)] ?? '-'}  ${r.effort.seconds}s/${r.effort.toolUses} tools  ${JSON.stringify(r.text.slice(0, 50))}`))
