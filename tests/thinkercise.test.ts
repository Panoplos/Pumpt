import { expect, mock, test } from 'claude-code/testing'

// The band above the prompt, as the terminal raises it: 115 body columns
// (120 less the engine's five), 20 rows to draw in.
const BAND = {
  plugin: 'thinkercise',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  viewport: { columns: 120, rows: 50 },
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 115,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

// A chat-completions reply with all the answer slot's mass on one option letter
const verdict = (difficulty: number) => {
  const token = 'ABCDEFG'[difficulty - 1]
  return {
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({ choices: [{ message: { content: token }, logprobs: { content: [{ token, logprob: 0, top_logprobs: [{ token, logprob: 0 }] }] } }] }),
    },
  }
}

const TURN_DONE = { answer: '', reason: 'answer', durationMs: 1200, isAborted: false, turnId: 'turn-1' } as const

// The stubs every test shares; `env` answers $.env.get by name.
function setup(
  on,
  {
    env = {},
    fetch = () => verdict(4),
    blit = () => ({ value: {} }),
  }: { env?: Record<string, string>; fetch?: (...args: any[]) => any; blit?: (...args: any[]) => any } = {},
) {
  const clock = mock.clock(on)
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('session.start', () => ({ cwd: '/tmp' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.messages', () => ({ value: [] }))
  // beneath the plugin, the band is empty: what the engine draws when the mod passes
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ children: [] }))
  // GET /v1/models answers what the server loaded; everything else is the estimate
  on('http.fetch', ($, e) =>
    e.init?.method === 'GET' ? { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ data: [{ id: 'torchcast-decision-12b' }] }) } } : fetch($, e),
  )
  const blits: any[] = []
  on('ui.blit', ($, e) => {
    blits.push(e)
    return blit(e)
  })
  return { clock, blits }
}

test('a prompt puts Pixi in the band, in true-pixel frames, and the verdict lands in the status line', async ($, on) => {
  setup(on)
  await $.session.start({ cwd: '/tmp' })

  // Nothing in the band before a prompt
  const idle = await $.ui.mount(BAND)
  expect(await idle.find({ type: 'Image' })).toBeUndefined()
  expect(await idle.find({ type: 'Text', text: /Pixi/ })).toBeUndefined()
  await idle.unmount()

  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(BAND)
  // The sprite takes the 14 rows asked for (less than the band's 19), twice as many columns
  const img = await ui.find({ type: 'Image' })
  expect(img).toBeDefined()
  expect(img?.props.source?.format).toBe('png')
  expect(img?.props.source?.file).toMatch(/\/assets\/frames\/sit-ups\/f0\.png$/)
  expect(img?.props.columns).toBe(28)
  expect(img?.props.rows).toBe(14)
  // Difficulty 4 is sit-ups, with the model's minute estimate
  expect(await ui.find({ type: 'Text', text: /sit-ups · difficulty 4\/7 \(100%\) · ~40 min/ })).toBeDefined()
  await ui.unmount()

  // Ending the turn clears the band
  await $.turn.complete(TURN_DONE)
  const after = await $.ui.mount(BAND)
  expect(await after.find({ type: 'Image' })).toBeUndefined()
  await after.unmount()
})

test('the sprite never outgrows the band', async ($, on) => {
  setup(on)
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  // a short band: 9 rows, one of them the status line
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 9, scroll: { offset: 0, bodyRows: 8 } } })
  const img = await ui.find({ type: 'Image' })
  expect(img?.props.rows).toBe(8)
  expect(img?.props.columns).toBe(16)
  await ui.unmount()
})

test('the clock repaints the sprite in place, frame by frame', async ($, on) => {
  const { clock, blits } = setup(on)
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(BAND)
  await clock.advance(84)
  await clock.advance(84)
  expect(blits.length).toBe(2)
  expect(blits[0].requestId).toBe('above-prompt')
  expect(blits[0].key).toBe('pixi')
  expect(blits[0].source?.file).toMatch(/\/assets\/frames\/sit-ups\/f1\.png$/)
  expect(blits[1].source?.file).toMatch(/\/assets\/frames\/sit-ups\/f2\.png$/)
  await ui.unmount()
  await $.turn.complete(TURN_DONE)
  // a finished turn stops the repaints
  await clock.advance(84)
  expect(blits.length).toBe(2)
})

test('a subagent finishing its turn does not end the workout', async ($, on) => {
  const { clock, blits } = setup(on)
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(BAND)
  await $.turn.complete({ ...TURN_DONE, agentId: 'agent-1' })
  await clock.advance(84)
  expect(blits.length).toBe(1)
  await ui.unmount()
})

test('a survey holding the band gets it', async ($, on) => {
  const { clock, blits } = setup(on)
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await clock.advance(84)
  expect(blits.length).toBe(0)
  await ui.unmount()
})

test('a terminal that cannot show images gets cells instead, after a second of trying', async ($, on) => {
  const { clock, blits } = setup(on, { blit: () => ({ value: { deny: 'the Image draws its alt there: no images on this terminal' } }) })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  // a few refusals are the terminal still putting the picture up: the PNG stays
  for (let i = 0; i < 6; i++) await clock.advance(84)
  await ui.unmount()
  const still = await $.ui.mount(BAND)
  expect(await still.find({ type: 'Image' })).toBeDefined()
  await still.unmount()
  // a second of them is not
  for (let i = 0; i < 8; i++) await clock.advance(84)
  expect(blits.length).toBe(12)
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Image' })).toBeUndefined()
  expect(await again.find({ type: 'Raster' })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /· cells$/ })).toBeDefined()
  await again.unmount()
  // the next prompt gives the PNGs another chance: the refusal may have been a passing one
  await $.turn.complete(TURN_DONE)
  await $.prompt.submit({ cwd: '/tmp', text: 'and now the tests' })
  const next = await $.ui.mount(BAND)
  expect(await next.find({ type: 'Image' })).toBeDefined()
  await next.unmount()
})

test('a refusal about the site, not the picture, keeps the image renderer', async ($, on) => {
  const { clock, blits } = setup(on, { blit: () => ({ value: { deny: 'not mounted' } }) })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(BAND)
  for (let i = 0; i < 20; i++) await clock.advance(84)
  await ui.unmount()
  // one refused blit, then a second a second later: the sprite is re-mounted once a second, not every frame
  expect(blits.length).toBe(2)
  const again = await $.ui.mount(BAND)
  expect(await again.find({ type: 'Image' })).toBeDefined()
  await again.unmount()
})

test('the hardest verdict gets burpees', async ($, on) => {
  setup(on, { fetch: () => verdict(7) })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'port the whole backend to a new framework' })
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Image' }))?.props.source?.file).toMatch(/\/assets\/frames\/burpees\/f0\.png$/)
  expect(await ui.find({ type: 'Text', text: /burpees · difficulty 7\/7 \(100%\) · ~480 min/ })).toBeDefined()
  await ui.unmount()
})

test('THINKERCISE_RENDERER=raster draws half-block cells', async ($, on) => {
  setup(on, { env: { THINKERCISE_RENDERER: 'raster' } })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'fix the typo in the readme' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  const raster = await ui.find({ type: 'Raster' })
  expect(raster).toBeDefined()
  expect(raster?.props.columns).toBe(28)
  expect(raster?.props.rows).toBe(14)
  // cells are [codePoint, fg, bg] u32 triplets; the sprite is half blocks on the terminal's own background
  const words = new Uint32Array(Uint8Array.fromBase64(raster?.props.cells ?? '').buffer)
  expect(words.length).toBe(28 * 14 * 3)
  let blocks = 0, clear = 0
  for (let i = 0; i < words.length; i += 3) {
    if (words[i] === 0x2580 || words[i] === 0x2584) blocks++
    if (words[i + 2] === 0x01000000) clear++
  }
  expect(blocks).toBeGreaterThan(50)
  expect(clear).toBeGreaterThan(50)
  await ui.unmount()
})

test('the model being down leaves the guess in place', async ($, on) => {
  setup(on, {
    fetch: () => {
      throw new Error('connection refused')
    },
  })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'rename this variable' })
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /neck rolls · difficulty ~1\/7/ })).toBeDefined()
  await ui.unmount()
})

test('a stale verdict never overwrites a newer prompt', async ($, on) => {
  let answerFirst: (v: any) => void = () => {}
  setup(on, {
    // the migration prompt's verdict is held back; the warm-up and the comment prompt answer at once
    fetch: ($, e) => (JSON.parse(e.init.body).messages[1].content.includes('migrate every service') ? new Promise((resolve) => (answerFirst = resolve)) : verdict(2)),
  })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'migrate every service to the new auth layer and rewrite the tests' })
  await $.prompt.submit({ cwd: '/tmp', text: 'add a comment' })
  // the first prompt's verdict arrives late, after the second was already rated
  answerFirst(verdict(7))
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Image' }))?.props.source?.file).toMatch(/\/assets\/frames\/arm-circles\/f0\.png$/)
  expect(await ui.find({ type: 'Text', text: /arm circles · difficulty 2\/7/ })).toBeDefined()
  await ui.unmount()
})

test('a finished turn is recorded next to its decision', async ($, on) => {
  const writes: { path: string; record: any }[] = []
  setup(on, { env: { HOME: '/home/pixi' } })
  on('fs.write', ($, e) => {
    writes.push({ path: e.path, record: JSON.parse(e.text) })
    return { value: undefined }
  })
  on('tool.call', () => ({ value: {} }))
  await $.session.start({ cwd: '/tmp/repo' })
  await $.prompt.submit({ cwd: '/tmp/repo', text: 'refactor the auth module across three services' })
  await $.turn.complete({ ...TURN_DONE, durationMs: 83400, usage: { input_tokens: 1200, output_tokens: 9000 } })
  expect(writes.length).toBe(1)
  expect(writes[0].path).toMatch(/^\/home\/pixi\/\.thinkercise\/decisions\/\d{4}-\d{2}-\d{2}T.*\.json$/)
  const r = writes[0].record
  expect(r.prompt).toBe('refactor the auth module across three services')
  expect(r.verdict?.difficulty).toBe(4)
  expect(r.actual).toEqual({ seconds: 83.4, reason: 'answer', toolCalls: 0, inputTokens: 1200, outputTokens: 9000 })
})

test('session start warms the model up, without conversation context', async ($, on) => {
  const bodies: any[] = []
  setup(on, {
    fetch: ($, e) => {
      bodies.push(JSON.parse(e.init.body))
      return verdict(1)
    },
  })
  await $.session.start({ cwd: '/tmp' })
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(bodies.length).toBe(1)
  expect(bodies[0].max_tokens).toBe(1)
  expect(bodies[0].logprobs).toBe(true)
  expect(bodies[0].messages[1].content).toMatch(/^New task:\nwarm up/)
})

test('a /v1/systemone URL asks the shim a score question', async ($, on) => {
  const bodies: any[] = []
  setup(on, {
    env: { THINKERCISE_LLM_URL: 'http://gpu-box:8011/v1/systemone' },
    fetch: ($, e) => {
      expect(e.url).toBe('http://gpu-box:8011/v1/systemone')
      bodies.push(JSON.parse(e.init.body))
      return {
        value: {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({ model: 'torchcast-decision-12b', answers: { decision: { type: 'score', choice: '5', probabilities: { '0': 0, '1': 0, '2': 0.05, '3': 0.1, '4': 0.15, '5': 0.6, '6': 0.1 } } } }),
        },
      }
    },
  })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'migrate the monolith to services' })
  // the warm-up and the prompt both go to the shim as score questions
  expect(bodies.length).toBe(2)
  expect(bodies.every((b) => b.questions.decision.type === 'score' && b.questions.decision.criteria.length === 7)).toBe(true)
  expect(bodies[0].state).toMatch(/^New task:\nwarm up/)
  expect(bodies[1].state).toMatch(/New task:\nmigrate the monolith/)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Image' }))?.props.source?.file).toMatch(/\/assets\/frames\/push-ups\/f0\.png$/)
  // the expected minutes over the distribution: .05*15+.1*40+.15*90+.6*240+.1*480 = 210
  expect(await ui.find({ type: 'Text', text: /push-ups · difficulty 6\/7 \(60%\) · ~210 min/ })).toBeDefined()
  await ui.unmount()
})
