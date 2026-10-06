// Host-route tests.
//
// The plugin's two routes are exercised through the same register() contract the
// real web server uses, with a fake request/response. No HTTP server is started
// and nothing outside this process is touched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'

import { apply, name as pluginName, version as hostVersion } from '../src/index.js'
import { RULES, PLUGIN_ID, VERSION } from '../src/logic.js'
import { resumedNextTurn, sameTurnRecovered } from './fixtures.js'

const SESSION = 'session-11111111-2222-3333-4444-555555555555'

/** Mount the plugin against a fake cordis context and capture its routes. */
function mount(options = {}) {
  const routes = new Map()
  const webServer = {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  }
  const events = options.events === undefined ? sameTurnRecovered : options.events
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    inject: () => {},
    get: (service) => {
      if (service === 'webServer') return webServer
      if (service === 'sessionQuery') {
        return {
          readSession: async () => (events === null ? null : { events }),
        }
      }
      return undefined
    },
  }
  apply(ctx, options.config ?? {})
  return routes
}

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(payload) {
      this.body = JSON.parse(payload)
    },
  }
}

function makeReq({ method = 'GET', url = '/', body, headers, remoteAddress = '127.0.0.1' } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = headers ?? { host: '127.0.0.1:3080' }
  req.socket = { remoteAddress }
  if (body !== undefined) {
    setTimeout(() => {
      req.emit('data', body)
      req.emit('end')
    }, 0)
  }
  return req
}

async function call(routes, path, reqOptions) {
  const route = routes.get(path)
  assert.ok(route !== undefined, 'route ' + path + ' must be registered')
  const res = makeRes()
  await route.handler(makeReq(reqOptions), res)
  return res
}

// --- the mount probe convention ---------------------------------------------

test('a bare GET /state answers 400, so 404 can mean "not installed"', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', { url: '/dsh-declutter/state' })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.ok, false)
  assert.equal(res.body.code, 'invalid')
})

test('a malformed session id is rejected as 400, not 404', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=not-a-session',
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'invalid')
})

test('an unknown session is 404', async () => {
  const routes = mount({ events: null })
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
  })
  assert.equal(res.statusCode, 404)
  assert.equal(res.body.code, 'session-not-found')
})

// --- the self-check ----------------------------------------------------------

test('GET /state reports every rule with matches, lastMatchAt and anchorOk', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.plugin, PLUGIN_ID)
  assert.equal(res.body.version, VERSION)
  assert.equal(res.body.sessionId, SESSION)
  assert.equal(res.body.rules.length, RULES.length)
  for (const rule of res.body.rules) {
    assert.equal(typeof rule.id, 'string')
    assert.equal(typeof rule.matches, 'number', rule.id + ' must report a match count')
    assert.ok('lastMatchAt' in rule, rule.id + ' must report lastMatchAt')
    assert.ok('anchorOk' in rule, rule.id + ' must report anchorOk')
    assert.equal(typeof rule.verdict, 'string')
  }
  const r1 = res.body.rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.matches, 1)
  assert.equal(typeof r1.lastMatchAt, 'number')
  // Nothing has reported anchor health yet, and that is reported as unknown
  // rather than as a pass.
  assert.equal(r1.anchorOk, null)
  assert.equal(r1.verdict, 'unmounted')
})

test('the state carries the rule table so the browser half stays generic', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
  })
  assert.deepEqual(
    res.body.ruleTable.map((entry) => entry.id),
    RULES.map((rule) => rule.id),
  )
  // Serializable: it has to survive the wire with no functions attached.
  assert.deepEqual(JSON.parse(JSON.stringify(res.body.ruleTable)), res.body.ruleTable)
})

test('a view report turns the self-check into an alarm when the anchor is gone', async () => {
  const routes = mount({ events: resumedNextTurn })
  const posted = await call(routes, '/dsh-declutter/report', {
    method: 'POST',
    url: '/dsh-declutter/report',
    body: JSON.stringify({
      sessionId: SESSION,
      version: VERSION,
      rules: { 'stale-turn-error': { anchorOk: false, anchorFound: 0, applied: 0 } },
    }),
  })
  assert.equal(posted.statusCode, 200)
  assert.equal(posted.body.ok, true)

  const state = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
  })
  const r1 = state.body.rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.matches, 1, 'the log side still knows there is noise')
  assert.equal(r1.anchorOk, false, 'the view side cannot find it')
  assert.equal(r1.verdict, 'alarm')
  assert.deepEqual(state.body.verdicts.alarm, ['stale-turn-error'])
  assert.equal(typeof state.body.reportedAt, 'number')
})

test('a healthy anchor report reads as ok', async () => {
  const routes = mount()
  await call(routes, '/dsh-declutter/report', {
    method: 'POST',
    url: '/dsh-declutter/report',
    body: JSON.stringify({
      sessionId: SESSION,
      rules: { 'stale-turn-error': { anchorOk: true, anchorFound: 2, applied: 1 } },
    }),
  })
  const state = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
  })
  const r1 = state.body.rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.anchorOk, true)
  assert.equal(r1.anchorFound, 2)
  assert.equal(r1.applied, 1)
  assert.equal(r1.verdict, 'ok')
})

test('the report route rejects a malformed payload without disturbing state', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/report', {
    method: 'POST',
    url: '/dsh-declutter/report',
    body: '{not json',
  })
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'invalid')
})

test('retiring a rule by id shows up in the state and changes nothing else', async () => {
  const routes = mount({ config: { rules: { 'stale-turn-error': { enabled: false } } } })
  const state = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
  })
  const r1 = state.body.rules.find((rule) => rule.id === 'stale-turn-error')
  assert.equal(r1.enabled, false)
  assert.equal(r1.matches, 0)
  assert.equal(r1.verdict, 'off')
  assert.deepEqual(state.body.verdicts.off, ['stale-turn-error'])
  // The other rules are untouched by the retirement.
  const r3 = state.body.rules.find((rule) => rule.id === 'edit-turn-synthetic')
  assert.equal(r3.enabled, true)
})

// --- guards ------------------------------------------------------------------

test('a non-loopback socket is refused', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
    remoteAddress: '10.0.0.7',
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.code, 'forbidden')
})

test('a foreign Host header is refused', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
    headers: { host: 'evil.example.com' },
  })
  assert.equal(res.statusCode, 403)
})

test('a cross-origin request is refused', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
    headers: { host: '127.0.0.1:3080', origin: 'http://evil.example.com' },
  })
  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'cross-origin request')
})

test('a same-origin request is allowed', async () => {
  const routes = mount()
  const res = await call(routes, '/dsh-declutter/state', {
    url: '/dsh-declutter/state?sessionId=' + SESSION,
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
  })
  assert.equal(res.statusCode, 200)
})

test('wrong methods are refused rather than handled', async () => {
  const routes = mount()
  const state = await call(routes, '/dsh-declutter/state', {
    method: 'POST',
    url: '/dsh-declutter/state?sessionId=' + SESSION,
    body: '{}',
  })
  assert.equal(state.statusCode, 405)
  const report = await call(routes, '/dsh-declutter/report', { method: 'GET', url: '/dsh-declutter/report' })
  assert.equal(report.statusCode, 405)
})

// --- invariants --------------------------------------------------------------

test('the version is identical in package.json, the host half and the browser half', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const match = /const VERSION = '([^']+)'/.exec(client)
  assert.ok(match !== null, 'src/client.js must declare a VERSION literal')
  assert.equal(hostVersion, pkg.version)
  assert.equal(VERSION, pkg.version)
  assert.equal(match[1], pkg.version)
  assert.equal(pluginName, PLUGIN_ID)
})

/** Strip comments so the check below reads code, not prose about code. */
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('the host half exposes no way to write a session event', async () => {
  // The first principle, enforced mechanically: this plugin reads the log and
  // changes the view, and must never gain a write path by accident. Comments are
  // stripped first, because naming a forbidden service while explaining why it is
  // forbidden is fine — calling it is not.
  const host = codeOnly(await readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  for (const forbidden of ['.append(', 'surfaceOp', 'sessionController', 'deleteSession', 'SessionStore']) {
    assert.equal(host.includes(forbidden), false, 'src/index.js must not reference ' + forbidden + ' in code')
  }
  const logic = codeOnly(await readFile(new URL('../src/logic.js', import.meta.url), 'utf8'))
  for (const forbidden of ['.append(', 'surfaceOp']) {
    assert.equal(logic.includes(forbidden), false, 'src/logic.js must not reference ' + forbidden + ' in code')
  }
  const client = codeOnly(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'))
  for (const forbidden of ['.append(', 'surfaceOp']) {
    assert.equal(client.includes(forbidden), false, 'src/client.js must not reference ' + forbidden + ' in code')
  }
})
