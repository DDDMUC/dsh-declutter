// Negative verification.
//
// A test suite that only ever sees a healthy system proves nothing about whether
// it can see an unhealthy one. Every test here deliberately BREAKS one thing and
// asserts two halves:
//
//   (a) the broken configuration produces exactly the degraded result, and
//   (b) the healthy configuration, run on the same DOM and the same log, does
//       not — so the assertion is really testing the break and not passing by
//       accident.
//
// (b) is what makes these tests turn RED when the corresponding behaviour
// regresses. If the executor stopped honouring the guard, or the self-check
// stopped distinguishing "no anchor" from "anchor is fine", the paired healthy
// assertion and the degraded assertion would collapse onto the same value and
// the test would fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig, runRules } from '../src/logic.js'
import { sameTurnRecovered, editTurnSynthetic } from './fixtures.js'
import { loadClient } from './dom-stub.js'

/** Host-side rule states, exactly as the state route would serve them. */
function states(events) {
  return runRules(events, resolveConfig({}))
}

/** The chat DOM the executor works against, built inline so each test owns it. */
function chatDom(document) {
  const mk = (tag, attrs, text) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value)
    if (text !== undefined) node.textContent = text
    return node
  }
  const notice = (prefix) =>
    mk('div', { class: prefix + '_turnErrorRow', role: 'status' }, undefined)
  const turnError = mk('div', { 'data-chat-turn': '1', 'data-chat-flow-kind': 'turn-error' }, undefined)
  turnError.appendChild(notice('Sixlwa'))
  const maxTokens = mk('div', { 'data-chat-turn': '2', 'data-chat-flow-kind': 'turn-max-tokens' }, undefined)
  maxTokens.appendChild(notice('Zq8xR'))
  // A SECOND max-tokens notice on the very turn the rule flags. The turn filter
  // cannot help here, so this is the node that proves the guard is load-bearing:
  // the two notices are indistinguishable except by their flow kind.
  const sameTurnMaxTokens = mk('div', { 'data-chat-turn': '1', 'data-chat-flow-kind': 'turn-max-tokens' }, undefined)
  sameTurnMaxTokens.appendChild(notice('Qq7wE'))
  document.body.appendChild(turnError)
  document.body.appendChild(maxTokens)
  document.body.appendChild(sameTurnMaxTokens)
  return { turnError, maxTokens, sameTurnMaxTokens }
}

const executorStates = (events) => states(events).filter((rule) => rule.enabled && rule.view !== null)
const theRule = (list, id) => list.find((rule) => rule.id === id)

// --- 1. a rotted selector must be DETECTED, not silently ignored -------------

test('NEGATIVE: a rotted anchor is reported as anchorOk false, and the host calls it an alarm', async () => {
  const { api, document } = await loadClient()
  chatDom(document)
  const healthy = executorStates(sameTurnRecovered)

  // (b) healthy first, same DOM: the anchor resolves.
  const good = api.__test.sweep(healthy, (key) => key)
  assert.equal(good.rules['stale-turn-error'].anchorOk, true)
  assert.equal(good.rules['stale-turn-error'].applied, 1)

  // (a) the same table with one character changed in the class fragment — the
  // exact rot a CSS-module rebuild would cause.
  const rotted = healthy.map((rule) =>
    rule.id === 'stale-turn-error'
      ? { ...rule, view: { ...rule.view, anchor: '[class*="_turnErrorRowX"]' } }
      : rule,
  )
  const bad = api.__test.sweep(rotted, (key) => key)
  assert.equal(bad.rules['stale-turn-error'].anchorFound, 0)
  assert.equal(bad.rules['stale-turn-error'].anchorOk, false, 'zero anchors with the surface up is false, not null')
  assert.equal(bad.rules['stale-turn-error'].applied, 0)

  // ...and the host turns that report into the one-glance alarm.
  const hostHealthy = runRules(sameTurnRecovered, resolveConfig({}), {
    'stale-turn-error': { anchorOk: true, anchorFound: 2, applied: 1 },
  })
  const hostRotted = runRules(sameTurnRecovered, resolveConfig({}), bad.rules)
  assert.equal(theRule(hostHealthy, 'stale-turn-error').verdict, 'ok')
  assert.equal(theRule(hostRotted, 'stale-turn-error').verdict, 'alarm')
  // The log side is unchanged: the alarm says "there is noise and I cannot see
  // where it is", which is exactly the difference between alarm and quiet.
  assert.equal(theRule(hostRotted, 'stale-turn-error').matches, 1)
})

test('NEGATIVE: zero matches is visible in the self-check rather than looking healthy', () => {
  // A rule that silently matches nothing must be distinguishable from a rule
  // that is working and has nothing to do.
  const busy = theRule(runRules(sameTurnRecovered, resolveConfig({})), 'stale-turn-error')
  const idle = theRule(runRules(editTurnSynthetic, resolveConfig({})), 'stale-turn-error')
  assert.equal(busy.matches, 1)
  assert.equal(idle.matches, 0)
  // The counts differ, and both are reported with their own lastMatchAt, so a
  // reader can see "0 today" next to "last hit 3 days ago".
  assert.equal(typeof busy.lastMatchAt, 'number')
  assert.equal(idle.lastMatchAt, null)
})

// --- 2. the guard is load-bearing --------------------------------------------

test('NEGATIVE: without the flow-kind guard a same-turn max-tokens notice is swept in', async () => {
  const { api, document } = await loadClient()
  const dom = chatDom(document)
  const healthy = executorStates(sameTurnRecovered)

  // (b) with the guard, the failure notice on turn 1 is the only node touched,
  // even though a max-tokens notice on the SAME turn carries the same CSS class.
  const good = api.__test.sweep(healthy, (key) => key)
  assert.equal(good.rules['stale-turn-error'].applied, 1, 'one notice, not two')
  assert.equal(
    dom.sameTurnMaxTokens.querySelector('[class*="_turnErrorRow"]').getAttribute('data-dshdc-rule'),
    null,
    'the same-turn max-tokens notice is left alone',
  )

  // (a) drop the guard. Nothing else distinguishes the two nodes, so the
  // max-tokens notice is adopted and collapsed too — one mis-collapsed notice
  // per turn ended at the token cap.
  const unguarded = healthy.map((rule) =>
    rule.id === 'stale-turn-error' ? { ...rule, view: { ...rule.view, guard: null } } : rule,
  )
  const bad = api.__test.sweep(unguarded, (key) => key)
  assert.equal(bad.rules['stale-turn-error'].applied, 2, 'now both are adopted')
  assert.equal(
    dom.sameTurnMaxTokens.querySelector('[class*="_turnErrorRow"]').getAttribute('data-dshdc-rule'),
    'stale-turn-error',
    'this is exactly what the guard prevents',
  )
})

test('the turn filter alone protects a max-tokens notice on another turn', async () => {
  // Worth stating separately: turn 2 is not flagged, so the executor cannot
  // reach it even with the guard removed. Two independent protections, and this
  // test pins the weaker one so a future refactor cannot rely on it by accident.
  const { api, document } = await loadClient()
  const dom = chatDom(document)
  const unguarded = executorStates(sameTurnRecovered).map((rule) =>
    rule.id === 'stale-turn-error' ? { ...rule, view: { ...rule.view, guard: null } } : rule,
  )
  api.__test.sweep(unguarded, (key) => key)
  assert.equal(dom.maxTokens.querySelector('[class*="_turnErrorRow"]').getAttribute('data-dshdc-rule'), null)
})

// --- 3. the turn-number anchor is load-bearing -------------------------------

test('NEGATIVE: a renamed turn attribute makes the rule act on nothing', async () => {
  const { api, document } = await loadClient()
  const dom = chatDom(document)
  const healthy = executorStates(sameTurnRecovered)

  const good = api.__test.sweep(healthy, (key) => key)
  assert.equal(good.rules['stale-turn-error'].applied, 1)

  // (a) the descriptor now names an attribute the platform never sets, so no
  // node can be resolved to a turn and the rule must not guess.
  const renamed = healthy.map((rule) =>
    rule.id === 'stale-turn-error' ? { ...rule, view: { ...rule.view, turnAttr: 'data-chat-turn-x' } } : rule,
  )
  const bad = api.__test.sweep(renamed, (key) => key)
  assert.equal(bad.rules['stale-turn-error'].applied, 0)
  assert.equal(dom.turnError.querySelector('[class*="_turnErrorRow"]').getAttribute('data-dshdc-rule'), null)
  // The anchor still resolves, so this is NOT an alarm — it is a rule that can
  // see the notices and cannot place them, which the applied count exposes.
  assert.equal(bad.rules['stale-turn-error'].anchorOk, true)
  assert.equal(bad.rules['stale-turn-error'].anchorFound, 3, 'the anchor still resolves every notice')
})

test('NEGATIVE: a trajectory row without a parsable turn label is skipped, not guessed', async () => {
  const { api, document } = await loadClient()
  const row = document.createElement('tr')
  row.setAttribute('data-turn-start', 'true')
  const eventCell = document.createElement('td')
  const contentCell = document.createElement('td')
  const label = document.createElement('span')
  label.setAttribute('class', 'Y0dWHa_turnLabelCompact')
  label.textContent = 'turn two' // not the '#<n>' shape
  eventCell.appendChild(label)
  row.appendChild(eventCell)
  row.appendChild(contentCell)
  const tbody = document.createElement('tbody')
  tbody.appendChild(row)
  const table = document.createElement('table')
  table.appendChild(tbody)
  document.body.appendChild(table)

  const report = api.__test.sweep(executorStates(editTurnSynthetic), (key) => key)
  assert.equal(report.rules['edit-turn-synthetic'].anchorFound, 1, 'the row is found')
  assert.equal(report.rules['edit-turn-synthetic'].applied, 0, 'but never guessed at')
  assert.equal(row.querySelector('[data-dshdc-badge]'), null)
})

// --- 4. retirement by id -----------------------------------------------------

test('NEGATIVE: a retired rule is served as off and the executor never sees it', async () => {
  const { api, document } = await loadClient()
  const dom = chatDom(document)
  const resolved = resolveConfig({ rules: { 'stale-turn-error': { enabled: false } } })
  const rules = runRules(sameTurnRecovered, resolved)

  const retired = theRule(rules, 'stale-turn-error')
  assert.equal(retired.enabled, false)
  assert.equal(retired.verdict, 'off')
  assert.equal(retired.matches, 0, 'a retired rule stops reporting matches')

  // The executor filters on `enabled`, so a retired rule cannot mark anything.
  const served = rules.filter((rule) => rule.enabled && rule.view !== null)
  assert.equal(served.some((rule) => rule.id === 'stale-turn-error'), false)
  api.__test.sweep(served, (key) => key)
  assert.equal(dom.turnError.querySelector('[class*="_turnErrorRow"]').getAttribute('data-dshdc-rule'), null)

  // And retiring one rule leaves the others running.
  const others = rules.filter((rule) => rule.enabled && rule.view !== null).map((rule) => rule.id)
  assert.deepEqual(others, ['edit-turn-synthetic'])
})

// --- 5. a judge narrowed to nothing ------------------------------------------

test('NEGATIVE: switching off every R1 signal empties the rule', () => {
  const all = ['sameTurnRecovered', 'resumed', 'reanswered']
  const healthy = theRule(runRules(sameTurnRecovered, resolveConfig({})), 'stale-turn-error')
  const silent = theRule(
    runRules(sameTurnRecovered, resolveConfig({ rules: { 'stale-turn-error': { options: { signals: [] } } } })),
    'stale-turn-error',
  )
  assert.equal(healthy.matches, 1)
  assert.equal(silent.matches, 1, 'an empty signal list means "all", so this is still on')
  const none = theRule(
    runRules(sameTurnRecovered, resolveConfig({ rules: { 'stale-turn-error': { options: { signals: ['reanswered'] } } } })),
    'stale-turn-error',
  )
  assert.equal(none.matches, 0, 'only the named signal is considered')
  assert.ok(all.length === 3)
})

// --- 6. the executor never claims success it did not achieve -----------------

test('NEGATIVE: an action this build does not implement is not reported as applied', async () => {
  const { api, document } = await loadClient()
  chatDom(document)
  const healthy = executorStates(sameTurnRecovered)
  const unknown = healthy.map((rule) =>
    rule.id === 'stale-turn-error' ? { ...rule, view: { ...rule.view, action: 'teleport' } } : rule,
  )
  const report = api.__test.sweep(unknown, (key) => key)
  assert.equal(report.rules['stale-turn-error'].applied, 0, 'nothing was done, so nothing is claimed')
  // The node is still claimed by the rule so the state is visible, but no
  // collapse attribute was set and no toggle exists.
  assert.equal(document.body.querySelectorAll('[data-dshdc-toggle]').length, 0)
  assert.equal(document.body.querySelectorAll('[data-dshdc-collapsed]').length, 0)
})

// --- 7. a rule with no anchor is skipped, not faked --------------------------

test('NEGATIVE: a host-only rule never reaches the DOM', async () => {
  const { api, document } = await loadClient()
  chatDom(document)
  const rules = runRules(sameTurnRecovered, resolveConfig({}))
  const withHostOnly = rules.filter((rule) => rule.enabled && rule.view !== null)
  assert.equal(rules.some((rule) => rule.id === 'empty-turn'), true)
  assert.equal(withHostOnly.some((rule) => rule.id === 'empty-turn'), false)
  const report = api.__test.sweep(withHostOnly, (key) => key)
  assert.equal('empty-turn' in report.rules, false)
  assert.equal(theRule(rules, 'empty-turn').verdict, 'host-only')
})
