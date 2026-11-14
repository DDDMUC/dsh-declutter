// Session-log fixtures for the dsh-declutter tests.
//
// These are REAL session events, not hand-rolled approximations: every fixture
// is pushed through `snapshotSessionEvent` from `@deepseek-ai/dsh-session`,
// which is the runtime's own validator (it checks event data, surface metadata
// and every message-event shape, then deep-freezes the result). If a fixture
// here is not something the runtime would have accepted and persisted, the test
// suite fails before any rule is exercised.
//
// The validator is a platform package and is not a dependency of this plugin,
// so it is resolved opportunistically: a plain `node --test` run inside a
// checkout that has it on the resolution path validates the fixtures, and a run
// without it reports the validation as SKIPPED rather than quietly passing.
// See README "Testing" for how to point the suite at the real package.

const T0 = 1759600000000

const timeAt = (seq) => T0 + seq * 1000

function turnStart(seq, turn) {
  return { seq, type: 'turn/start', time: timeAt(seq), data: { turn } }
}

function turnEnd(seq, turn, reason) {
  return { seq, type: 'turn/end', time: timeAt(seq), data: { turn, reason } }
}

function stepStart(seq, turn, step) {
  return { seq, type: 'step/start', time: timeAt(seq), data: { turn, step } }
}

function stepEnd(seq, turn, step) {
  return { seq, type: 'step/end', time: timeAt(seq), data: { turn, step } }
}

// A real request/header carries `{ header, reason }` and no turn of its own;
// the runtime appends it inside the open turn. `reason` is 'initial' for a
// session's first request and 'resume' for any later one.
function requestHeader(seq, reason) {
  return { seq, type: 'request/header', time: timeAt(seq), data: { header: {}, reason } }
}

// A surface event must carry its marker: the runtime writes surfaceOp 'append'
// for a message that enters the surface at its own log position. Without it the
// real validator rejects the event, which is how this fixture set stays honest.
function userMessage(seq, text) {
  return {
    seq,
    type: 'user/message',
    time: timeAt(seq),
    surfaceOp: 'append',
    data: { id: 'u' + seq, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
  }
}

function assistantMessage(seq, turn, step, text, source) {
  return {
    seq,
    type: 'assistant/message',
    time: timeAt(seq),
    surfaceOp: 'append',
    data: {
      turn,
      step,
      message: {
        id: 'a' + seq,
        role: 'assistant',
        source: source ?? { kind: 'model', provider: 'test-provider', model: 'test-model' },
        content: [{ type: 'text', text }],
      },
    },
  }
}

function attempt(seq, turn, step) {
  return { seq, type: 'assistant/attempt', time: timeAt(seq), data: { turn, step, attempt: 1 } }
}

function retry(seq, turn, step) {
  return {
    seq,
    type: 'llm/retry',
    time: timeAt(seq),
    data: { turn, step, retry: 1, maximum: 3, failure: { message: 'Connection error.', code: 'TRANSPORT' } },
  }
}

function retryStarted(seq, turn, step) {
  return { seq, type: 'llm/retry-started', time: timeAt(seq), data: { turn, step, retry: 1 } }
}

const TRANSPORT = { kind: 'error', error: { message: 'Connection error.', code: 'TRANSPORT' } }
const COMPLETED = { kind: 'completed' }

/** A turn that failed and nothing came after it. */
export const failedOnly = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  requestHeader(2, 'initial'),
  userMessage(3, '解释一下这个报错'),
  attempt(4, 1, 0),
  retry(5, 1, 0),
  retryStarted(6, 1, 0),
  turnEnd(7, 1, TRANSPORT),
]

/** The same turn closed twice: an error, then success. Signal 'sameTurnRecovered'. */
export const sameTurnRecovered = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  requestHeader(2, 'initial'),
  userMessage(3, '解释一下这个报错'),
  turnEnd(4, 1, TRANSPORT),
  requestHeader(5, 'resume'),
  assistantMessage(6, 1, 0, '这是解释。'),
  turnEnd(7, 1, COMPLETED),
]

/** The failure stayed in turn 1; turn 2 resumed and answered. Signal 'resumed'. */
export const resumedNextTurn = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  requestHeader(2, 'initial'),
  userMessage(3, '解释一下这个报错'),
  turnEnd(4, 1, TRANSPORT),
  turnStart(5, 2),
  stepStart(6, 2, 0),
  requestHeader(7, 'resume'),
  assistantMessage(8, 2, 0, '这是解释。'),
  stepEnd(9, 2, 0),
  turnEnd(10, 2, COMPLETED),
]

/** No resume header: the same question was simply asked again and answered. Signal 'reanswered'. */
export const reansweredLater = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  requestHeader(2, 'initial'),
  userMessage(3, '解释一下这个报错'),
  turnEnd(4, 1, TRANSPORT),
  turnStart(5, 2),
  stepStart(6, 2, 0),
  userMessage(7, '解释一下这个报错'),
  assistantMessage(8, 2, 0, '这是解释。'),
  turnEnd(9, 2, COMPLETED),
]

/** A turn that opened, ran and closed with nothing to show. */
export const emptyTurn = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  stepEnd(2, 1, 0),
  turnEnd(3, 1, COMPLETED),
]

/** An empty turn preceded by a real one, so turn numbering is not the only signal. */
export const realThenEmpty = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  userMessage(2, '你好'),
  assistantMessage(3, 1, 0, '你好。'),
  turnEnd(4, 1, COMPLETED),
  turnStart(5, 2),
  stepStart(6, 2, 0),
  stepEnd(7, 2, 0),
  turnEnd(8, 2, COMPLETED),
]

// The carrier dsh-edit-turn appends when it rewrites a prompt: a developer
// message that projects to nothing but carries the provenance. Note its turn —
// it is the ORIGINAL turn, not the synthetic one, which is why the rule has to
// tell carriers and corrections apart.
function carrierMessage(seq, turn, step) {
  return {
    seq,
    type: 'developer/message',
    time: timeAt(seq),
    surfaceOp: 'append',
    data: {
      turn,
      step,
      message: {
        id: 'd' + seq,
        role: 'developer',
        content: [],
        source: { kind: 'plugin:dsh-edit-turn', editedBy: 'dsh-edit-turn' },
      },
    },
  }
}

/** A synthetic turn opened to carry an in-place rewrite of an earlier answer. */
export const editTurnSynthetic = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  requestHeader(2, 'initial'),
  userMessage(3, '你好'),
  assistantMessage(4, 1, 0, '原始回答。'),
  carrierMessage(5, 1, 0),
  turnEnd(6, 1, COMPLETED),
  turnStart(7, 2),
  stepStart(8, 2, 0),
  requestHeader(9, 'resume'),
  assistantMessage(10, 2, 0, '改写后的回答。', {
    kind: 'model',
    provider: 'test-provider',
    model: 'test-model',
    editedBy: 'dsh-edit-turn',
  }),
  stepEnd(11, 2, 0),
  turnEnd(12, 2, COMPLETED),
]

/**
 * Re-base one fixture onto a fresh seq range and turn-number range.
 *
 * A seq offset alone is NOT enough to combine fixtures: turn numbers are what
 * the rules key on, so two fixtures both using turn 1 would be folded into one
 * record and stop testing what they were written to test. Both are shifted here.
 */
function shift(events, seqBase, turnBase) {
  return events.map((event) => {
    const data = { ...event.data }
    if (typeof data.turn === 'number') data.turn += turnBase
    return { ...event, seq: event.seq + seqBase, time: timeAt(event.seq + seqBase), data }
  })
}

/** A turn that failed without ever producing a surface event: R1's story, not R2's. */
export const failedEmpty = [
  turnStart(0, 1),
  stepStart(1, 1, 0),
  requestHeader(2, 'initial'),
  attempt(3, 1, 0),
  retry(4, 1, 0),
  retryStarted(5, 1, 0),
  turnEnd(6, 1, TRANSPORT),
]

/** Everything at once, for the end-to-end self-check. Turn ranges do not overlap. */
export const mixed = [
  ...shift(emptyTurn, 0, 0),
  ...shift(editTurnSynthetic, 100, 10),
  ...shift(sameTurnRecovered, 200, 20),
  ...shift(failedOnly, 300, 30),
  ...shift(resumedNextTurn, 400, 40),
].sort((left, right) => left.seq - right.seq)

export const FIXTURES = {
  failedOnly,
  sameTurnRecovered,
  resumedNextTurn,
  reansweredLater,
  emptyTurn,
  failedEmpty,
  realThenEmpty,
  editTurnSynthetic,
  mixed,
}

// --- the real validator ------------------------------------------------------

let loaded
/**
 * Resolve the platform's own session validator.
 * @returns `{ validate } ` or `{ reason }` when the package is unavailable.
 */
export async function loadValidator() {
  if (loaded !== undefined) return loaded
  try {
    const module = await import('@deepseek-ai/dsh-session')
    if (typeof module.snapshotSessionEvent !== 'function') {
      loaded = { reason: '@deepseek-ai/dsh-session has no snapshotSessionEvent export' }
    } else {
      loaded = { validate: module.snapshotSessionEvent, isSurfaceEvent: module.isSurfaceEvent }
    }
  } catch (error) {
    loaded = { reason: 'cannot resolve @deepseek-ai/dsh-session: ' + String((error && error.message) || error).split('\n')[0] }
  }
  return loaded
}

/**
 * Push every fixture through the real validator.
 * @returns `{ validated: number, skipped: string | null }`
 */
export async function validateFixtures() {
  const validator = await loadValidator()
  if (validator.validate === undefined) return { validated: 0, skipped: validator.reason }
  let count = 0
  for (const [name, events] of Object.entries(FIXTURES)) {
    for (const event of events) {
      try {
        validator.validate(event)
      } catch (error) {
        throw new Error('fixture ' + name + ' seq ' + event.seq + ' is not a legal session event: ' + String((error && error.message) || error))
      }
      count += 1
    }
  }
  return { validated: count, skipped: null }
}

export { T0, timeAt }
