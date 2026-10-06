// dsh-declutter - browser half.
//
// This half is a GENERIC RULE EXECUTOR. It does not know what `stale-turn-error`
// means and contains no branch for any specific rule. It fetches the rule table
// from the host (`GET /dsh-declutter/state`), and for each rule that carries a
// `view` descriptor it does exactly three things:
//
//   find     querySelectorAll(descriptor.anchor)
//   resolve  climb to the element that carries the turn number, and check the
//            descriptor's guard so two notices sharing one CSS class stay apart
//   adopt    mark the node with namespaced attributes and, if the rule asks for
//            one, inject a namespaced control
//
// Adding a rule is therefore a change to src/logic.js alone. Nothing here needs
// to know about it.
//
// WHY THE VIEW HALF IS BUILT THIS CAREFULLY
// -----------------------------------------
// Every DSH style is a CSS-module hash (`Sixlwa_turnErrorRow`) and the hash
// prefix is regenerated on every build. A selector written against the full
// class name is guaranteed to rot. Rules therefore anchor on a *local* name
// fragment (`[class*="_turnErrorRow"]`) or, better, on a `data-*` attribute,
// and the host's self-check reports whether each anchor still resolves. This
// half is the reporting end of that loop: after every sweep it tells the host
// how many nodes its anchors found and how many it acted on.
//
// DOM OWNERSHIP
// -------------
// The platform owns every node here and React re-renders them constantly. This
// half therefore:
//   * ADOPTS nodes instead of rebuilding them — it never replaces, moves or
//     removes a node the platform owns, and never clears an attribute it did not
//     set;
//   * owns exactly one namespace, `data-dshdc-*`, plus elements carrying it;
//   * is IDEMPOTENT and re-appliable: a sweep may run hundreds of times over the
//     same DOM and the result is the same single marker per node. That matters
//     because the trajectory view is a virtual list which discards and recreates
//     rows as the user scrolls, so injection has to be re-applied after every
//     change rather than done once;
//   * gives up cleanly: unload removes its own markers and nothing else.
//
// The module is a classic client bundle (client-modules protocol): it registers
// a factory with window.__ModuleLoader__ and returns apply().
window.__ModuleLoader__.load({
  id: 'dsh-declutter',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    const NS = 'dsh-declutter'
    const VERSION = '0.1.0'
    const ROUTE_PREFIX = '/dsh-declutter'
    // Same cadence the sibling plugins use for transcript polling.
    const REFRESH_INTERVAL_MS = 3000
    // How often the view side is allowed to tell the host about its anchors.
    const REPORT_INTERVAL_MS = 2000

    // --- copy -----------------------------------------------------------------

    const zh = {
      'toggle.collapsed': '本轮运行失败（后续已成功，提示已收起）',
      'toggle.expand': '展开这条过期提示',
      'toggle.expanded': '收起这条过期提示',
      'badge.editTurn': '由回答编辑产生',
    }

    const en = {
      'toggle.collapsed': 'This turn failed, then succeeded later (notice collapsed)',
      'toggle.expand': 'Expand this stale failure notice',
      'toggle.expanded': 'Collapse this stale failure notice',
      'badge.editTurn': 'Produced by answer editing',
    }

    // --- style ----------------------------------------------------------------
    //
    // The collapse is driven by an attribute on a node the platform owns, not by
    // rewriting that node's children. React re-renders the children; it does not
    // manage `data-dshdc-*`, so the collapsed state survives every re-render.

    const CSS = [
      '[data-dshdc-collapsed="1"] > *:not([data-dshdc-toggle]){display:none!important}',
      '.dshdc-toggle{grid-column:1/-1;display:inline-flex;align-items:center;gap:6px;padding:2px 0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8f98);font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));cursor:pointer;text-align:left}',
      '.dshdc-toggle:hover{color:var(--dsw-alias-label-secondary,#61666d)}',
      '.dshdc-toggle:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px;border-radius:var(--dsw-radius-sm,4px)}',
      '.dshdc-toggle::before{content:"";flex:none;width:6px;height:6px;border-bottom:1.5px solid currentColor;border-right:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .12s}',
      '[data-dshdc-collapsed="1"] > .dshdc-toggle::before{transform:rotate(45deg)}',
      '.dshdc-badge{display:inline-flex;align-items:center;margin-left:8px;padding:0 5px;border-radius:var(--dsw-radius-xs,3px);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.14));color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:10px;line-height:16px;white-space:nowrap;vertical-align:middle}',
      '@media (prefers-reduced-motion:reduce){.dshdc-toggle::before{transition:none}}',
    ].join('')

    const TAG_ID = 'dsh-declutter/declutter.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(TAG_ID) + ']') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // --- namespace helpers ----------------------------------------------------
    // One place decides what this plugin owns, so teardown can never reach a
    // node it did not create.

    /** Every attribute this plugin may set on a node it does not own. */
    const OWNED_ATTRS = ['data-dshdc-rule', 'data-dshdc-turn', 'data-dshdc-collapsed', 'data-dshdc-surface']

    /** Every element this plugin may inject. */
    const OWNED_SELECTOR = '[data-dshdc-toggle],[data-dshdc-badge]'

    function adopt(node, ruleId, turn) {
      node.setAttribute('data-dshdc-rule', ruleId)
      node.setAttribute('data-dshdc-turn', String(turn))
    }

    /** Undo everything this plugin did to one node, and nothing else. */
    function release(node) {
      for (const attr of OWNED_ATTRS) node.removeAttribute(attr)
      for (const child of node.querySelectorAll(':scope > ' + OWNED_SELECTOR)) child.remove()
    }

    /** Remove every trace of this plugin from the document. */
    function sweepInjectedNodes(root) {
      const scope = root ?? (typeof document === 'undefined' ? null : document)
      if (scope === null) return 0
      let removed = 0
      for (const node of scope.querySelectorAll(OWNED_SELECTOR)) {
        node.remove()
        removed += 1
      }
      for (const attr of OWNED_ATTRS) {
        for (const node of scope.querySelectorAll('[' + attr + ']')) {
          node.removeAttribute(attr)
          removed += 1
        }
      }
      return removed
    }

    // --- surface mounting -----------------------------------------------------
    // Anchor health is only meaningful when the surface is on screen at all.
    // When it is not, the honest answer is "unknown", not "broken".

    const SURFACE_MOUNT = {
      chat: () => document.querySelector('[data-chat-turn]') !== null,
      trajectory: () =>
        document.querySelector('[data-trajectory-row-key]') !== null ||
        document.querySelector('[data-virtual-spacer]') !== null,
    }

    function surfaceMounted(surface) {
      const probe = SURFACE_MOUNT[surface]
      if (typeof probe !== 'function') return false
      try {
        return probe()
      } catch {
        return false
      }
    }

    // --- the executor ---------------------------------------------------------

    /**
     * Resolve the turn number a rule's node belongs to.
     *
     * Two descriptor shapes are supported, and both come from the host's table:
     *   turnAttr   the attribute carrying the number, read from the closest
     *              ancestor matching `scope`
     *   turnProbe  a descendant whose text matches `turnPattern`; used where the
     *              platform publishes the number only as rendered text
     * @returns the turn number, or null when it cannot be read.
     */
    function readTurn(node, view) {
      if (typeof view.turnAttr === 'string' && view.scope) {
        const scope = node.closest(view.scope)
        if (scope === null) return null
        const raw = scope.getAttribute(view.turnAttr)
        if (raw === null) return null
        const turn = Number(raw)
        return Number.isSafeInteger(turn) && turn >= 0 ? turn : null
      }
      if (typeof view.turnProbe === 'string' && typeof view.turnPattern === 'string') {
        const probe = node.querySelector(view.turnProbe)
        if (probe === null) return null
        let pattern
        try {
          pattern = new RegExp(view.turnPattern)
        } catch {
          return null
        }
        const match = pattern.exec((probe.textContent ?? '').trim())
        if (match === null) return null
        const turn = Number(match[1])
        return Number.isSafeInteger(turn) && turn >= 0 ? turn : null
      }
      return null
    }

    /** The set of turn numbers a rule's host half currently reports as matches. */
    function wantedTurns(ruleState) {
      const out = new Set()
      for (const key of ruleState.keys ?? []) {
        if (typeof key !== 'string' || !key.startsWith('turn:')) continue
        const turn = Number(key.slice('turn:'.length))
        if (Number.isSafeInteger(turn) && turn >= 0) out.add(turn)
      }
      return out
    }

    function labelFor(view, key, fallback) {
      const labels = view.labels
      if (labels && typeof labels[key] === 'string') return labels[key]
      return fallback
    }

    /** Bring one toggle's label and ARIA state in line with the node it owns. */
    function syncToggle(node, toggle, view, t, turn) {
      const collapsed = node.getAttribute('data-dshdc-collapsed') === '1'
      const label = collapsed
        ? labelFor(view, 'collapsed', t('toggle.collapsed'))
        : labelFor(view, 'expanded', t('toggle.expanded'))
      if (toggle.textContent !== label) toggle.textContent = label
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
      toggle.setAttribute('title', collapsed ? t('toggle.expand') : t('toggle.expanded'))
      toggle.setAttribute('data-dshdc-turn', String(turn))
    }

    /**
     * Adopt one node on behalf of one rule.
     * Idempotent by construction: an already-adopted node is only re-synced.
     * @returns whether the node ended up carrying this rule's marker.
     */
    function adoptNode(node, ruleState, turn, t) {
      const view = ruleState.view
      adopt(node, ruleState.id, turn)

      if (view.action === 'collapse') {
        // Default to collapsed unless the user has already expanded it: a
        // re-render must not undo a deliberate click.
        if (node.getAttribute('data-dshdc-collapsed') === null) {
          node.setAttribute('data-dshdc-collapsed', '1')
        }
        let toggle = node.querySelector(':scope > [data-dshdc-toggle]')
        if (toggle === null) {
          toggle = document.createElement('button')
          toggle.type = 'button'
          toggle.className = 'dshdc-toggle'
          toggle.setAttribute('data-dshdc-toggle', '1')
          toggle.setAttribute('data-dshdc-rule', ruleState.id)
          // Attached once, at creation. A button the platform discarded takes
          // its listener with it, and the next sweep creates both together, so
          // there is never a button without a handler or two handlers on one.
          toggle.addEventListener('click', (event) => {
            event.preventDefault()
            const collapsed = node.getAttribute('data-dshdc-collapsed') === '1'
            node.setAttribute('data-dshdc-collapsed', collapsed ? '0' : '1')
            syncToggle(node, toggle, view, t, turn)
          })
          node.insertBefore(toggle, node.firstChild)
        }
        syncToggle(node, toggle, view, t, turn)
        return true
      }

      if (view.action === 'annotate') {
        const host = node.querySelector('td:last-of-type') ?? node.querySelector('td') ?? node
        let badge = host.querySelector(':scope > [data-dshdc-badge][data-dshdc-rule="' + ruleState.id + '"]')
        if (badge === null) {
          badge = document.createElement('span')
          badge.className = 'dshdc-badge'
          badge.setAttribute('data-dshdc-badge', '1')
          badge.setAttribute('data-dshdc-rule', ruleState.id)
          badge.setAttribute('data-dshdc-turn', String(turn))
          badge.textContent = labelFor(view, 'badge', t('badge.editTurn'))
          host.appendChild(badge)
        }
        return true
      }

      // An action this build does not implement: mark it, change nothing else,
      // and let the host's self-check show it as adopted-but-inert rather than
      // pretending it worked.
      return false
    }

    /**
     * Run every rule that has a view descriptor over the current DOM.
     * @returns `{ rules: { <id>: { anchorOk, anchorFound, applied } } }`
     */
    function sweep(rules, t) {
      const report = {}
      for (const ruleState of rules) {
        const view = ruleState.view
        if (view === null || typeof view !== 'object') continue
        const surface = typeof view.surface === 'string' ? view.surface : 'chat'
        const mounted = surfaceMounted(surface)
        const nodes = document.querySelectorAll(view.anchor)
        const wanted = wantedTurns(ruleState)
        let applied = 0
        // A node the platform re-rendered may still carry a stale marker from a
        // previous sweep; release it whenever it stops matching, so nothing is
        // left collapsed that should not be.
        for (const node of document.querySelectorAll('[data-dshdc-rule="' + ruleState.id + '"]')) {
          if (node.matches(OWNED_SELECTOR)) continue
          const turn = readTurn(node, view)
          const stillWanted = turn !== null && wanted.has(turn) && (view.guard === undefined || view.guard === null || node.closest(view.guard) !== null)
          if (!stillWanted) release(node)
        }
        if (mounted) {
          for (const node of nodes) {
            const turn = readTurn(node, view)
            if (turn === null) continue
            if (view.guard !== undefined && view.guard !== null && node.closest(view.guard) === null) continue
            if (!wanted.has(turn)) continue
            if (adoptNode(node, ruleState, turn, t)) applied += 1
          }
        }
        report[ruleState.id] = {
          // null is "the surface is not on screen, so I cannot say". A boolean
          // false is the report the host turns into an alarm.
          anchorOk: mounted ? nodes.length > 0 : null,
          anchorFound: nodes.length,
          applied: mounted ? applied : 0,
        }
      }
      return { rules: report, at: Date.now() }
    }

    // --- controller -----------------------------------------------------------

    class DeclutterController {
      constructor(sessionId) {
        this.sessionId = sessionId
        this.rules = []
        this.loaded = false
        this.loadError = null
        this.detached = false
        this.scheduled = false
        this.lastReportAt = 0
        this.lastReportKey = ''
        this.observer = null
        this.timer = null
      }

      async load() {
        const response = await fetch(ROUTE_PREFIX + '/state?sessionId=' + encodeURIComponent(this.sessionId), {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
        // 400 means the route is mounted but this request was rejected; 404 means
        // the plugin is not installed at all. Both leave the view untouched.
        if (!response.ok) throw new Error('state ' + response.status)
        const body = await response.json()
        if (!body || body.ok !== true || !Array.isArray(body.rules)) throw new Error('malformed state')
        // Only rules that are enabled AND carry a view descriptor are executed.
        this.rules = body.rules.filter((rule) => rule.enabled === true && rule.view !== null && rule.view !== undefined)
        this.loaded = true
        this.loadError = null
      }

      /** Schedule one sweep on the next animation frame; many calls, one run. */
      schedule() {
        if (this.detached || this.scheduled) return
        this.scheduled = true
        const run = () => {
          this.scheduled = false
          this.run()
        }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
        else window.setTimeout(run, 16)
      }

      run() {
        if (this.detached || !this.loaded) return
        let result
        try {
          result = sweep(this.rules, (key) => (key.startsWith('badge.') ? en[key] : zh[key]) ?? key)
        } catch (error) {
          this.loadError = String((error && error.message) || error)
          return
        }
        this.report(result)
      }

      /**
       * Tell the host what the view side can see. Throttled and keyed on the
       * payload so an idle transcript costs nothing.
       */
      report(result) {
        const now = Date.now()
        const key = JSON.stringify(result.rules)
        if (key === this.lastReportKey) return
        if (now - this.lastReportAt < REPORT_INTERVAL_MS) return
        this.lastReportAt = now
        this.lastReportKey = key
        fetch(ROUTE_PREFIX + '/report', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: this.sessionId, version: VERSION, rules: result.rules }),
        }).catch(() => {
          // Reporting is best-effort: a failed report must never disturb the view.
        })
      }

      attach() {
        this.detached = false
        const kick = () => {
          this.load()
            .then(() => this.schedule())
            .catch((error) => {
              this.loadError = String((error && error.message) || error)
            })
        }
        kick()
        this.timer = window.setInterval(() => {
          // Polling an off-screen tab is pure cost; resume on the next visible tick.
          if (typeof document !== 'undefined' && document.hidden === true) return
          kick()
        }, REFRESH_INTERVAL_MS)

        // The trajectory view is a virtual list: it discards rows and creates new
        // ones as the user scrolls, so a marker placed once is gone almost
        // immediately. Watching the subtree and re-running an idempotent sweep is
        // what makes injection stable there.
        this.observer = new MutationObserver((records) => {
          for (const record of records) {
            // Ignore this plugin's own writes, otherwise every sweep schedules
            // the next one forever.
            if (typeof record.attributeName === 'string' && record.attributeName.startsWith('data-dshdc')) continue
            this.schedule()
            return
          }
        })
        this.observer.observe(document.body, { childList: true, subtree: true, attributes: true })

        return () => this.detach()
      }

      detach() {
        this.detached = true
        if (this.observer !== null) {
          this.observer.disconnect()
          this.observer = null
        }
        if (this.timer !== null) {
          window.clearInterval(this.timer)
          this.timer = null
        }
      }
    }

    // --- react seat -----------------------------------------------------------
    // A headless seat: it exists to own the per-session controller lifecycle and
    // to be handed the session id by the slot. It renders one hidden span so the
    // slot root carries this plugin's namespace; that span belongs to React and
    // the teardown sweep must not touch it.

    function DeclutterSeat({ controller, t }) {
      react.useEffect(() => controller.attach(), [controller])
      return react.createElement('span', { hidden: true, 'data-dshdc-seat': '1' })
    }

    // --- plugin ---------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-declutter: dictionaries')

      const controllers = new Map()
      const controllerFor = (sessionId) => {
        let controller = controllers.get(sessionId)
        if (controller === undefined) {
          controller = new DeclutterController(sessionId)
          controllers.set(sessionId, controller)
        }
        return controller
      }
      ctx.effect(
        () => () => {
          for (const controller of controllers.values()) controller.detach()
          controllers.clear()
        },
        'dsh-declutter: per-session controllers',
      )

      // A re-apply runs over a page the previous apply already decorated. Only
      // nodes carrying this plugin's own namespace are removed.
      ctx.effect(() => () => sweepInjectedNodes(), 'dsh-declutter: injected nodes')

      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'declutter',
            order: 90,
            locale: NS,
            inject: (sessionId) => ({ controller: controllerFor(sessionId) }),
          },
          DeclutterSeat,
        ),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale']
    exports.version = VERSION
    // Exported for the view-side unit tests, which run this file against a
    // minimal DOM stub instead of a browser.
    exports.__test = { sweep, sweepInjectedNodes, adoptNode, readTurn, wantedTurns, surfaceMounted, DeclutterController, NS, VERSION }
    return module.exports
  },
})
