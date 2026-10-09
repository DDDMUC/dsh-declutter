// dsh-declutter - the declarative rule table and its pure judges.
//
// THE ONE INVARIANT THIS MODULE EXISTS TO PROTECT
// -----------------------------------------------
// A rule never writes the session log. Every rule is a *reading* of the
// append-only event stream plus a *view* instruction. The stream is the fact;
// this plugin only puts parts of the derived view away, reversibly. Nothing
// here appends, replaces, or rewrites an event.
//
// THE SHAPE OF A RULE
// -------------------
//   {
//     id       'stale-turn-error'        stable, addressable, retirable
//     title    short human name
//     symptom  what the user sees that made this rule exist
//     judge    (events, options) -> matches[]          host half, pure
//     view     { anchor, scope, guard, action, ... }   view half, serializable
//   }
//
// Adding a rule means adding ONE object to RULES. There is no second place to
// edit: the host iterates RULES to answer /dsh-declutter/state, and the browser
// half *fetches the same table* and executes whatever view descriptors it finds
// there. A rule with no view descriptor is a pure observation and is reported
// as such rather than silently doing nothing.
//
// ISOLATION
// ---------
// runRules() drives every rule through the same try/catch envelope and gives
// each one a fresh accumulator. One rule that throws, or that returns garbage,
// degrades to a single `broken` entry in the self-check and cannot affect any
// other rule, the HTTP layer, or the caller.
//
// SELF-CHECK
// ----------
// The known weak point of every view rule is its selector: DSH styles are
// CSS-module hashes whose prefix changes on every build, so a rule anchors on a
// *local* name fragment (`[class*="_turnErrorRow"]`) and is expected to rot.
// The self-check therefore reports, per rule: how many things matched on the
// log side, when the most recent one happened, and whether the view side could
// still resolve its anchor. `matches: 0` and `anchorOk: false` are both
// first-class output, never hidden, and their combination is the alarm.

/** Plugin id shared by the host half, the browser half and the routes. */
export const PLUGIN_ID = 'dsh-declutter'

/** Version, kept identical to package.json and src/client.js. */
export const VERSION = '0.1.1'

/** View namespace. Every injected attribute/element this plugin owns is prefixed with it. */
export const NS = 'dshdc'

/**
 * Event types that can carry a message into the model-visible surface.
 *
 * Mirrors the official surface contract. Used only to decide whether a turn is
 * `empty` in the sense the user means it ("nothing was ever shown"), which is
 * narrower than "the log has no events" — a failed turn is full of
 * `llm/retry` bookkeeping and still shows the user nothing.
 */
export const SURFACE_EVENT_TYPES = Object.freeze([
  'system/message',
  'user/message',
  'developer/message',
  'assistant/message',
  'tool/result',
])

const SURFACE_TYPE_SET = new Set(SURFACE_EVENT_TYPES)

/** Whether one event can produce a surface node. */
export function isSurfaceEvent(event) {
  return Boolean(event) && SURFACE_TYPE_SET.has(event.type)
}

// --- small shared readers ----------------------------------------------------
// These read the *official* event shapes. They are deliberately tolerant about
// where a field sits (v3 vs v4 canonicalization moved message sources around:
// `{ kind: 'plugin', plugin: X }` became `{ kind: 'plugin:X' }`), because a
// rule that throws on an older log is worse than a rule that finds nothing.

/** The message source of an event, whichever field carries it. */
export function sourceOf(event) {
  const data = event && event.data
  if (!data || typeof data !== 'object') return undefined
  if (data.source && typeof data.source === 'object') return data.source
  const message = data.message
  if (message && typeof message === 'object' && message.source && typeof message.source === 'object') return message.source
  return undefined
}

/** The producer that edited a message in place, when one is recorded. */
export function editedByOf(event) {
  const source = sourceOf(event)
  if (source && typeof source.editedBy === 'string' && source.editedBy !== '') return source.editedBy
  const data = event && event.data
  if (data && typeof data.editedBy === 'string' && data.editedBy !== '') return data.editedBy
  return undefined
}

/** Epoch milliseconds of an event, when it carries a usable timestamp. */
export function timeOf(event) {
  const time = event && event.time
  if (typeof time === 'number' && Number.isFinite(time)) return time
  if (typeof time === 'string') {
    const parsed = Date.parse(time)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/**
 * Flatten one message's text blocks into a comparable string.
 * @param content - the message content block list.
 * @returns normalized text (whitespace-collapsed), or '' when there is none.
 */
export function textOfContent(content) {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** The text of a user/assistant message event, or '' when it has none. */
export function messageTextOf(event) {
  const data = event && event.data
  if (!data || typeof data !== 'object') return ''
  if (Array.isArray(data.content)) return textOfContent(data.content)
  if (data.message && typeof data.message === 'object' && Array.isArray(data.message.content)) {
    return textOfContent(data.message.content)
  }
  return ''
}

/**
 * Stable fingerprint of a prompt, so "the same question was asked again" can be
 * decided without shipping prompt text into the self-check output.
 * FNV-1a over the normalized text; collisions only ever cause an extra collapse,
 * which is why a non-cryptographic hash is acceptable here.
 * @param text - normalized prompt text.
 * @returns `h<hex>` fingerprint, or null for empty text.
 */
export function fingerprint(text) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (normalized === '') return null
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return 'h' + hash.toString(16).padStart(8, '0')
}

// --- the turn index ----------------------------------------------------------

/**
 * Group a contiguous event log into turns.
 *
 * Turn brackets are the durable authority: `turn/start` opens, `turn/end`
 * closes, and every event in between belongs to the open turn unless it names
 * its own turn (assistant and tool events do). A turn can close MORE THAN ONCE —
 * that is the whole mechanism behind R1 — so every close is kept, in order.
 *
 * @param events - complete contiguous raw event log in seq order.
 * @returns Map<turnNumber, TurnRecord>; see {@link emptyTurnRecord}.
 */
export function indexTurns(events) {
  const turns = new Map()
  const turnOfSeq = new Map()
  let open = null

  const ensure = (turn) => {
    let record = turns.get(turn)
    if (record === undefined) {
      record = { ...emptyTurnRecord(), turn }
      turns.set(turn, record)
    }
    return record
  }

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    const declared = typeof data.turn === 'number' ? data.turn : undefined

    if (event.type === 'turn/start') {
      const turn = declared !== undefined ? declared : turns.size
      const record = ensure(turn)
      if (record.startSeq === null) record.startSeq = event.seq
      if (record.startedAt === null) record.startedAt = timeOf(event) ?? null
      open = turn
      turnOfSeq.set(event.seq, turn)
      continue
    }

    if (event.type === 'turn/end') {
      const turn = declared !== undefined ? declared : open
      if (turn !== null && turn !== undefined) {
        const record = ensure(turn)
        const reason = data.reason && typeof data.reason === 'object' ? data.reason : { kind: 'unknown' }
        record.ends.push({
          seq: event.seq,
          time: timeOf(event) ?? null,
          kind: typeof reason.kind === 'string' ? reason.kind : 'unknown',
          message: reason.error && typeof reason.error.message === 'string' ? reason.error.message : null,
          code: reason.error && typeof reason.error.code === 'string' ? reason.error.code : null,
        })
        record.endSeq = event.seq
        record.closedAt = timeOf(event) ?? record.closedAt
        turnOfSeq.set(event.seq, turn)
        if (open === turn) open = null
      }
      continue
    }

    const turn = declared !== undefined ? declared : open
    if (turn === null || turn === undefined) {
      turnOfSeq.set(event.seq, null)
      continue
    }
    turnOfSeq.set(event.seq, turn)
    const record = ensure(turn)
    record.eventCount += 1
    if (record.endSeq !== null && event.seq > record.endSeq) record.endSeq = event.seq
    record.lastSeq = event.seq

    if (isSurfaceEvent(event)) {
      record.surfaceSeqs.push(event.seq)
      if (event.type === 'assistant/message') {
        record.assistantSeqs.push(event.seq)
      }
      if (event.type === 'user/message') {
        const source = sourceOf(event)
        // Only a real human prompt counts; injected context and other plugins'
        // carriers must not be mistaken for "the same question".
        if (source === undefined || source.kind === undefined || source.kind === 'user') {
          const text = messageTextOf(event)
          if (text !== '') {
            record.promptSeq = event.seq
            record.promptFingerprint = fingerprint(text)
            record.promptChars = text.length
          }
        }
      }
    }
    if (event.type === 'llm/retry' || event.type === 'llm/retry-started') record.retries += 1
    if (event.type === 'request/header') {
      const reason = data.reason ?? (data.header && data.header.reason)
      if (reason === 'resume') record.resumeSeqs.push(event.seq)
    }
    const editedBy = editedByOf(event)
    if (editedBy !== undefined) {
      record.editedBy.add(editedBy)
      record.editedSeqs.push(event.seq)
    }
  }

  return { turns, turnOfSeq }
}

/** A blank turn record. Exported so tests and callers can reason about the shape. */
export function emptyTurnRecord() {
  return {
    turn: 0,
    startSeq: null,
    endSeq: null,
    lastSeq: null,
    startedAt: null,
    closedAt: null,
    ends: [],
    eventCount: 0,
    surfaceSeqs: [],
    assistantSeqs: [],
    resumeSeqs: [],
    editedSeqs: [],
    editedBy: new Set(),
    retries: 0,
    promptSeq: null,
    promptFingerprint: null,
    promptChars: 0,
  }
}

/**
 * Whether one event is a `request/header` that continued an existing session.
 *
 * The runtime writes `reason: 'initial'` for a session's first request and
 * `'resume'` for every later one (see dsh-agent-loop buildRequest), so this
 * marks "a second request happened", which is exactly the evidence a failure
 * was followed by another attempt.
 */
export function isResumeHeader(event) {
  if (!event || event.type !== 'request/header') return false
  const data = event.data
  if (!data || typeof data !== 'object') return false
  const reason = data.reason ?? (data.header && data.header.reason)
  return reason === 'resume'
}

/** The last close reason of a turn, or null when it never closed. */
export function lastEndOf(record) {
  return record.ends.length === 0 ? null : record.ends[record.ends.length - 1]
}

/**
 * The turns that are *currently* showing a failure notice.
 *
 * A turn counts as soon as ANY of its closes carried `reason.kind === 'error'`,
 * including a turn that later closed successfully. That is not an oversight, it
 * is the bug this plugin exists for: the chat view's turn-error node latches on
 * the first error close and a later successful close never clears it, so a
 * turn that recovered still shows "this turn failed". Requiring the LAST close
 * to be an error would exclude precisely the stale notices R1 targets, which is
 * what an earlier version of this function did.
 */
export function failedTurns(turns) {
  const out = []
  for (const record of turns.values()) {
    if (!record.ends.some((end) => end.kind === 'error')) continue
    out.push(record)
  }
  return out.sort((left, right) => left.turn - right.turn)
}

// --- R1 judge: stale-turn-error ---------------------------------------------

/**
 * READ THIS BEFORE CHANGING THE RULE.
 *
 * The noise: DSH keeps the "this turn failed" notice for every turn that ever
 * closed with `reason.kind === 'error'`, and never retracts it. When the same
 * work later succeeds the transcript ends up holding two contradictory
 * statements about the same turn, and the user reads the failure as the truth.
 *
 * Three independent pieces of log evidence each prove the notice is stale. They
 * are OR'd, and each is reported separately in `evidence` so a future reader can
 * tell which one fired:
 *
 *   sameTurnRecovered  the turn closed twice: an earlier close with
 *                      `kind === 'error'` and a later close with anything else.
 *                      This is the strongest signal — the turn itself finished.
 *   resumed            a `request/header` carrying `reason === 'resume'`
 *                      appears after the failing close, and a real
 *                      `assistant/message` lands after that header.
 *   reanswered         a later turn produced an `assistant/message` for the
 *                      same prompt fingerprint as the failed turn.
 *
 * Every signal requires its evidence to land STRICTLY AFTER the failing close.
 * That is the whole guard, and it is the correct one: a turn that failed and
 * then produced an answer has a stale notice, no matter whether the answer
 * landed in the same turn or a later one. (An earlier version of this rule also
 * demanded that the failed turn contain no assistant message of its own, which
 * silently excluded the strongest case — the resumed turn that finally
 * answered — and was removed.)
 *
 * @param events - complete contiguous raw event log.
 * @param options - `{ signals?: string[] }`; the subset of
 *   `['sameTurnRecovered', 'resumed', 'reanswered']` to consider. Default all.
 * @returns `{ matches }` where each match is
 *   `{ key, turn, endSeq, at, reason, code, why }`.
 */
export function judgeStaleTurnError(events, options = {}) {
  const allowed = new Set(
    Array.isArray(options.signals) && options.signals.length > 0
      ? options.signals
      : ['sameTurnRecovered', 'resumed', 'reanswered'],
  )
  const { turns } = indexTurns(events)
  const ordered = [...turns.values()].sort((left, right) => left.turn - right.turn)
  const matches = []

  for (const record of failedTurns(turns)) {
    const firstError = record.ends.find((end) => end.kind === 'error')
    const last = lastEndOf(record)
    const errorSeq = firstError === undefined ? record.endSeq : firstError.seq

    const why = []
    if (allowed.has('sameTurnRecovered') && record.ends.length > 1 && last !== null && last.kind !== 'error') {
      why.push('sameTurnRecovered')
    }

    if (allowed.has('resumed')) {
      // The resume header usually lands in the NEXT turn, not the failing one —
      // the runtime appends it when the session's next request starts, which is
      // after the failing turn already closed. Scanning only the failed turn's
      // own events would therefore miss the most common recovery shape
      // entirely, so this signal is session-scoped on purpose.
      const resumeSeq = events.reduce(
        (found, event) => (found !== null ? found : isResumeHeader(event) && event.seq > errorSeq ? event.seq : null),
        null,
      )
      if (resumeSeq !== null && events.some((event) => event.type === 'assistant/message' && event.seq > resumeSeq)) {
        why.push('resumed')
      }
    }

    if (allowed.has('reanswered') && record.promptFingerprint !== null) {
      // 'A later turn answered this same question.' The answer must be in a
      // later turn, so it cannot be content the failing turn already had.
      const reanswered = ordered.some(
        (other) =>
          other.turn > record.turn &&
          other.assistantSeqs.length > 0 &&
          other.promptFingerprint === record.promptFingerprint,
      )
      if (reanswered) why.push('reanswered')
    }

    if (why.length === 0) continue
    matches.push({
      key: 'turn:' + record.turn,
      turn: record.turn,
      endSeq: errorSeq,
      at: firstError !== undefined && firstError.time !== null ? firstError.time : record.closedAt,
      reason: firstError === undefined ? null : firstError.message,
      code: firstError === undefined ? null : firstError.code,
      why,
    })
  }
  return { matches }
}

// --- R2 judge: empty-turn ----------------------------------------------------

/**
 * The noise: a turn that opened, ran a step, closed as completed, and produced
 * nothing at all. The log records it faithfully; the user gets a blank row and
 * no way to tell "nothing happened" from "something was swallowed".
 *
 * "Empty" is judged against the surface contract, not against the raw event
 * count: a failed turn is full of `llm/retry` bookkeeping and is still empty in
 * the sense that matters, because none of it can reach the screen.
 *
 * NOTE ON THE VIEW HALF. This rule has no view anchor and cannot have one: the
 * trajectory view builds rows per *cell*, and a turn with no cells produces no
 * row at all — there is no element to mark. Rather than invent a mark on a
 * neighbouring turn, the rule stays host-only and reports itself as such. See
 * `view: null` and the README.
 *
 * A turn that failed is excluded by default: that is the failure notice's story
 * and R1's business, and two rules acting on one turn would make the self-check
 * report double. Set `excludeFailed: false` to see them.
 *
 * @param events - complete contiguous raw event log.
 * @param options - `{ requireClosed?: boolean, excludeFailed?: boolean }`.
 * @returns `{ matches }` with `{ key, turn, at, events, recovered }`.
 */
export function judgeEmptyTurn(events, options = {}) {
  const requireClosed = options.requireClosed !== false
  const excludeFailed = options.excludeFailed !== false
  const { turns } = indexTurns(events)
  const ordered = [...turns.values()].sort((left, right) => left.turn - right.turn)
  const matches = []

  for (const record of ordered) {
    if (requireClosed && record.ends.length === 0) continue
    if (record.surfaceSeqs.length > 0) continue
    if (excludeFailed && record.ends.some((end) => end.kind === 'error')) continue
    const last = lastEndOf(record)
    // A turn that failed and was answered elsewhere is R1's business, not R2's.
    const recovered = ordered.some(
      (other) => other.turn > record.turn && other.assistantSeqs.length > 0,
    )
    matches.push({
      key: 'turn:' + record.turn,
      turn: record.turn,
      at: record.startedAt ?? record.closedAt,
      // `events` counts everything the turn logged, `surface` counts what could
      // ever have reached the screen. A quiet turn still logs its step brackets,
      // so `surface === 0` is the number that means "nothing was shown".
      events: record.eventCount,
      surface: record.surfaceSeqs.length,
      endedAs: last === null ? 'open' : last.kind,
      recovered,
    })
  }
  return { matches }
}

// --- R3 judge: edit-turn-synthetic -------------------------------------------

/**
 * The noise: editing an earlier answer opens a synthetic turn to carry the
 * rewrite. That turn is real in the log but is not something the user asked
 * for, so a transcript that shows it without explanation looks like the
 * assistant volunteered a second answer.
 *
 * The marker is `source.editedBy`, which is a PLUGIN-level convention and not a
 * platform one: nothing under @deepseek-ai writes it, and the only producer
 * today is dsh-edit-turn. The rule therefore does not hard-code one producer —
 * it reports every distinct `editedBy` value it sees, so a second editor turns
 * up in the self-check instead of being silently ignored.
 *
 * A producer marks TWO messages and they land in DIFFERENT turns:
 *
 *   carrier     the rewritten prompt (`user/message` or `developer/message`)
 *               keeps the ORIGINAL turn number — it stands in the old turn's place
 *   correction  the rewritten answer (`assistant/message`) lands in the freshly
 *               opened turn, which is the synthetic turn this rule is about
 *
 * Flagging both would light up the user's own turn for something they did not
 * do, so the default scope is the correction only. `scope: 'any'` reports
 * carriers too, which is how you tell "this producer never ran" from "it ran
 * and its marker moved".
 *
 * @param events - complete contiguous raw event log.
 * @param options - `{ producers?: string[], scope?: 'synthetic' | 'any' }`.
 * @returns `{ matches, producers, carriers, orphans }`.
 */
export function judgeEditTurnSynthetic(events, options = {}) {
  const producers = Array.isArray(options.producers) && options.producers.length > 0 ? options.producers : ['dsh-edit-turn']
  const wanted = new Set(producers)
  const scope = options.scope === 'any' ? 'any' : 'synthetic'
  const { turns, turnOfSeq } = indexTurns(events)
  const seen = new Set()
  const matches = []
  let carriers = 0

  for (const record of turns.values()) {
    for (const producer of record.editedBy) seen.add(producer)
  }

  const bySeq = new Map(events.map((event) => [event.seq, event]))
  for (const record of [...turns.values()].sort((left, right) => left.turn - right.turn)) {
    let hits = 0
    let corrections = 0
    let first
    for (const seq of record.editedSeqs) {
      const event = bySeq.get(seq)
      if (event === undefined) continue
      const producer = editedByOf(event)
      if (producer === undefined || !wanted.has(producer)) continue
      hits += 1
      if (event.type === 'assistant/message') corrections += 1
      else carriers += 1
      if (first === undefined) first = event
    }
    if (hits === 0) continue
    if (scope === 'synthetic' && corrections === 0) continue
    matches.push({
      key: 'turn:' + record.turn,
      turn: record.turn,
      at: timeOf(first) ?? record.startedAt ?? record.closedAt,
      role: corrections > 0 ? 'synthetic' : 'carrier',
      events: hits,
      producers: [...record.editedBy],
    })
  }

  // An editedBy marker on an event that sits outside any turn is still worth
  // reporting: it means the producer wrote something the turn index cannot see.
  let orphans = 0
  for (const event of events) {
    if (editedByOf(event) === undefined) continue
    if (turnOfSeq.get(event.seq) === null || turnOfSeq.get(event.seq) === undefined) orphans += 1
  }
  return { matches, producers: [...seen].sort(), carriers, orphans }
}

// --- the rule table ----------------------------------------------------------

/**
 * Every rule, in one place.
 *
 * `view` is plain JSON on purpose: it crosses the HTTP boundary to the browser
 * half, which is a generic executor and knows nothing about any specific rule.
 * Adding a rule here is the only edit needed for both halves.
 *
 * Selector policy (read before changing one):
 *   * DSH class names are CSS-module hashes (`Sixlwa_turnErrorRow`) and the
 *     prefix changes every build, so a class anchor MUST use
 *     `[class*="_localName"]` and never the full class.
 *   * Prefer a `data-*` attribute whenever the platform offers one; those are
 *     stable across builds.
 *   * `scope` climbs with `closest()` to the element carrying the turn number;
 *     `turnAttr` names the attribute. `guard` must also match, and is what
 *     keeps two different notices that share one CSS class apart.
 */
export const RULES = Object.freeze([
  {
    id: 'stale-turn-error',
    title: '过期的运行失败提示',
    symptom: '一轮先报失败、后来同一轮又成功了（或同一提问得到了回答），屏幕上同时留着两条矛盾的提示',
    judge: judgeStaleTurnError,
    view: {
      surface: 'chat',
      // Local-name fragment only: the hash prefix is not stable.
      anchor: '[class*="_turnErrorRow"]',
      // The chat flow item wrapper carries the turn number as a real attribute.
      scope: '[data-chat-turn]',
      turnAttr: 'data-chat-turn',
      // Same CSS class is reused by the max-tokens notice; the flow kind is not.
      guard: '[data-chat-flow-kind="turn-error"]',
      action: 'collapse',
      labels: {
        collapsed: '本轮运行失败（后续已成功，提示已收起）',
        expanded: '收起这条过期提示',
      },
    },
  },
  {
    id: 'empty-turn',
    title: '空轮次',
    symptom: '一轮打开了、结束了，屏幕上什么都没发生，分不清是"无事发生"还是"内容被吞了"',
    judge: judgeEmptyTurn,
    // No anchor exists: a turn with no cells produces no trajectory row. Kept as
    // a host-side observation until the platform exposes a row for it.
    view: null,
  },
  {
    id: 'edit-turn-synthetic',
    title: '回答编辑产生的合成轮次',
    symptom: '编辑旧回答会开一个合成轮次，转录里看起来像助手又主动答了一次',
    judge: judgeEditTurnSynthetic,
    view: {
      surface: 'trajectory',
      // Section-start rows. A real data attribute, so this half is build-stable.
      anchor: 'tr[data-turn-start="true"]',
      scope: null,
      turnProbe: '[class*="_turnLabelCompact"]',
      // The platform renders this span as the literal '#' + turn, unprefixed and
      // not localized. It is the only turn number the trajectory table exposes.
      turnPattern: '^#(\\d+)$',
      action: 'annotate',
      labels: { badge: '由回答编辑产生' },
    },
  },
])

/** Look one rule up by id. */
export function ruleById(id) {
  return RULES.find((rule) => rule.id === id)
}

// --- configuration -----------------------------------------------------------

/**
 * Normalize plugin configuration.
 *
 * Retirement is per id and needs no code change:
 *   rules: { 'empty-turn': { enabled: false } }
 * A rule id that is not in the table is reported as unknown rather than being
 * ignored, so a typo in a retirement does not silently leave a rule running.
 * @param config - raw plugin config.
 * @returns `{ rules, unknown }`.
 */
export function resolveConfig(config) {
  const raw = config && typeof config === 'object' && config.rules && typeof config.rules === 'object' ? config.rules : {}
  const rules = new Map()
  const unknown = []
  for (const [id, value] of Object.entries(raw)) {
    if (ruleById(id) === undefined) {
      unknown.push(id)
      continue
    }
    rules.set(id, value && typeof value === 'object' ? value : {})
  }
  return { rules, unknown: unknown.sort() }
}

/** Whether a rule is enabled under a resolved config. */
export function isEnabled(resolved, id) {
  const entry = resolved.rules.get(id)
  return entry === undefined || entry.enabled !== false
}

/** The options a rule judge receives under a resolved config. */
export function optionsOf(resolved, id) {
  const entry = resolved.rules.get(id)
  if (entry === undefined || entry.options === undefined) return {}
  return entry.options && typeof entry.options === 'object' ? entry.options : {}
}

// --- the generic driver ------------------------------------------------------

/** Coerce one judge result into the exact shape the self-check reports. */
function normalizeMatches(raw) {
  if (raw === null || raw === undefined) return []
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.matches) ? raw.matches : []
  const out = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    out.push({
      key: typeof item.key === 'string' ? item.key : null,
      turn: typeof item.turn === 'number' ? item.turn : null,
      at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : null,
      ...item,
    })
  }
  return out
}

/**
 * Run every enabled rule over one log and collect the self-check.
 *
 * This is the only place rules are driven, and it never lets one rule reach
 * another: each call is enveloped, its output is re-shaped defensively, and a
 * throw becomes a `broken` entry carrying the message.
 *
 * @param events - complete contiguous raw event log.
 * @param resolved - result of {@link resolveConfig}.
 * @param clientReport - last view-side report, keyed by rule id (may be empty).
 * @returns one entry per rule in table order.
 */
export function runRules(events, resolved, clientReport = {}) {
  const out = []
  for (const rule of RULES) {
    const view = rule.view ?? null
    const report = clientReport[rule.id] && typeof clientReport[rule.id] === 'object' ? clientReport[rule.id] : null
    const anchorOk = report !== null && typeof report.anchorOk === 'boolean' ? report.anchorOk : null
    const base = {
      id: rule.id,
      title: rule.title,
      symptom: rule.symptom,
      enabled: isEnabled(resolved, rule.id),
      hasView: view !== null,
      view,
      anchorOk,
      anchorFound: report !== null && typeof report.anchorFound === 'number' ? report.anchorFound : null,
      applied: report !== null && typeof report.applied === 'number' ? report.applied : null,
      anchorCheckedAt: report !== null && typeof report.at === 'number' ? report.at : null,
    }

    if (!base.enabled) {
      out.push({ ...base, matches: 0, lastMatchAt: null, keys: [], sample: [], error: null, verdict: 'off' })
      continue
    }

    let result
    try {
      result = rule.judge(events, optionsOf(resolved, rule.id))
    } catch (error) {
      out.push({
        ...base,
        matches: 0,
        lastMatchAt: null,
        keys: [],
        sample: [],
        error: String((error && error.message) || error),
        verdict: 'broken',
      })
      continue
    }

    const matches = normalizeMatches(result)
    const lastMatchAt = matches.reduce((latest, match) => (match.at !== null && (latest === null || match.at > latest) ? match.at : latest), null)
    out.push({
      ...base,
      matches: matches.length,
      lastMatchAt,
      keys: matches.map((match) => match.key).filter((key) => key !== null).slice(0, 64),
      sample: matches.slice(0, 8),
      error: null,
      verdict: verdictOf(base.enabled, view !== null, matches.length, anchorOk, false),
    })
  }
  return out
}

/**
 * One-glance state for a rule. `alarm` is the state this whole endpoint exists
 * to make visible: the log says there is something to declutter and the view
 * cannot find where to put it, which means the anchor has rotted.
 * @returns a short machine token.
 */
export function verdictOf(enabled, hasView, matches, anchorOk, broken) {
  if (!enabled) return 'off'
  if (broken) return 'broken'
  if (!hasView) return 'host-only'
  if (anchorOk === null) return 'unmounted'
  if (matches > 0 && anchorOk === false) return 'alarm'
  if (matches > 0) return 'ok'
  return 'quiet'
}

/** The static, serializable half of the table that the browser half executes. */
export function ruleTable() {
  return RULES.map((rule) => ({
    id: rule.id,
    title: rule.title,
    symptom: rule.symptom,
    view: rule.view ?? null,
  }))
}
