// View-side tests: the generic rule executor against a stub DOM.
//
// These tests are about the EXECUTOR, not about any one rule. They build the
// same DOM shapes the platform builds (including a CSS-module hash prefix that
// differs between the two notices, because that prefix is what makes the
// selector policy load-bearing) and check that the executor adopts, re-applies
// and releases nodes without ever owning a node the platform owns.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveConfig, runRules } from '../src/logic.js'
import { sameTurnRecovered, editTurnSynthetic } from './fixtures.js'
import { loadClient } from './dom-stub.js'

/**
 * Build a chat transcript with two notices that share one CSS class.
 *
 * The class prefix differs between them on purpose: DSH hashes class names per
 * build, so a selector written against the full class name would work in one
 * build and silently match nothing in the next.
 */
function makeFlowItem(document, { turn, kind, prefix, title, message, code }) {
  const mk = (tag, attrs, children) => {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value)
    for (const child of children ?? []) node.appendChild(child)
    return node
  }
  const titleNode = mk('span', { class: prefix + '_turnErrorTitle' }, [])
  titleNode.textContent = title
  const messageNode = mk('span', { class: prefix + '_turnErrorMessage' }, [])
  messageNode.textContent = message
  const notice = mk('div', { class: prefix + '_turnErrorRow', role: 'status' }, [
    mk('span', { class: prefix + '_turnErrorDot' }),
    mk('div', { class: prefix + '_turnErrorCopy' }, [titleNode, messageNode]),
    ...(code === undefined ? [] : [mk('code', { class: prefix + '_turnErrorCode' }, [])]),
  ])
  if (code !== undefined) notice.querySelector('[class*="_turnErrorCode"]').textContent = code
  return mk(
    'div',
    {
      class: 'EvIC1a_flowItem',
      'data-chat-turn': String(turn),
      'data-chat-flow-kind': kind,
      'data-chat-node-key': 'key-' + turn,
      'data-chat-anchor-key': 'key-' + turn,
    },
    [notice],
  )
}

function chatFixture(document) {
  // Turn 1: the failure notice R1 targets. Prefix 'Sixlwa'.
  const failed = makeFlowItem(document, {
    turn: 1,
    kind: 'turn-error',
    prefix: 'Sixlwa',
    title: '本轮运行失败',
    message: 'Connection error.',
    code: 'TRANSPORT',
  })
  // Turn 2: the max-tokens notice. SAME row class, different prefix, different
  // flow kind — which is exactly the pair the rule's guard has to separate.
  const capped = makeFlowItem(document, {
    turn: 2,
    kind: 'turn-max-tokens',
    prefix: 'Zq8xR',
    title: '达到输出上限',
    message: '本轮回答被截断。',
  })
  document.body.appendChild(failed)
  document.body.appendChild(capped)
  return { failed, capped }
}

/** The chat flow wrapper of a notice element. */
const wrapperOf = (node) => node.parentNode

function stateFor(events, viewReport) {
  return runRules(events, resolveConfig({}), viewReport ?? {}).filter(
    (rule) => rule.enabled && rule.view !== null,
  )
}

test('a stale failure notice is collapsed, not removed', async () => {
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  const notice = failed.querySelector('[class*="_turnErrorRow"]')

  const report = api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)

  assert.equal(report.rules['stale-turn-error'].anchorFound, 2, 'both notices share the class')
  assert.equal(report.rules['stale-turn-error'].applied, 1, 'only the stale one is acted on')
  // The platform node is still there, still holding all of its own children.
  assert.equal(failed.querySelector('[class*="_turnErrorRow"]'), notice)
  assert.equal(notice.children.length, 4, 'the three original children plus one toggle')
  assert.equal(notice.getAttribute('data-dshdc-rule'), 'stale-turn-error')
  assert.equal(notice.getAttribute('data-dshdc-turn'), '1')
  assert.equal(notice.getAttribute('data-dshdc-collapsed'), '1')
  assert.equal(notice.getAttribute('role'), 'status', 'a platform attribute is left alone')
})

test('the collapse is reversible and the toggle says which way it goes', async () => {
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  const notice = failed.querySelector('[class*="_turnErrorRow"]')
  api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)

  const toggle = notice.querySelector(':scope > [data-dshdc-toggle]')
  assert.ok(toggle !== null, 'a toggle is injected')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  const collapsedLabel = toggle.textContent

  toggle.dispatch('click')
  assert.equal(notice.getAttribute('data-dshdc-collapsed'), '0')
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.notEqual(toggle.textContent, collapsedLabel, 'the label flips with the state')

  // And a re-sweep must not undo the click.
  api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)
  assert.equal(notice.getAttribute('data-dshdc-collapsed'), '0', 'a re-render must not re-collapse')
})

test('the max-tokens notice is left alone even though it shares the row class', async () => {
  const { api, document } = await loadClient()
  const { capped } = chatFixture(document)
  api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)

  const notice = capped.querySelector('[class*="_turnErrorRow"]')
  assert.equal(notice.getAttribute('data-dshdc-rule'), null)
  assert.equal(notice.getAttribute('data-dshdc-collapsed'), null)
  assert.equal(notice.querySelector(':scope > [data-dshdc-toggle]'), null)
})

test('a turn the host did not flag is never touched', async () => {
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  // failedOnly: turn 1 failed and was never recovered.
  const { failedOnly } = await import('./fixtures.js')
  const report = api.__test.sweep(stateFor(failedOnly), (key) => key)
  assert.equal(report.rules['stale-turn-error'].applied, 0)
  const notice = failed.querySelector('[class*="_turnErrorRow"]')
  assert.equal(notice.getAttribute('data-dshdc-rule'), null)
})

test('sweeping repeatedly is idempotent: one marker, one toggle, forever', async () => {
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  const rules = stateFor(sameTurnRecovered)
  for (let i = 0; i < 25; i += 1) api.__test.sweep(rules, (key) => key)

  const notice = failed.querySelector('[class*="_turnErrorRow"]')
  assert.equal(document.body.querySelectorAll('[data-dshdc-toggle]').length, 1)
  assert.equal(notice.querySelectorAll(':scope > [data-dshdc-toggle]').length, 1)
  assert.equal(notice.children.length, 4)
})

test('the marker is re-applied when the platform re-creates the row', async () => {
  // This is the virtual-list case: the row a marker was placed on is discarded
  // and a brand new element takes its place. Marker-per-node cannot survive
  // that, which is why the executor is a re-runnable sweep and not a one-shot.
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  const rules = stateFor(sameTurnRecovered)
  api.__test.sweep(rules, (key) => key)
  assert.equal(failed.querySelectorAll('[data-dshdc-toggle]').length, 1)

  // The platform discards the whole wrapper and builds a fresh, equivalent one.
  // Building it fresh matters: reusing the old children would carry the marker
  // across and the test would prove nothing.
  const replacement = makeFlowItem(document, {
    turn: 1,
    kind: 'turn-error',
    prefix: 'Sixlwa',
    title: '本轮运行失败',
    message: 'Connection error.',
    code: 'TRANSPORT',
  })
  const newNotice = replacement.querySelector('[class*="_turnErrorRow"]')
  failed.parentNode.appendChild(replacement)
  failed.remove()

  assert.equal(replacement.querySelectorAll('[data-dshdc-toggle]').length, 0, 'the new row starts clean')
  api.__test.sweep(rules, (key) => key)
  assert.equal(replacement.querySelectorAll('[data-dshdc-toggle]').length, 1, 'and is re-adopted')
  assert.equal(newNotice.getAttribute('data-dshdc-collapsed'), '1')
})

test('a node that stops matching is released instead of left collapsed', async () => {
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  const notice = failed.querySelector('[class*="_turnErrorRow"]')
  api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)
  assert.equal(notice.getAttribute('data-dshdc-rule'), 'stale-turn-error')

  // The host stops flagging the turn (the log changed under us).
  const { failedOnly } = await import('./fixtures.js')
  api.__test.sweep(stateFor(failedOnly), (key) => key)
  assert.equal(notice.getAttribute('data-dshdc-rule'), null, 'the marker is gone')
  assert.equal(notice.getAttribute('data-dshdc-collapsed'), null)
  assert.equal(notice.querySelectorAll(':scope > [data-dshdc-toggle]').length, 0)
  assert.equal(notice.children.length, 3, 'the original children are untouched')
})

test('teardown removes this plugin marker and nothing else', async () => {
  const { api, document } = await loadClient()
  const { failed } = chatFixture(document)
  const notice = failed.querySelector('[class*="_turnErrorRow"]')
  // A foreign plugin's marker on the same node must survive.
  notice.setAttribute('data-dshdt-hidden', '1')
  notice.setAttribute('data-other-plugin', 'keep-me')
  api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)

  const removed = api.__test.sweepInjectedNodes()
  assert.ok(removed > 0)
  assert.equal(document.body.querySelectorAll('[data-dshdc-toggle]').length, 0)
  assert.equal(notice.getAttribute('data-dshdc-rule'), null)
  assert.equal(notice.getAttribute('data-dshdc-turn'), null)
  assert.equal(notice.getAttribute('data-dshdc-collapsed'), null)
  assert.equal(notice.getAttribute('data-dshdt-hidden'), '1', 'another plugin attribute survives')
  assert.equal(notice.getAttribute('data-other-plugin'), 'keep-me')
  assert.equal(notice.getAttribute('role'), 'status')
})

// --- anchor health -----------------------------------------------------------

test('anchorOk is true when the anchor resolves', async () => {
  const { api, document } = await loadClient()
  chatFixture(document)
  const report = api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)
  assert.equal(report.rules['stale-turn-error'].anchorOk, true)
  assert.equal(report.rules['stale-turn-error'].anchorFound, 2)
})

test('anchorOk is false when the surface is up but the anchor resolves nothing', async () => {
  // The selector rotted: the chat is mounted (it has flow items) but no notice
  // matches any more. This is the failure the self-check exists to surface.
  const { api, document } = await loadClient()
  const flow = document.createElement('div')
  flow.setAttribute('data-chat-turn', '1')
  document.body.appendChild(flow)
  const report = api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)
  assert.equal(report.rules['stale-turn-error'].anchorOk, false)
  assert.equal(report.rules['stale-turn-error'].anchorFound, 0)
})

test('anchorOk is null when the surface is not on screen at all', async () => {
  // Unknown is not the same as broken: an unmounted transcript must not raise
  // an alarm, or the signal would be crying wolf half the time.
  const { api, document } = await loadClient()
  assert.equal(api.__test.surfaceMounted('chat'), false)
  const report = api.__test.sweep(stateFor(sameTurnRecovered), (key) => key)
  assert.equal(report.rules['stale-turn-error'].anchorOk, null)
  assert.equal(report.rules['stale-turn-error'].applied, 0)
})

// --- the trajectory half -----------------------------------------------------

/** One trajectory section-start row, with the compact turn label the table publishes. */
function trajectoryRow(document, turn) {
  const row = document.createElement('tr')
  row.setAttribute('data-turn-start', 'true')
  row.setAttribute('data-trajectory-row-key', 'message%00seq%00' + turn)
  const event = document.createElement('td')
  event.setAttribute('class', 'Y0dWHa_event')
  const label = document.createElement('span')
  label.setAttribute('class', 'Y0dWHa_turnLabel')
  const full = document.createElement('span')
  full.setAttribute('class', 'Y0dWHa_turnLabelFull')
  full.textContent = '第 ' + turn + ' 轮'
  const compact = document.createElement('span')
  compact.setAttribute('class', 'Y0dWHa_turnLabelCompact')
  compact.textContent = '#' + turn
  label.appendChild(full)
  label.appendChild(compact)
  event.appendChild(label)
  const content = document.createElement('td')
  content.setAttribute('class', 'Y0dWHa_content')
  row.appendChild(event)
  row.appendChild(content)
  const table = document.createElement('table')
  const tbody = document.createElement('tbody')
  tbody.appendChild(row)
  table.appendChild(tbody)
  document.body.appendChild(table)
  return { row, content }
}

test('the trajectory rule annotates the edited turn and only that turn', async () => {
  const { api, document } = await loadClient()
  const edited = trajectoryRow(document, 2)
  const other = trajectoryRow(document, 1)
  const report = api.__test.sweep(stateFor(editTurnSynthetic), (key) => key)
  const entry = report.rules['edit-turn-synthetic']
  assert.equal(entry.anchorFound, 2, 'both rows are section starts')
  assert.equal(entry.applied, 1, 'only the edit turn is annotated')

  const badge = edited.row.querySelector('[data-dshdc-badge]')
  assert.ok(badge !== null)
  assert.equal(badge.getAttribute('data-dshdc-turn'), '2')
  assert.equal(other.row.querySelector('[data-dshdc-badge]'), null)
})

test('a trajectory badge is re-applied after the virtual list rebuilds the row', async () => {
  const { api, document } = await loadClient()
  const rules = stateFor(editTurnSynthetic)
  const first = trajectoryRow(document, 2)
  api.__test.sweep(rules, (key) => key)
  assert.equal(first.row.querySelectorAll('[data-dshdc-badge]').length, 1)

  first.row.remove()
  const rebuilt = trajectoryRow(document, 2)
  api.__test.sweep(rules, (key) => key)
  assert.equal(rebuilt.row.querySelectorAll('[data-dshdc-badge]').length, 1)
  assert.equal(document.body.querySelectorAll('[data-dshdc-badge]').length, 1, 'no stacking')
})
