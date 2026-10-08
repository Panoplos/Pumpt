// The estimator's tunable knobs. tools/eval/hillclimb.mjs rewrites this file
// when a candidate beats the incumbent on logged outcomes; edit by hand freely.
// The shim's prompt layout (state, instructions, lettered options, answer
// line) is fixed; everything inside the question is tunable.
export default {
  version: 1,
  // the question put to the model
  instructions:
    'Rate how hard this task is for an AI coding agent working in the repository: how much focused work it takes to finish well. ' +
    'A short follow-up ("continue", "same again", "fix that") takes the work it refers to in the recent conversation.',
  // the seven options, difficulty 1..7
  levels: [
    'trivial: a typo, a one-line answer',
    'small: a quick lookup or a tiny edit',
    'routine: a focused change in one place',
    'moderate: a feature touching a few files',
    'substantial: design work across modules',
    'large: a refactor or migration across a codebase',
    'huge: a multi-day build or a deep investigation',
  ],
  // minutes an agent's turn takes per level (geometric: each level about 2.5x
  // the last); the verdict's minutes is the geometric expectation over the
  // distribution, so a little mass on the top levels does not swamp it
  minutes: [0.5, 1, 2, 5, 12, 30, 60],
  // how much recent conversation goes in: the last `exchanges` spoken prompt/answer pairs, `chars` each
  context: { exchanges: 1, chars: 300 },
  // how a level is read off the distribution: 'argmax' (the shim's choice) or 'median'
  decision: 'argmax',
  // readout temperature on the score distribution (the shim's is 1)
  temperature: 1,
}
