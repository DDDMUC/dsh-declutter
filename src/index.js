// dsh-declutter - host half.
//
// Two loopback-only JSON routes:
//
//   GET  /dsh-declutter/state?sessionId=<id>   the per-rule self-check
//   POST /dsh-declutter/report                 the browser half's anchor health
//
// WHAT THIS PLUGIN DOES NOT DO
// ----------------------------
// It never appends, replaces or rewrites a session event. There is no write
// path to the session log anywhere in this file, and there must never be one:
// the log is the append-only record of what happened, and decluttering is
// defined as *putting parts of the derived view away*, reversibly. Every action
// this plugin takes is an attribute on a DOM node the platform owns plus a
// stylesheet keyed to that attribute.
//
// READING THE LOG
// ---------------
// Events come from the official query service (`sessionQuery.readSession`),
// never from parsing a log file, so the shapes this plugin reasons about are the
// shapes the runtime actually validated and persisted. A live Session's own
// snapshot is the fallback when the service is absent.
//
// SELF-CHECK
// ----------
// `GET /dsh-declutter/state` answers the question the plugin cannot answer about
// itself: is each rule still able to find what it claims to declutter? The host
// half knows what the log says; the browser half knows what the DOM looks like.
// Both halves are merged here, per rule, into `matches` / `lastMatchAt` /
// `anchorOk` plus a one-glance `verdict`. `verdict: 'alarm'` is the signal
// that matters: the log says there is something to hide and the view cannot
// find it.
//
// The module imports nothing from the DSH SDK: `sessions`, `sessionQuery` and
// `webServer` are resolved through the cordis context at call time, so the
// plugin loads on any profile and degrades to a clear HTTP failure when a
// service is absent. Note which services are *not* on that list — there is no
// `sessionController` here and no `append` anywhere, because opening a session
// for writing is the one thing this plugin must never be able to do. The test
// suite enforces that mechanically.
import {
  PLUGIN_ID,
  VERSION,
  isEnabled,
  optionsOf,
  resolveConfig,
  ruleTable,
  runRules,
} from './logic.js'

export const name = PLUGIN_ID
export const version = VERSION

const ROUTE_PREFIX = '/dsh-declutter'
const SESSION_ID_RE = /^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How many sessions' worth of view-side reports to retain. */
const REPORT_CAPACITY = 64

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

// A session id travels in two spellings: the raw uuid and `session-<uuid>`.
// The store, the persistence directories and the workspace rows disagree about
// which one they hold, so every lookup tries both.
function idVariants(sessionId) {
  const out = new Set([sessionId])
  if (sessionId.startsWith('session-')) out.add(sessionId.slice('session-'.length))
  else out.add('session-' + sessionId)
  return [...out]
}

function findLiveSession(ctx, sessionId) {
  const sessions = ctx.get('sessions')
  if (!sessions || typeof sessions.get !== 'function') return undefined
  for (const variant of idVariants(sessionId)) {
    const found = sessions.get(variant)
    if (found) return found
  }
  return undefined
}

function eventsFromLive(session) {
  if (session && typeof session.snapshotEvents === 'function') {
    try {
      const events = session.snapshotEvents()
      if (Array.isArray(events)) return events
    } catch {
      // fall through to the query service
    }
  }
  return undefined
}

/** Live-preferred read through the public query service. */
async function readEvents(ctx, sessionId) {
  const query = ctx.get('sessionQuery')
  if (query && typeof query.readSession === 'function') {
    try {
      const snapshot = await query.readSession(sessionId)
      if (snapshot && Array.isArray(snapshot.events)) return snapshot.events
    } catch {
      // fall through to the live snapshot
    }
  }
  const events = eventsFromLive(findLiveSession(ctx, sessionId))
  return events ?? null
}

// --- the browser half's report ----------------------------------------------

/**
 * Last view-side report per session.
 *
 * The host cannot see the DOM, so anchor health is something the browser half
 * has to tell it. The store is deliberately tiny and lossy — it holds only the
 * most recent report per rule — because it exists to answer "is the selector
 * still pointing at something", not to keep history.
 */
function createReportStore() {
  const bySession = new Map()
  return {
    put(sessionId, report) {
      const at = Date.now()
      const rules = {}
      if (report && typeof report.rules === 'object' && report.rules !== null) {
        for (const [id, value] of Object.entries(report.rules)) {
          if (value === null || typeof value !== 'object') continue
          rules[id] = {
            anchorOk: typeof value.anchorOk === 'boolean' ? value.anchorOk : null,
            anchorFound: typeof value.anchorFound === 'number' ? value.anchorFound : null,
            applied: typeof value.applied === 'number' ? value.applied : null,
            at,
          }
        }
      }
      // Re-inserting moves the key to the tail, so the first key is the coldest.
      bySession.delete(sessionId)
      bySession.set(sessionId, rules)
      while (bySession.size > REPORT_CAPACITY) {
        const oldest = bySession.keys().next()
        if (oldest.done) break
        bySession.delete(oldest.value)
      }
      return { rules: Object.keys(rules).length, at }
    },
    get(sessionId) {
      return bySession.get(sessionId) ?? {}
    },
    size() {
      return bySession.size
    },
  }
}

// --- state -------------------------------------------------------------------

/**
 * Build the self-check payload for one session.
 * @param ctx - cordis context.
 * @param sessionId - raw or prefixed session id.
 * @param reports - the view-side report store.
 * @param resolved - resolved plugin config.
 * @returns the `/state` body, without the outer `ok`.
 */
async function stateOf(ctx, sessionId, reports, resolved) {
  const events = await readEvents(ctx, sessionId)
  if (!events) throw new HttpError(404, 'session-not-found', 'no session log for this id')
  const report = reports.get(sessionId)
  const rules = runRules(events, resolved, report)
  return {
    plugin: PLUGIN_ID,
    version: VERSION,
    sessionId,
    live: Boolean(findLiveSession(ctx, sessionId)),
    events: events.length,
    // The rule table travels with the state so the browser half is a generic
    // executor: it applies whatever descriptors it is handed. That is what keeps
    // "add a rule" a one-file change.
    ruleTable: ruleTable(),
    verdicts: {
      alarm: rules.filter((rule) => rule.verdict === 'alarm').map((rule) => rule.id),
      broken: rules.filter((rule) => rule.verdict === 'broken').map((rule) => rule.id),
      quiet: rules.filter((rule) => rule.verdict === 'quiet').map((rule) => rule.id),
      off: rules.filter((rule) => rule.verdict === 'off').map((rule) => rule.id),
      hostOnly: rules.filter((rule) => rule.verdict === 'host-only').map((rule) => rule.id),
    },
    rules,
    reportedAt: Object.values(report).reduce((latest, entry) => (entry && typeof entry.at === 'number' && (latest === null || entry.at > latest) ? entry.at : latest), null),
    unknownRuleConfig: resolved.unknown,
  }
}

// --- http --------------------------------------------------------------------

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

function isLocalHostHeader(host) {
  if (typeof host !== 'string' || host.length === 0) return false
  const name = host.split(':')[0].replace(/^\[|\]$/g, '').toLowerCase()
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The browser half reads this from the same origin; no store anywhere.
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
    req.on('aborted', () => reject(new Error('aborted')))
  })
}

// Loopback socket, loopback Host header, and a same-origin check when the
// browser sends Origin. This plugin mutates nothing, but it reports on a
// session's contents, so it stays off the network just the same.
function guard(req, res) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'loopback only' })
    return false
  }
  const host = req.headers.host
  if (!isLocalHostHeader(host)) {
    sendJson(res, 403, { ok: false, code: 'forbidden', error: 'unexpected host' })
    return false
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    let originHost = null
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = null
    }
    if (originHost !== host) {
      sendJson(res, 403, { ok: false, code: 'forbidden', error: 'cross-origin request' })
      return false
    }
  }
  return true
}

function sessionIdFromQuery(url) {
  try {
    const value = new URL(url, 'http://localhost').searchParams.get('sessionId') || ''
    return value.trim()
  } catch {
    return ''
  }
}

// The mount probe convention: a bare GET /state answers 400 when the plugin is
// installed and 404 when it is not, so the browser half can tell "not mounted
// here" from "not installed at all" with a single request.
function requireSessionId(value) {
  if (!value) throw new HttpError(400, 'invalid', 'sessionId required')
  if (!SESSION_ID_RE.test(value)) throw new HttpError(400, 'invalid', 'invalid session id')
  return value
}

function failure(res, error) {
  const status = error instanceof HttpError ? error.status : 500
  const code = error instanceof HttpError ? error.code : 'internal'
  sendJson(res, status, { ok: false, code, error: String((error && error.message) || error) })
}

// --- plugin ------------------------------------------------------------------

/**
 * Mount the plugin.
 * @param ctx - cordis context.
 * @param config - `{ rules: { <id>: { enabled, options } } }`.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const reports = createReportStore()

  const registerRoutes = (webServer, fiber) => {
    fiber.effect(() =>
      webServer.register({
        kind: 'exact',
        path: ROUTE_PREFIX + '/state',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          if (req.method !== 'GET') {
            sendJson(res, 405, { ok: false, code: 'method', error: 'GET only' })
            return
          }
          try {
            const sessionId = requireSessionId(sessionIdFromQuery(req.url))
            sendJson(res, 200, { ok: true, ...(await stateOf(ctx, sessionId, reports, resolved)) })
          } catch (error) {
            failure(res, error)
          }
        },
      }),
    )

    fiber.effect(() =>
      webServer.register({
        kind: 'exact',
        path: ROUTE_PREFIX + '/report',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, code: 'method', error: 'POST only' })
            return
          }
          let body = {}
          try {
            const raw = await readBody(req)
            if (raw) body = JSON.parse(raw)
          } catch {
            sendJson(res, 400, { ok: false, code: 'invalid', error: 'malformed JSON body' })
            return
          }
          try {
            const sessionId = requireSessionId(typeof body.sessionId === 'string' ? body.sessionId.trim() : '')
            const stored = reports.put(sessionId, body)
            sendJson(res, 200, { ok: true, ...stored })
          } catch (error) {
            failure(res, error)
          }
        },
      }),
    )
  }

  const webServer = ctx.get('webServer')
  if (webServer) {
    registerRoutes(webServer, ctx)
  } else {
    ctx.inject(['webServer'], (sub) => registerRoutes(sub.webServer, sub))
  }
}

// Re-exported so a caller can ask the running plugin what its table says
// without going through HTTP (tests use this).
export { RULES, ruleTable, runRules, resolveConfig, isEnabled, optionsOf } from './logic.js'
