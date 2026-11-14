// Dev probe: mount dsh-declutter on a real HTTP server and call its routes.
//
// This is NOT a test (it is not part of `node --test`) and it is not part of the
// published package. It exists so the self-check can be read against a REAL
// session log instead of a fixture, over a real loopback socket, with the real
// guards in the path.
//
//   node tools/probe-state.mjs <path-to-session.jsonl>
//
// The log is read with JSON.parse on a structured event stream — the plugin
// never parses log text, and neither does this probe.
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { apply } from '../src/index.js'

const logPath = process.argv[2]
if (logPath === undefined) {
  console.error('usage: node tools/probe-state.mjs <session.jsonl>')
  process.exit(2)
}

const lines = readFileSync(logPath, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line))
const header = lines[0] !== undefined && lines[0].type === 'session' ? lines[0] : null
const events = lines.filter((line) => line.type !== 'session')
const sessionId = header === null ? 'session-11111111-2222-3333-4444-555555555555' : header.id

// The plugin's contract with the host: a webServer with register(), and a
// sessionQuery that returns the log. Everything else is resolved lazily.
const routes = []
const webServer = {
  register: (route) => {
    routes.push(route)
    return () => {}
  },
}
const ctx = {
  effect: (fn) => {
    fn()
    return () => {}
  },
  inject: () => {},
  get: (service) => {
    if (service === 'webServer') return webServer
    if (service === 'sessionQuery') return { readSession: async () => ({ events }) }
    return undefined
  },
}
apply(ctx, {})

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const route = routes.find((candidate) => candidate.path === path)
  if (route === undefined) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, code: 'not-found' }))
    return
  }
  route.handler(req, res)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port

async function call(path, init) {
  const response = await fetch(base + path, init)
  return { status: response.status, body: await response.json() }
}

const out = {}
out.mountProbe = await call('/dsh-declutter/state')
out.state = await call('/dsh-declutter/state?sessionId=' + encodeURIComponent(sessionId))
out.report = await call('/dsh-declutter/report', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    sessionId,
    rules: Object.fromEntries(out.state.body.rules.map((rule) => [rule.id, { anchorOk: false, anchorFound: 0, applied: 0 }])),
  }),
})
out.afterReport = await call('/dsh-declutter/state?sessionId=' + encodeURIComponent(sessionId))

console.log(JSON.stringify({
  session: { id: sessionId, formatVersion: header?.version ?? null, events: events.length },
  mountProbe: { status: out.mountProbe.status, body: out.mountProbe.body },
  state: {
    status: out.state.status,
    ok: out.state.body.ok,
    plugin: out.state.body.plugin,
    version: out.state.body.version,
    live: out.state.body.live,
    verdicts: out.state.body.verdicts,
    rules: out.state.body.rules.map((rule) => ({
      id: rule.id,
      matches: rule.matches,
      lastMatchAt: rule.lastMatchAt,
      lastMatchIso: rule.lastMatchAt === null ? null : new Date(rule.lastMatchAt).toISOString(),
      anchorOk: rule.anchorOk,
      verdict: rule.verdict,
      hasView: rule.hasView,
      sample: rule.sample.slice(0, 2),
    })),
  },
  afterReport: {
    status: out.afterReport.status,
    verdicts: out.afterReport.body.verdicts,
    rules: out.afterReport.body.rules.map((rule) => ({ id: rule.id, verdict: rule.verdict, matches: rule.matches, anchorOk: rule.anchorOk })),
  },
}, null, 2))

server.close()
