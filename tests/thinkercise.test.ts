import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'thinkercise',
  component: 'Pane',
  requestId: 'thinkercise',
  surface: 'terminal',
  viewport: { columns: 120, rows: 50 },
  props: {
    title: 'Pixi',
    isFocused: true,
    bodyColumns: 40,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
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
  // GET /v1/models answers what the server loaded; everything else is the estimate
  on('http.fetch', ($, e) =>
    e.init?.method === 'GET' ? { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ data: [{ id: 'torchcast-decision-12b' }] }) } } : fetch($, e),
  )
  const opened: any[] = []
  const closed: string[] = []
  const blits: any[] = []
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: {} }
  })
  on('ui.blit', ($, e) => {
    blits.push(e)
    return blit(e)
  })
  return { clock, opened, closed, blits }
}

test('a prompt opens the pane, draws true-pixel frames, and the verdict lands in the status line', async ($, on) => {
  const { opened, closed } = setup(on)
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })

  expect(opened.length).toBe(1)
  expect(opened[0].id).toBe('thinkercise')
  expect(opened[0].closeOnEscape).toBe(true)
  expect(opened[0].rows).toBeGreaterThan(0)
  expect(opened[0].columns).toBeGreaterThan(0)

  const ui = await $.ui.mount(PANE)
  // The sprite fills the body: 20 rows less one for the status line, twice as many columns
  const img = await ui.find({ type: 'Image' })
  expect(img).toBeDefined()
  expect(img?.props.source?.format).toBe('png')
  expect(img?.props.source?.file).toMatch(/\/assets\/frames\/sit-ups\/f0\.png$/)
  expect(img?.props.columns).toBe(38)
  expect(img?.props.rows).toBe(19)
  // Difficulty 4 is sit-ups, with the model's minute estimate
  expect(await ui.find({ type: 'Text', text: /sit-ups · difficulty 4\/7 \(100%\) · ~40 min/ })).toBeDefined()
  await ui.unmount()

  // Ending the turn closes the pane
  await $.turn.complete(TURN_DONE)
  expect(closed).toEqual(['thinkercise'])
})

test('the clock repaints the sprite in place, frame by frame', async ($, on) => {
  const { clock, blits } = setup(on)
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(PANE)
  await clock.advance(84)
  await clock.advance(84)
  expect(blits.length).toBe(2)
  expect(blits[0].requestId).toBe('thinkercise')
  expect(blits[0].key).toBe('pixi')
  expect(blits[0].source?.file).toMatch(/\/assets\/frames\/sit-ups\/f1\.png$/)
  expect(blits[1].source?.file).toMatch(/\/assets\/frames\/sit-ups\/f2\.png$/)
  await ui.unmount()
  await $.turn.complete(TURN_DONE)
  // a closed pane stops the repaints
  await clock.advance(84)
  expect(blits.length).toBe(2)
})

test('a terminal that cannot show images gets cells instead', async ($, on) => {
  const { clock } = setup(on, { blit: () => ({ value: { deny: 'the Image draws its alt there: no images on this terminal' } }) })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'refactor the auth module across three services' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await clock.advance(84)
  await ui.unmount()
  const again = await $.ui.mount(PANE)
  expect(await again.find({ type: 'Image' })).toBeUndefined()
  expect(await again.find({ type: 'Raster' })).toBeDefined()
  await again.unmount()
})

test('the hardest verdict gets burpees', async ($, on) => {
  setup(on, { fetch: () => verdict(7) })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'port the whole backend to a new framework' })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Image' }))?.props.source?.file).toMatch(/\/assets\/frames\/burpees\/f0\.png$/)
  expect(await ui.find({ type: 'Text', text: /burpees · difficulty 7\/7 \(100%\) · ~480 min/ })).toBeDefined()
  await ui.unmount()
})

test('THINKERCISE_RENDERER=raster draws half-block cells', async ($, on) => {
  setup(on, { env: { THINKERCISE_RENDERER: 'raster' } })
  await $.session.start({ cwd: '/tmp' })
  await $.prompt.submit({ cwd: '/tmp', text: 'fix the typo in the readme' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  const raster = await ui.find({ type: 'Raster' })
  expect(raster).toBeDefined()
  expect(raster?.props.columns).toBe(38)
  expect(raster?.props.rows).toBe(19)
  // cells are [codePoint, fg, bg] u32 triplets; the sprite is half blocks on the terminal's own background
  const words = new Uint32Array(Uint8Array.fromBase64(raster?.props.cells ?? '').buffer)
  expect(words.length).toBe(38 * 19 * 3)
  let blocks = 0
  for (let i = 0; i < words.length; i += 3) if (words[i] === 0x2580 || words[i] === 0x2584) blocks++
  expect(blocks).toBeGreaterThan(100)
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
  const ui = await $.ui.mount(PANE)
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
  const ui = await $.ui.mount(PANE)
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
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Image' }))?.props.source?.file).toMatch(/\/assets\/frames\/push-ups\/f0\.png$/)
  // the expected minutes over the distribution: .05*15+.1*40+.15*90+.6*240+.1*480 = 210
  expect(await ui.find({ type: 'Text', text: /push-ups · difficulty 6\/7 \(60%\) · ~210 min/ })).toBeDefined()
  await ui.unmount()
})
