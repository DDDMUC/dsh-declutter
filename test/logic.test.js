// Host-side rule tests.
//
// Every log fixture used here has already been through the platform's own
// session validator (see test/fixtures.js), so these tests exercise the rule
// table against events the runtime would actually have persisted.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  RULES,
  fingerprint,
  indexTurns,
  isEnabled,
  judgeEditTurnSynthetic,
  judgeEmptyTurn,
  judgeStaleTurnError,
  resolveConfig,
  ruleById,
  ruleTable,
  runRules,
} from '../src/logic.js'
import { failedOnly, failedEmpty, emptyTurn, realThenEmpty, editTurnSynthetic, mixed, reansweredLater, resumedNextTurn, sameTurnRecovered, validateFixtures } from './fixtures.js'

test('every fixture is a legal session event (platform validator)', async () => {
  const result = await validateFixtures()
  if (result.skipped !== null) {
    // Not a silent pass: the assertion below fails loudly if the validator is
    // present and a fixture is illegal, and the skip reason is printed here so
    // a run without the platform package is visibly weaker.
    console.log('SKIPPED real session validation:', result.skipped)
    return
  }
  assert.ok(result.validated > 50, 'expected the fixture set to be substantial')
})

// --- the rule table is the single source of truth ----------------------------

test('rule table is well formed and ids are unique', () => {
  assert.ok(RULES.length >= 3)
  const ids = new Set()
  for (const rule of RULES) {
    assert.equal(typeof rule.id, 'string')
    assert.ok(rule.id.length > 0)
    assert.ok(!ids.has(rule.id), 'duplicate rule id ' + rule.id)
    ids.add(rule.id)
    assert.equal(typeof rule.title, 'string')
    assert.equal(typeof rule.symptom, 'string', 'rule ' + rule.id + ' must state the symptom it exists for')
    assert.equal(typeof rule.judge, 'function', 'rule ' + rule.id + ' must carry its own judge')
    assert.ok(rule.view === null || typeof rule.view === 'object')
  }
})

test('the serializable rule table carries no functions', () => {
  const table = ruleTable()
  assert.equal(table.length, RULES.length)
  const round = JSON.parse(JSON.stringify(table))
  for (const entry of round) {
    assert.equal(typeof entry.id, 'string')
    assert.ok(entry.view === null || typeof entry.view === 'object')
  }
  // The browser half has no branch for any specific rule, so the table must be
  // able to cross the wire untouched.
  assert.deepEqual(round, table)
})

test('a rule that declares no view is honest about it', () => {
  const empty = ruleById('empty-turn')
  assert.equal(empty.view, null)
  const rules = runRules(emptyTurn, resolveConfig({}))
  const entry = rules.find((rule) => rule.id === 'empty-turn')
  assert.equal(entry.hasView, false)
  assert.equal(entry.verdict, 'host-only')
})

// --- R1: stale-turn-error ----------------------------------------------------

test('R1 stays quiet when a failure was never recovered', () => {
  const result = judgeStaleTurnError(failedOnly)
  assert.deepEqual(result.matches, [])
})

test('R1 flags a turn that closed with an error and later closed successfully', () => {
  const result = judgeStaleTurnError(sameTurnRecovered)
  assert.equal(result.matches.length, 1)
  const match = result.matches[0]
  assert.equal(match.turn, 1)
  assert.equal(match.key, 'turn:1')
  assert.equal(match.code, 'TRANSPORT')
  assert.ok(match.why.includes('sameTurnRecovered'))
  assert.equal(typeof match.at, 'number')
})

test('R1 flags a failure that a later resume answered', () => {
  const result = judgeStaleTurnError(resumedNextTurn)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].turn, 1)
  assert.deepEqual(result.matches[0].why, ['resumed'])
})

test('R1 flags a failure whose question was asked again and answered', () => {
  const result = judgeStaleTurnError(reansweredLater)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].turn, 1)
  assert.deepEqual(result.matches[0].why, ['reanswered'])
})

test('R1 never flags the turn that did the recovering', () => {
  for (const log of [sameTurnRecovered, resumedNextTurn, reansweredLater]) {
    const turns = judgeStaleTurnError(log).matches.map((match) => match.turn)
    assert.ok(!turns.includes(2), 'the answering turn must not be flagged')
  }
})

test('R1 signals are independently configurable and each stands alone', () => {
  const all = ['sameTurnRecovered', 'resumed', 'reanswered']
  // The same log can prove more than one signal (a turn that recovered in place
  // after a resume proves two), so the property under test is not "one log, one
  // signal" but "switching a signal off cannot be masked by another one".
  for (const log of [sameTurnRecovered, resumedNextTurn, reansweredLater]) {
    const full = judgeStaleTurnError(log).matches[0]
    assert.ok(full.why.length >= 1, 'the log must prove at least one signal')
    for (const signal of full.why) {
      const alone = judgeStaleTurnError(log, { signals: [signal] })
      assert.deepEqual(alone.matches[0].why, [signal], signal + ' must stand alone')
    }
    const none = judgeStaleTurnError(log, { signals: all.filter((name) => !full.why.includes(name)) })
    assert.deepEqual(none.matches, [], 'switching off every proven signal must silence the rule')
  }
})

test('R1 reports which signal fired, on the turn the notice is anchored to', () => {
  // sameTurnRecovered closes twice; the notice is anchored to the FIRST close.
  const match = judgeStaleTurnError(sameTurnRecovered).matches[0]
  assert.equal(match.endSeq, 4, 'the failing close, not the later successful one')
  assert.deepEqual(match.why.slice().sort(), ['resumed', 'sameTurnRecovered'])
})

// --- R2: empty-turn ----------------------------------------------------------

test('R2 flags a turn that produced nothing', () => {
  const result = judgeEmptyTurn(emptyTurn)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].turn, 1)
  assert.equal(result.matches[0].endedAs, 'completed')
  // The turn still logged its step brackets, so `events` is not zero — which is
  // exactly why "empty" has to be judged on surface content, not on event count.
  assert.equal(result.matches[0].events, 2)
  assert.equal(result.matches[0].surface, 0)
})

test('R2 finds the empty turn among real ones, by turn number not by position', () => {
  const result = judgeEmptyTurn(realThenEmpty)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].turn, 2)
})

test('R2 ignores a failed turn that still showed the prompt', () => {
  // failedOnly has a user/message, so it is not surface-empty for any setting.
  assert.deepEqual(judgeEmptyTurn(failedOnly).matches, [])
  assert.deepEqual(judgeEmptyTurn(failedOnly, { excludeFailed: false }).matches, [])
})

test('a turn that failed with nothing to show belongs to R1, not R2', () => {
  // failedEmpty has no surface events either, so the two rules genuinely
  // overlap; only the default keeps them from reporting the same turn twice.
  assert.equal(judgeEmptyTurn(failedEmpty).matches.length, 0)
  assert.equal(judgeEmptyTurn(failedEmpty, { excludeFailed: false }).matches.length, 1)
  assert.equal(judgeStaleTurnError(failedEmpty).matches.length, 0, 'no recovery, so R1 stays quiet too')
})

// --- R3: edit-turn-synthetic -------------------------------------------------

test('R3 flags the synthetic turn an answer edit opened, and names the producer', () => {
  const result = judgeEditTurnSynthetic(editTurnSynthetic)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].turn, 2)
  assert.equal(result.matches[0].role, 'synthetic')
  assert.deepEqual(result.producers, ['dsh-edit-turn'])
  assert.equal(result.orphans, 0)
})

test('R3 does not blame the original turn for the produced carrier', () => {
  // dsh-edit-turn marks two messages: a carrier that keeps the ORIGINAL turn
  // number and a correction that lands in the freshly opened one. Only the
  // second is the synthetic turn, and flagging the first would put a badge on
  // the user's own question.
  const defaultScope = judgeEditTurnSynthetic(editTurnSynthetic)
  assert.deepEqual(defaultScope.matches.map((match) => match.turn), [2])
  assert.equal(defaultScope.carriers, 1, 'the carrier is still counted')

  const anyScope = judgeEditTurnSynthetic(editTurnSynthetic, { scope: 'any' })
  assert.deepEqual(anyScope.matches.map((match) => match.turn), [1, 2])
  assert.deepEqual(anyScope.matches.map((match) => match.role), ['carrier', 'synthetic'])
})

test('R3 reports other editors instead of silently ignoring them', () => {
  const result = judgeEditTurnSynthetic(editTurnSynthetic, { producers: ['some-other-editor'] })
  assert.equal(result.matches.length, 0)
  assert.deepEqual(result.producers, ['dsh-edit-turn'], 'the unseen producer is still reported')
  assert.equal(result.carriers, 0, 'and nothing was counted as its own')
})

// --- the driver --------------------------------------------------------------

test('runRules covers every rule and merges the view-side report', () => {
  const rules = runRules(editTurnSynthetic, resolveConfig({}), {
    'edit-turn-synthetic': { anchorOk: true, anchorFound: 3, applied: 1, at: 1234 },
  })
  assert.equal(rules.length, RULES.length)
  const r3 = rules.find((rule) => rule.id === 'edit-turn-synthetic')
  assert.equal(r3.matches, 1)
  assert.equal(r3.anchorOk, true)
  assert.equal(r3.applied, 1)
  assert.equal(r3.verdict, 'ok')
  assert.equal(r3.error, null)
})

test('a rule with matches but no view anchor is the alarm state', () => {
  const rules = runRules(resumedNextTurn, resolveConfig({}), {
    'stale-turn-error': { anchorOk: false, anchorFound: 0, applied: 0, at: 1 },
  })
  const r1 = rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.matches, 1, 'the log side still knows there is something to hide')
  assert.equal(r1.anchorOk, false, 'and the view side cannot find it')
  assert.equal(r1.verdict, 'alarm')
})

test('an unreported anchor is "unmounted", never a silent pass', () => {
  const rules = runRules(resumedNextTurn, resolveConfig({}))
  const r1 = rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.anchorOk, null)
  assert.equal(r1.verdict, 'unmounted')
})

test('a rule can be retired by id alone', () => {
  const resolved = resolveConfig({ rules: { 'stale-turn-error': { enabled: false } } })
  assert.equal(isEnabled(resolved, 'stale-turn-error'), false)
  assert.equal(isEnabled(resolved, 'empty-turn'), true)
  const rules = runRules(sameTurnRecovered, resolved)
  const r1 = rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.matches, 0)
  assert.equal(r1.verdict, 'off')
  assert.equal(rules.find((rule) => rule.id === 'empty-turn').verdict !== 'off', true)
})

test('a retirement that names no real rule is reported, not ignored', () => {
  const resolved = resolveConfig({ rules: { 'no-such-rule': { enabled: false } } })
  assert.deepEqual(resolved.unknown, ['no-such-rule'])
})

test('one broken rule cannot affect any other rule', () => {
  const target = ruleById('stale-turn-error')
  const original = target.judge
  try {
    target.judge = () => {
      throw new Error('boom')
    }
    const rules = runRules(mixed, resolveConfig({}))
    const broken = rules.find((rule) => rule.id === 'stale-turn-error')
    assert.equal(broken.verdict, 'broken')
    assert.match(broken.error, /boom/)
    assert.equal(broken.matches, 0)
    // Everything else still ran.
    for (const id of ['empty-turn', 'edit-turn-synthetic']) {
      const entry = rules.find((rule) => rule.id === id)
      assert.equal(entry.error, null, id + ' must be unaffected')
      assert.ok(entry.matches > 0, id + ' must still have run')
    }
  } finally {
    target.judge = original
  }
})

test('a rule returning garbage degrades instead of crashing the driver', () => {
  const target = ruleById('empty-turn')
  const original = target.judge
  try {
    target.judge = () => ({ matches: 'not-a-list' })
    const rules = runRules(mixed, resolveConfig({}))
    const entry = rules.find((rule) => rule.id === 'empty-turn')
    assert.equal(entry.error, null)
    assert.equal(entry.matches, 0)
  } finally {
    target.judge = original
  }
})

// --- the turn index ----------------------------------------------------------

test('the turn index keeps every close of a turn that closed twice', () => {
  const { turns } = indexTurns(sameTurnRecovered)
  const record = turns.get(1)
  assert.equal(record.ends.length, 2)
  assert.deepEqual(record.ends.map((end) => end.kind), ['error', 'completed'])
  assert.equal(record.assistantSeqs.length, 1)
})

test('fingerprints separate distinct prompts and match repeats', () => {
  assert.equal(fingerprint('解释一下这个报错'), fingerprint('  解释一下这个报错  '))
  assert.notEqual(fingerprint('解释一下这个报错'), fingerprint('解释一下那个报错'))
  assert.equal(fingerprint('   '), null)
})

test('the whole fixture set runs through the driver without error', () => {
  const rules = runRules(mixed, resolveConfig({}))
  for (const rule of rules) {
    assert.equal(rule.error, null, rule.id + ' threw: ' + rule.error)
    assert.equal(rule.verdict === 'broken', false)
  }
  const total = rules.reduce((sum, rule) => sum + rule.matches, 0)
  assert.ok(total > 0, 'the mixed fixture must exercise at least one rule')
})
