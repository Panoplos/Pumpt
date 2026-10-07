// A stand-in for the difficulty model: an OpenAI-compatible chat endpoint that
// answers the readout request with top_logprobs over the option letters, rating
// by prompt length. For trying the mod and tools/ask.mjs before the real model
// is up.
//
// Usage: node tools/mock-model.mjs [port]      (default 8080)
import { createServer } from 'node:http'

const port = Number(process.argv[2] || 8080)
const LETTERS = 'ABCDEFG'

createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) return send(200, { object: 'list', data: [{ id: 'mock-decision', object: 'model' }] })
    if (req.method !== 'POST' || !req.url.startsWith('/v1/chat/completions')) return send(404, { error: 'not found' })
    let json
    try {
      json = JSON.parse(body)
    } catch {
      return send(400, { error: { message: 'bad json' } })
    }
    const prompt = json.messages?.at(-1)?.content ?? ''
    // the task sits between the "New task:" marker and the blank line before the instructions
    const task = (prompt.split('New task:\n')[1] ?? prompt).split('\n\n')[0]
    // longer tasks are harder; a soft peak so the distribution looks real
    const peak = Math.min(6, Math.floor(task.length / 60))
    const weights = LETTERS.split('').map((_, i) => Math.exp(-Math.abs(i - peak) * 1.2))
    const total = weights.reduce((a, b) => a + b, 0)
    const top = weights.map((w, i) => ({ token: LETTERS[i], logprob: Math.log(w / total) })).sort((a, b) => b.logprob - a.logprob)
    console.log(`rated ${JSON.stringify(task.slice(0, 50))}… → ${top[0].token}`)
    send(200, {
      id: 'mock',
      object: 'chat.completion',
      model: json.model,
      choices: [{ index: 0, message: { role: 'assistant', content: top[0].token }, logprobs: { content: [{ token: top[0].token, logprob: top[0].logprob, top_logprobs: top }] }, finish_reason: 'length' }],
      usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: 1, total_tokens: Math.ceil(prompt.length / 4) + 1 },
    })
  })
}).listen(port, '127.0.0.1', () => console.log(`mock difficulty model on http://127.0.0.1:${port}/v1/chat/completions`))
