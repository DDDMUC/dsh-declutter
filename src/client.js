// dsh-sidebar-declutter — client half.
//
// Each row is rendered straight into the layout by a shipped package, so none of
// them is a slot registration and no config switch exists for any of them:
//
// * `_newSession` — the sidebar's "New session" button (ui-sidebar). It sits in
//   the normal column flow with no wrapper (its Tooltip clones the button), so
//   `display:none` takes it — and its margin — out of layout and the panel list
//   below moves up into the freed row.
// * `_moreAnchor` in `_panelList` — the sidebar panel list's "More" launcher. It
//   renders only while `sidebar.panellist.actions` has registrations (today one,
//   from entry-customization), and that menu is the only place a panel can be
//   pinned or unpinned, so hiding it retires that control too.
// * `_moreAnchor` in `[data-sidebar-right-guide]` — the right column's start-page
//   "More". Same local class name as the sidebar's, in a different CSS module
//   (`F6Huca_moreAnchor` vs `kB3qhq_moreAnchor`), which is why every rule here is
//   scoped by an ancestor instead of matching the bare suffix.
// * `_viewsMore` — the Session header View row's launcher; an ellipsis icon, so
//   its aria-label says "More" while the page shows no such text.
//
// Selectors key on CSS-module local suffixes, never on the build-hashed prefix
// (`kB3qhq_newSession` today): the prefix changes on every build.
//
// Settings live in localStorage rather than the loader Config: the entry needs no
// Host schema, changes apply without a restart, and every surface reads one store.
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-declutter',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /**
     * Bisect switch: the settings card is the only thing this bundle contributes
     * to the plugins page, so it can be taken out while that page is investigated.
     */
    const ENABLE_ROW_CONFIG = true

    /** Row-config key: `<bundle package>#<row id from the bundle patch>`. */
    const ROW_CONFIG_KEY = 'dsh-sidebar-declutter#hide-rows'
    const STORE_KEY = 'dsh-sidebar-declutter'
    /** Key this bundle stored its settings under before the rename. */
    const LEGACY_STORE_KEY = 'dsh-hide-new-session'
    const STYLE_ATTR = 'data-dsh-sidebar-declutter'

    /**
     * The page groups its switches under headings; the flat `FIELDS` below is
     * derived from them, so the store, the summary and the rules keep iterating
     * one list while the page renders sections.
     */
    const SECTIONS = [
      {
        kind: 'hide',
        title: '左栏',
        panels: true,
        columns: 3,
        fields: [
          { key: 'brand', title: '顶部品牌行（deepseek HARNESS）' },
          { key: 'newSession', title: '「新会话」按钮' },
          { key: 'sidebarMore', title: '左栏面板列表的「更多」' },
        ],
      },
      {
        kind: 'hide',
        title: '其它位置',
        columns: 2,
        fields: [
          { key: 'rightMore', title: '右侧栏起始页的「更多」' },
          { key: 'headerMore', title: '会话头部 View 行的「更多」' },
        ],
      },
      {
        kind: 'layout',
        title: '排布',
        fields: [
          {
            key: 'panelLayout',
            type: 'choice',
            inline: true,
            options: [
              { value: 'stack', title: '一列' },
              { value: 'two', title: '两列' },
              { value: 'wrap', title: '自动紧凑' },
            ],
          },
        ],
      },
      {
        kind: 'menu',
        title: '会话菜单',
        hint: '打开一次会话菜单（右键会话行）后，这里会列出这份构建真正渲染过的条目；勾上即隐藏，取消即恢复。',
        fields: [],
      },
      {
        kind: 'picked',
        title: '自由隐藏',
        hint: '点「开始点选」，再点界面上任意一个元素——它会作为一个条目出现在下面，勾上才隐藏。',
        fields: [],
      },
    ]

    /** Flat view of every switch, in page order, tagged with its section. */
    const FIELDS = SECTIONS.flatMap((section) =>
      section.fields.map((field) => ({ ...field, kind: section.kind })),
    )

    /** Defaults match the state this plugin shipped with before the switches. */
    const DEFAULTS = {
      brand: true,
      newSession: true,
      panelLayout: 'two',
      sidebarMore: true,
      rightMore: true,
      headerMore: false,
      /** The bulk layer the footer button drives; never persisted. */
      collapsedAll: false,
      /** Elements picked by hand: `[{ selector, label }]`. */
      picked: [],
      /** Panel ids (from `sidebar.panellist`) the user ticked off. */
      hiddenPanels: [],
      /** Panel ids in the order the user dragged them into. */
      panelOrder: [],
    }

    /** Accepted values of the layout choice, keyed by field. */
    const CHOICES = {}
    for (const field of FIELDS) {
      if (field.type === 'choice') CHOICES[field.key] = field.options.map((option) => option.value)
    }

    let values = { ...DEFAULTS }
    const listeners = new Set()

    function readStore() {
      const next = { ...DEFAULTS }
      try {
        const raw = localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_STORE_KEY)
        if (raw === null) return next
        const parsed = JSON.parse(raw)
        for (const field of FIELDS) {
          const stored = parsed?.[field.key]
          if (field.type === 'choice') {
            if (CHOICES[field.key].includes(stored)) next[field.key] = stored
            continue
          }
          if (typeof stored === 'boolean') next[field.key] = stored
        }
        // `panelGrid` was the boolean this setting shipped as before it became a
        // three-way choice; keep an existing preference instead of resetting it.
        if (Array.isArray(parsed?.picked)) {
          next.picked = parsed.picked.filter(
            (one) => one && typeof one.selector === 'string' && one.selector.trim() !== '',
          )
        }
        if (Array.isArray(parsed?.hiddenPanels)) {
          next.hiddenPanels = parsed.hiddenPanels.filter((one) => typeof one === 'string')
        }
        if (Array.isArray(parsed?.panelOrder)) {
          next.panelOrder = parsed.panelOrder.filter((one) => typeof one === 'string')
        }
        if (parsed?.panelLayout === undefined && typeof parsed?.panelGrid === 'boolean') {
          // `panelGrid` was introduced meaning "two per row" before it briefly
          // meant "wrap"; `true` keeps the two-column reading.
          next.panelLayout = parsed.panelGrid ? 'two' : 'stack'
        }
      } catch {
        // Stored junk falls back to the defaults instead of breaking boot.
      }
      return next
    }

    function writeStore() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(values))
      } catch {
        // Private mode: the switch still applies for this page.
      }
    }

    // --- menu rows: free hiding -------------------------------------------------
    //
    // Menu rows are not slots a plugin can drop; the shipped ones are rendered by
    // the product and only `display: none` takes them away. Which rows exist is
    // discovered from real menu opens (label + accelerator), so the page lists
    // what this build really renders. Nothing is hidden until it is ticked.

    const MENU_STORE_KEY = 'dsh-sidebar-declutter.menu'
    const MENU_STORE_VERSION = 2
    const MENU_HIDDEN_ATTR = 'data-dsd-menu-hidden'

    /**
     * The Session menu's shipped rows, listed up front so nothing has to be
     * opened once before it can be ticked. Each rule matches the row's text at
     * its start, so a trailing accelerator or a language switch still hits.
     * Rows this build renders that are not listed here are appended by discovery.
     */
    const MENU_PRESETS = [
      { key: '重命名', accel: 'Ctrl+Alt+G', rule: /^(重命名|Rename)/, aria: ['Control+Alt+G', 'Ctrl+Alt+G', '⌘+⌥+G'] },
      { key: '归档会话', accel: '', rule: /^(归档会话|Archive)/, aria: ['Control+Shift+A', 'Ctrl+Shift+A', '⌘+⇧+A'] },
      { key: '取消归档', accel: '', rule: /^(取消归档|Unarchive)/, aria: [] },
      { key: '置顶会话', accel: '', rule: /^(置顶会话|Pin)/, aria: [] },
      { key: '取消置顶', accel: '', rule: /^(取消置顶|Unpin)/, aria: [] },
    ]

    /**
     * Rows that carry an accelerator can be hidden by CSS, before the menu is ever
     * painted — no timing to lose. Rows without one still go through the DOM sweep.
     */
    function menuCssRules() {
      const rules = []
      for (const preset of MENU_PRESETS) {
        if (!menuState.hidden.includes(preset.key)) continue
        for (const aria of preset.aria) {
          rules.push(`[role="menuitem"][aria-keyshortcuts="${aria}"]{display:none!important}`)
        }
      }
      return rules
    }

    /** @type {{ hidden: string[], seen: { key: string, accel: string }[] }} */
    let menuState = { hidden: [], seen: [] }

    function readMenuState() {
      try {
        const parsed = JSON.parse(localStorage.getItem(MENU_STORE_KEY) || 'null')
        if (!parsed) return
        const hidden = Array.isArray(parsed.hidden)
          ? parsed.hidden.filter((one) => typeof one === 'string')
          : []
        // v1 recorded rows from every menu on the desktop — including the system
        // "open with" list — so its `seen` is thrown away, keeping the switches.
        const seen = parsed.version === MENU_STORE_VERSION && Array.isArray(parsed.seen)
          ? parsed.seen.filter((one) => one && typeof one.key === 'string')
          : []
        menuState = { hidden, seen }
        if (parsed.version !== MENU_STORE_VERSION) writeMenuState()
      } catch {
        // Private mode: the switches still apply for this page.
      }
    }

    function writeMenuState() {
      try {
        localStorage.setItem(
          MENU_STORE_KEY,
          JSON.stringify({ version: MENU_STORE_VERSION, hidden: menuState.hidden, seen: menuState.seen }),
        )
      } catch {
        // Same.
      }
    }

    /** True when a stored row id is really one of the presets (a legacy record). */
    function isPresetMenuKey(key) {
      return MENU_PRESETS.some((one) => one.rule.test(key))
    }

    /** A row's identity: a preset name when one matches, else its normalized text. */
    function menuRowKey(item) {
      const text = (item.textContent || '').replace(/\s+/g, ' ').trim()
      for (const preset of MENU_PRESETS) {
        if (preset.rule.test(text)) return preset.key
      }
      return text
    }

    /** True when this row is one of the shipped Session actions. */
    function isSessionMenuItem(item) {
      const text = (item.textContent || '').replace(/\s+/g, ' ').trim()
      return MENU_PRESETS.some((one) => one.rule.test(text))
    }

    function menuSweep() {
      // `[role="menuitem"]` is used by every menu on the desktop — the system
      // "open with" list included. A menu only counts when it carries a shipped
      // Session action, so unrelated lists are never read and never recorded.
      const groups = new Map()
      for (const item of document.querySelectorAll('[role="menuitem"]')) {
        const root = item.closest('[role="menu"]') || item.parentElement
        if (root === null) continue
        const list = groups.get(root)
        if (list === undefined) groups.set(root, [item])
        else list.push(item)
      }
      let added = false
      for (const items of groups.values()) {
        if (!items.some((item) => isSessionMenuItem(item))) continue
        for (const item of items) {
          // A marked node was already handled in this batch. The next menu open
          // mounts a fresh set, so "unhide after unticking" needs no bookkeeping.
          if (item.hasAttribute(MENU_HIDDEN_ATTR)) continue
          const key = menuRowKey(item)
          if (!key) continue
          // Only a menu opened from a Session row is recorded: that is what keeps
          // unrelated lists (the system "open with" menu) out of the settings page.
          if (menuFromSessionRow && !menuState.seen.some((one) => one.key === key)) {
            menuState.seen.push({ key, accel: item.getAttribute('aria-keyshortcuts') || '' })
            added = true
          }
          if (!menuState.hidden.includes(key)) continue
          item.setAttribute(MENU_HIDDEN_ATTR, '')
          item.style.display = 'none'
        }
      }
      if (added) {
        writeMenuState()
        notify()
      }
    }

    let menuObserver = null
    let menuObserverTimer = 0
    let menuSweepQueued = false

    /** Coalesce a burst of mutations into one sweep, before the next paint. */
    function menuQueueSweep() {
      if (menuSweepQueued) return
      menuSweepQueued = true
      const run = () => {
        menuSweepQueued = false
        menuSweep()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 0)
    }

    /**
     * Watch for the menu's first insertion instead of waiting for it. The observer
     * runs only inside a short window after a click, and the sweep itself is queued
     * on the next frame — which lands before that frame paints, so the rows never
     * appear unhidden first. A standing body-wide observer is what would be
     * expensive; a 400ms window is not.
     */
    function menuWatchForMount() {
      if (typeof MutationObserver !== 'function') return
      if (menuObserver === null) {
        menuObserver = new MutationObserver(menuQueueSweep)
        menuObserver.observe(document.documentElement, { childList: true, subtree: true })
      }
      clearTimeout(menuObserverTimer)
      menuObserverTimer = setTimeout(() => {
        menuObserver.disconnect()
        menuObserver = null
      }, 400)
    }

    /** Set while the click that opens a menu came from a Session row. */
    let menuFromSessionRow = false

    /** Menus mount a frame or two after the click that opens them. */
    function menuScheduleSweep(fromSessionRow) {
      if (fromSessionRow) menuFromSessionRow = true
      menuSweep()
      menuWatchForMount()
      for (const delay of [40, 120, 260]) setTimeout(menuSweep, delay)
      setTimeout(() => {
        menuFromSessionRow = false
      }, 600)
    }

    /** Drop the watch when the plugin goes away. */
    function menuStopWatch() {
      clearTimeout(menuObserverTimer)
      if (menuObserver !== null) {
        menuObserver.disconnect()
        menuObserver = null
      }
    }

    function setMenuRowHidden(key, hide) {
      const next = menuState.hidden.filter((one) => one !== key)
      if (hide) next.push(key)
      menuState = { ...menuState, hidden: next }
      writeMenuState()
      syncStyle()
      notify()
      menuSweep()
    }

    function setValue(key, value) {
      if (values[key] === value) return
      values = { ...values, [key]: value }
      writeStore()
      syncStyle()
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // One broken subscriber must not stop the rest.
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function hiddenRules() {
      const rules = []
      if (values.brand) {
        // The logo row is a flex child of the column, so dropping it closes the
        // gap. It holds the collapse toggle on Windows and Linux, though, and that
        // toggle must survive: hide the whole row only where it has no toggle, and
        // otherwise hide just the brand inside it. `data-sidebar-toggle` is the
        // sidebar's own attribute, stabler than any CSS-module class name.
        rules.push(
          '[class*="_logoRow"]:not(:has([data-sidebar-toggle])){display:none!important}',
          '[class*="_logoRow"]:has([data-sidebar-toggle]) [class*="_brand"]{display:none!important}',
          // Where the row does hold the toggle, drop its height instead of the
          // row: zero height, no padding, and the button keeps the same place,
          // drawn on top of whatever now starts where the row used to be. Pure
          // CSS — no probe, no timer, no forced layout.
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_logoRow"]:has([data-sidebar-toggle])'
            + '{height:0!important;min-height:0!important;padding:0!important;overflow:visible!important'
            + ';align-items:flex-start!important;justify-content:flex-end!important}',
          // Web only: a shell that draws a Windows title bar already pins this
          // button up there (`[data-windows-titlebar] .toggle{position:fixed;
          // left:12px}`), and this selector is more specific, so it has to stay
          // out of that layout entirely. In the browser there is no title bar,
          // and the button belongs in the gutter just right of the sidebar.
          'html:not([data-windows-titlebar]) [class*="_root"]:not([class*="_collapsed"])'
            + ' [class*="_logoRow"]:has([data-sidebar-toggle]) [class*="_toggle"]'
            + '{position:fixed;top:6px;left:calc(var(--dsh-sidebar-width,280px) + 8px);z-index:30;border-radius:8px}',
          // The collapsed rail keeps a normal row, or there is no way back out.
          '[class*="_root"][class*="_collapsed"] [class*="_logoRow"]'
            + '{height:28px!important;min-height:0!important;padding-block:0!important;align-items:center!important}',
        )
      }
      if (values.newSession) {
        rules.push('button[class*="_newSession"]{display:none!important}')
      }
      if (values.panelLayout === 'two') {
        // Fixed two-column grid: columns share one width, so rows line up
        // exactly, and a longer label is truncated by the shipped ellipsis.
        // The `:not([class*="_collapsed"])` guard is load-bearing here too — the
        // shipped stylesheet hides the whole panel list in the collapsed rail
        // (`.collapsed .panelList{display:none}`), and an unscoped `!important`
        // grid would resurrect it there.
        rules.push(
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + '{display:grid!important;grid-template-columns:1fr 1fr;gap:2px}',
        )
      }
      if (values.panelLayout === 'wrap') {
        // Content-sized chips that wrap greedily, not fixed columns: two short
        // names (插件 / 鱼塘) pack three or four to a line while a long one
        // (自动化任务) takes what it needs, and nothing is ever truncated. Fixed
        // `grid-template-columns` cannot do this — every column shares one width.
        rules.push(
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + '{flex-direction:row!important;flex-wrap:wrap!important;'
            + 'column-gap:6px!important;row-gap:2px!important}',
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + ' > [class*="_panelRow"]{flex:0 0 auto!important;width:auto!important;'
            + 'max-width:100%}',
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + ' > button:nth-of-type(n+3){order:1}',
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + ' > [class*="_moreAnchor"]{order:0}',
        )
      }
      if (values.panelOrder.length > 0) {
        // The user's arrangement becomes the real order, and the More launcher
        // keeps trailing it. `!important` beats the wrap-mode rule above.
        const ordered = orderedPanelEntries()
        ordered.forEach((entry, index) => {
          rules.push(`[${PANEL_ATTR}="${entry.id}"]{order:${index + 1}!important}`)
        })
        rules.push(
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + ` > [class*="_moreAnchor"]{order:${ordered.length + 1}!important}`,
        )
      }
      if (values.sidebarMore) {
        rules.push(
          '[class*="_panelList"] [class*="_moreAnchor"]{display:none!important}',
          '[class*="_panelList"] button[aria-haspopup="menu"]{display:none!important}',
        )
      }
      if (values.rightMore) {
        rules.push(
          '[data-sidebar-right-guide] [class*="_moreAnchor"]{display:none!important}',
          '[data-sidebar-right-guide] button[aria-haspopup="menu"]{display:none!important}',
        )
      }
      if (values.headerMore) {
        rules.push(
          '[class*="_viewsMoreAnchor"]{display:none!important}',
          'button[class*="_viewsMore"]{display:none!important}',
        )
      }
      if (values.collapsedAll === true) {
        // The bulk layer only: every panel row plus the list's More launcher. The
        // individual switches and the checkbox list stay untouched.
        rules.push(
          '[class*="_panelList"] > button[aria-label]{display:none!important}',
          '[class*="_panelList"] [class*="_moreAnchor"]{display:none!important}',
          '[class*="_panelList"] button[aria-haspopup="menu"]{display:none!important}',
        )
      }
      for (const id of values.hiddenPanels) {
        const entry = panelEntries.find((one) => one.id === id)
        if (entry === undefined) continue
        // Primary: the id stamped on the row, which keeps two same-named panels
        // apart. Fallback: the name, used only before the first stamping pass and
        // only when no other panel carries it.
        rules.push('button[' + PANEL_ATTR + '="' + cssAttrValue(id) + '"]{display:none!important}')
        const shared = panelEntries.some((one) => one.id !== id && one.label === entry.label)
        if (!shared) {
          rules.push(
            '[class*="_panelList"] > button[aria-label="' + cssAttrValue(entry.label) + '"]'
              + '{display:none!important}',
          )
        }
      }
      for (const one of values.picked) {
        // Entries written before this flag existed were already hidden; keep them.
        if (one.enabled === false) continue
        rules.push(one.selector + '{display:none!important}')
      }
      return rules
    }

    /** Styles for the plugin-page card; static, kept beside the hide rules. */
    const FORM_CSS = [
      '.dhns-form{display:flex;flex-direction:column;gap:22px;padding:12px 0}',
      '.dhns-section{display:flex;flex-direction:column;gap:8px}',
      '.dhns-sectionHead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.dhns-sectionTitle{margin:0;font-size:13px;font-weight:600;',
      'letter-spacing:.02em;color:var(--dsw-alias-label-primary)}',
      '.dhns-sectionHint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}',
      '.dhns-rows{display:flex;flex-direction:column;gap:8px}',
      '.dhns-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}',
      '.dhns-grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}',
      '.dhns-grid .dhns-row{padding:6px 8px;align-items:center;border-radius:6px}',
      '.dhns-grid .dhns-title{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dhns-grid .dhns-hint{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dhns-grid .dhns-text{gap:0}',
      '.dhns-footer-btn{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'padding:7px 8px;margin:0 0 2px;border:0;border-radius:var(--dsw-radius-md,8px);',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}',
      '.dhns-footer-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-footer-btn[data-rail=true]{justify-content:center;width:36px;height:36px;padding:0;margin:0 auto 2px}',
      '.dhns-footer-icon{flex:none;width:14px;text-align:center;opacity:.75}',
      '.dhns-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dhns-row{display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:8px 10px;',
      'border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.18))}',
      '.dhns-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-row input{margin:2px 0 0;flex:none}',
      '.dhns-grip{flex:none;cursor:grab;user-select:none;line-height:1;font-size:13px;',
      'color:var(--dsw-alias-label-tertiary,#9aa0a6);padding:1px 0}',
      '.dhns-grip:active{cursor:grabbing}',
      '.dhns-rowDragging{opacity:.45}',
      '.dhns-choice{margin:0;padding:0;border:0;display:flex;flex-direction:column;gap:8px}',
      '.dhns-choiceInline{flex-direction:row;flex-wrap:wrap;gap:6px}',
      '.dhns-choiceInline .dhns-row{flex:1 1 0;min-width:0;padding:6px 10px}',
      '.dhns-choiceInline .dhns-title{white-space:nowrap}',
      '.dhns-legend{padding:0;font-size:13px;font-weight:500;',
      'color:var(--dsw-alias-label-primary);margin-bottom:2px}',
      '.dhns-option[data-selected=true]{border-color:var(--dsw-alias-state-business-primary,rgba(44,123,229,.55));',
      'background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}',
      '.dhns-title{font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.dhns-hint{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}',
      '.dhns-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}',
      '.dhns-picked{display:flex;flex-direction:column;gap:6px;margin-top:4px}',
      '.dhns-pickedRow{display:flex;align-items:center;gap:10px;padding:6px 10px;',
      'border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.18))}',
      '.dhns-pickedRow .dhns-hint{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dhns-sel{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'color:var(--dsw-alias-label-secondary);max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dhns-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 12px;cursor:pointer;',
      'border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));',
      'background:transparent;color:var(--dsw-alias-label-primary)}',
      '.dhns-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-btn[data-tone=primary]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-primary,#fff);',
      'border-color:var(--dsw-alias-label-primary)}',
      '.dhns-footer-btn{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;',
      'padding:7px 8px;margin:0 0 2px;border:0;border-radius:var(--dsw-radius-md,8px);',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}',
      '.dhns-footer-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-footer-btn[data-rail=true]{justify-content:center;width:36px;height:36px;padding:0;margin:0 auto 2px}',
      '.dhns-footer-icon{flex:none;width:14px;text-align:center;opacity:.75}',
      '.dhns-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dhns-subhead{font-size:12px;font-weight:500;letter-spacing:.02em;',
      'color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.dhns-subheadRow{display:flex;align-items:center;justify-content:space-between;',
      'gap:8px;margin-top:4px}',
      '.dhns-subheadRow .dhns-subhead{margin-top:0}',
      '.dhns-subheadBtn{font:inherit;font-size:11px;line-height:16px;padding:1px 8px;cursor:pointer;',
      'border-radius:6px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));',
      'background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.dhns-subheadBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-subheadBtn:disabled{opacity:.4;cursor:default}',
    ].join('')

    function syncStyle() {
      if (typeof document === 'undefined') return null
      let tag = document.querySelector('style[' + STYLE_ATTR + ']')
      if (tag === null) {
        tag = document.createElement('style')
        tag.setAttribute(STYLE_ATTR, '1')
        document.head.appendChild(tag)
      }
      const css = '/* dsh-sidebar-declutter */\n'
        + hiddenRules().concat(menuCssRules()).join('\n')
        + '\n' + FORM_CSS
      // The tag outlives the module instance: a newer build re-executing in the
      // same document must rewrite it rather than keep the old stylesheet.
      if (tag.textContent !== css) tag.textContent = css
      return tag
    }

    /** Live view of what is registered into the sidebar's panel list. */
    let panelEntries = []

    /** Escape a value for a double-quoted CSS attribute selector. */
    function cssAttrValue(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    }

    // --- collapse control -------------------------------------------------------
    // `sidebar.panellist` rows are navigation by contract, so an action has no
    // seat there. `sidebar.footer.action` is an official list slot the sidebar
    // renders itself — no DOM injection, and a re-render cannot remove it.

    function toggleCollapse() {
      values = { ...values, collapsedAll: values.collapsedAll !== true }
      writeStore()
      syncStyle()
      notify()
    }

    function collapseLabel() {
      return values.collapsedAll === true ? '展开面板列表' : '收起面板列表'
    }

    /**
     * The footer action: an official list slot the sidebar renders itself, so it
     * cannot be removed by a re-render. `wide` collapses it to an icon in the rail.
     */
    function CollapseAction(props) {
      const [, force] = React.useReducer((count) => count + 1, 0)
      React.useEffect(() => subscribe(force), [])
      const wide = props?.wide !== false
      const label = collapseLabel()
      return h(
        'button',
        {
          type: 'button',
          className: 'dhns-footer-btn',
          'data-rail': wide ? undefined : 'true',
          'aria-label': label,
          'aria-pressed': values.collapsedAll === true ? 'true' : 'false',
          title: label,
          onClick: () => toggleCollapse(),
        },
        h('span', { className: 'dhns-footer-icon', 'aria-hidden': 'true' }, values.collapsedAll ? '▸' : '▾'),
        wide ? h('span', { className: 'dhns-footer-label' }, label) : null,
      )
    }

    // --- per-row id stamping -----------------------------------------------------
    // The list exposes no id in the DOM, only the accessible name, so two panels
    // sharing a name would hide together. Each rendered row is therefore stamped
    // with the registration id it belongs to, and the hide rule names the id.
    // Stamping only sets attributes; it never inserts or moves a node.

    const PANEL_ATTR = 'data-dsh-panel'

    /** The panel list inside the sidebar column, located from its own anchor. */
    function findPanelNav() {
      if (typeof document === 'undefined') return null
      const toggle = document.querySelector('[data-sidebar-toggle]')
      if (toggle === null) return null
      let node = toggle.parentElement
      while (node !== null && node !== document.body) {
        const nav = node.querySelector('[class*="_panelList"]')
        if (nav !== null) {
          const rect = nav.getBoundingClientRect()
          // A sidebar column is a narrow strip; anything wider is another
          // component whose CSS-module local name happens to match.
          if (rect.width > 0 && rect.width < 520) return nav
        }
        node = node.parentElement
      }
      return null
    }

    /**
     * Pair each rendered row with a registered entry: by name first, then by
     * render order among the rest. A failed pass hides nothing, which is the safe
     * direction — every panel stays visible and can be re-ticked.
     */
    /**
     * Registered panels in the order the user dragged them into; anything they
     * have not arranged yet keeps its registration order behind them.
     */
    function orderedPanelEntries() {
      if (values.panelOrder.length === 0) return [...panelEntries]
      const rank = new Map(values.panelOrder.map((id, index) => [id, index]))
      const base = new Map(panelEntries.map((entry, index) => [entry.id, index]))
      return [...panelEntries].sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER
        const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER
        if (ra !== rb) return ra - rb
        return (base.get(a.id) ?? 0) - (base.get(b.id) ?? 0)
      })
    }

    function stampPanelRows() {
      try {
        const nav = findPanelNav()
        if (nav === null) return
        const rows = Array.from(nav.querySelectorAll(':scope > button[aria-label]'))
        if (rows.length === 0) return
        const claimed = new Set()
        const take = (label) => {
          const hit = panelEntries.find((entry) => entry.label === label && !claimed.has(entry.id))
          if (hit === undefined) return null
          claimed.add(hit.id)
          return hit.id
        }
        for (const row of rows) {
          const id = take(row.getAttribute('aria-label') ?? '')
          if (id === null) {
            row.removeAttribute(PANEL_ATTR)
            continue
          }
          if (row.getAttribute(PANEL_ATTR) !== id) row.setAttribute(PANEL_ATTR, id)
        }
      } catch (error) {
        console.warn('[dsh-sidebar-declutter] 面板打标失败：', error)
      }
    }

    /**
     * Re-stamp whenever the sidebar re-renders its list. The observer watches the
     * list node only — watching the whole document would fire on every chat
     * token. Until the sidebar exists, a short poll looks for it and then stops.
     */
    function watchPanelRows() {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return null
      let observer = null
      let target = null
      let scheduled = false
      let poll = null

      const stampSoon = () => {
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
          scheduled = false
          stampPanelRows()
        }, 16)
      }

      const attach = () => {
        const nav = findPanelNav()
        if (nav === null) return false
        if (nav === target) return true
        observer?.disconnect()
        target = nav
        observer = new MutationObserver(stampSoon)
        observer.observe(nav, { childList: true })
        stampPanelRows()
        return true
      }

      if (!attach()) {
        poll = setInterval(() => {
          if (attach() && poll !== null) {
            clearInterval(poll)
            poll = null
          }
        }, 500)
      }

      return () => {
        observer?.disconnect()
        if (poll !== null) clearInterval(poll)
      }
    }

    // --- pick mode -------------------------------------------------------------
    // User-started only: capture one click, turn the target into a selector and
    // keep it in `picked`. Nothing here runs until the button is pressed.

    let picker = null

    /**
     * Teardown handles that outlive one module instance. A hot swap re-runs this
     * module with fresh state while the previous instance's document listeners
     * are still attached; without this the old capture handler keeps swallowing
     * every click in the page.
     */
    const TEARDOWN_KEY = '__dshSidebarDeclutterTeardown'

    function registerTeardown(fn) {
      if (typeof window === 'undefined') return
      const previous = window[TEARDOWN_KEY]
      if (typeof previous === 'function') {
        try {
          previous()
        } catch {
          // A broken previous instance must not stop this one.
        }
      }
      window[TEARDOWN_KEY] = fn
    }

    /**
     * Live view of what is registered into the sidebar's panel list, mirrored
     * from the slot registry the sidebar itself renders from. Each entry is
     * `{ id, order, label }`; the label is what the rendered button carries as
     * its accessible name.
     */
    /** Escape a value for a double-quoted CSS attribute selector. */
    /** `kB3qhq_panelRow` → `panelRow`; a class without a module hash stays whole. */
    function localName(cls) {
      const match = /^[A-Za-z0-9_-]+_([A-Za-z][A-Za-z0-9-]*)$/.exec(cls)
      return match === null ? null : match[1]
    }

    function escapeIdent(value) {
      return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : value.replace(/[^A-Za-z0-9_-]/g, (ch) => '\\' + ch)
    }

    /**
     * A selector that survives the next build. CSS-module class names carry a
     * per-build hash (`kB3qhq_panelRow`), so they are matched by their local
     * suffix; an id or a `data-` attribute is preferred when the element has one.
     */
    function buildSelector(el) {
      if (el.id !== '') return '#' + escapeIdent(el.id)
      const classes = Array.from(el.classList)
      const locals = classes.map(localName).filter((one) => one !== null)
      const plain = classes.filter((one) => localName(one) === null)
      if (plain.length > 0 || locals.length > 0) {
        let sel = el.tagName.toLowerCase()
        if (plain.length > 0) sel += '.' + escapeIdent(plain[0])
        if (locals.length > 0) sel += '[class*="_' + locals[0] + '"]'
        return sel
      }
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('data-') && attr.name !== 'data-dsh-sidebar-declutter') {
          return '[' + attr.name + ']'
        }
      }
      const path = []
      let node = el
      for (let depth = 0; depth < 5 && node && node !== document.body; depth += 1) {
        let sel = node.tagName.toLowerCase()
        const parent = node.parentElement
        if (parent !== null) sel += ':nth-child(' + (Array.from(parent.children).indexOf(node) + 1) + ')'
        path.unshift(sel)
        node = node.parentElement
      }
      return path.join(' > ')
    }

    function labelFor(el) {
      const named = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''
      const text = (named !== '' ? named : el.textContent ?? '').replace(/\s+/g, ' ').trim()
      return text === '' ? el.tagName.toLowerCase() : text.slice(0, 24)
    }

    /** Guards that keep the way back open. */
    function isProtected(el) {
      if (typeof document === 'undefined') return true
      if (el === document.body || el === document.documentElement) return true
      if (el.closest('.dhns-form') !== null) return true
      // The settings entry is the only door to the plugin page that holds the
      // restore list; hiding it — directly or through an ancestor — locks the
      // user out of the very screen that could undo it.
      if (el.matches('[class*="_triggerRow"]') || el.querySelector('[class*="_triggerRow"]') !== null) return true
      // A container, not a row. One stray click on a panel-sized box can blank a
      // whole area — the plugin page itself was hidden this way once — so
      // anything covering a large share of the viewport is refused.
      const rect = el.getBoundingClientRect()
      const viewport = window.innerWidth * window.innerHeight
      if (viewport > 0 && rect.width * rect.height > viewport * 0.4) return true
      return false
    }

    function addPicked(el) {
      const selector = buildSelector(el)
      if (selector.trim() === '') return null
      if (values.picked.some((one) => one.selector === selector)) return { selector, duplicate: true }
      // Added as a candidate: it hides only once its checkbox is ticked, so a
      // stray click can never take something off the screen by itself.
      const entry = { selector, label: labelFor(el), enabled: false }
      values = { ...values, picked: [...values.picked, entry] }
      writeStore()
      syncStyle()
      notify()
      return { selector, duplicate: false }
    }

    function removePickedAt(index) {
      const next = values.picked.filter((_, position) => position !== index)
      values = { ...values, picked: next }
      writeStore()
      syncStyle()
      notify()
    }

    function stopPicker() {
      if (picker === null) return
      document.removeEventListener('click', picker.onClick, true)
      document.removeEventListener('mousemove', picker.onMove, true)
      document.removeEventListener('keydown', picker.onKeyDown, true)
      if (picker.outlined !== null) picker.outlined.style.outline = picker.savedOutline
      picker.bar.remove()
      picker = null
      notify()
    }

    function startPicker() {
      if (typeof document === 'undefined' || picker !== null) return
      const bar = document.createElement('div')
      bar.setAttribute('data-dsh-picker', '1')
      bar.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
        'z-index:2147483000', 'display:flex', 'align-items:center', 'gap:10px',
        'padding:8px 12px', 'border-radius:12px', 'font:13px/1.4 system-ui,sans-serif',
        'background:#1f2328', 'color:#fff', 'box-shadow:0 8px 24px rgba(0,0,0,.35)',
      ].join(';')

      const text = document.createElement('span')
      text.setAttribute('data-role', 'text')
      const undo = document.createElement('button')
      undo.type = 'button'
      undo.textContent = '撤销'
      undo.style.cssText = 'font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #ffffff44;background:transparent;color:#fff;cursor:pointer'
      const done = document.createElement('button')
      done.type = 'button'
      done.textContent = '完成'
      done.style.cssText = 'font:inherit;padding:4px 10px;border-radius:8px;border:1px solid #ffffff44;background:#fff;color:#1f2328;cursor:pointer'
      bar.append(text, undo, done)
      document.body.appendChild(bar)

      const refreshBar = () => {
        text.textContent = '点选要隐藏的元素 · 已隐藏 ' + values.picked.length + ' 个'
        undo.disabled = values.picked.length === 0
      }
      refreshBar()

      undo.addEventListener('click', () => {
        if (values.picked.length === 0) return
        removePickedAt(values.picked.length - 1)
        refreshBar()
      })
      done.addEventListener('click', () => stopPicker())

      const state = { bar, onClick: null, onMove: null, outlined: null, savedOutline: '' }

      state.onMove = (event) => {
        const el = event.target instanceof Element ? event.target : null
        if (el === null || el === state.outlined) return
        if (state.outlined !== null) state.outlined.style.outline = state.savedOutline
        state.outlined = null
        if (el === document.body || el === document.documentElement) return
        if (bar.contains(el)) return
        state.outlined = el
        state.savedOutline = el.style.outline
        el.style.outline = isProtected(el) ? '2px dashed #e5484d' : '2px solid #2c7be5'
      }

      state.onClick = (event) => {
        const el = event.target instanceof Element ? event.target : null
        if (el === null || bar.contains(el)) return
        // Clicks on this plugin's own card must keep working — that is where
        // 「结束点选」and the restore rows live.
        if (el.closest('.dhns-form') !== null) return
        event.preventDefault()
        event.stopPropagation()
        if (isProtected(el)) {
          text.textContent = '这一项不能隐藏：它会挡住设置入口'
          setTimeout(refreshBar, 1800)
          return
        }
        const result = addPicked(el)
        text.textContent =
          result !== null && result.duplicate
            ? '这一项已经在列表里了'
            : '已加入列表：' + labelFor(el) + '（去设置里勾选才会隐藏）'
        setTimeout(refreshBar, 2000)
        if (state.outlined !== null) {
          state.outlined.style.outline = state.savedOutline
          state.outlined = null
        }
      }

      state.onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          stopPicker()
        }
      }

      document.addEventListener('mousemove', state.onMove, true)
      document.addEventListener('click', state.onClick, true)
      document.addEventListener('keydown', state.onKeyDown, true)
      picker = state
      notify()
    }

    function notify() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // One broken subscriber must not stop the rest.
        }
      }
    }

    /**
     * The plugin page card, registered at `plugins.row.config` for this bundle's
     * row. `summary` is the one-liner the row shows when collapsed; `page` is the
     * form the row's configure control opens.
     */
    function SettingsCard(props) {
      const view = props?.view
      const [, forceRender] = React.useReducer((count) => count + 1, 0)
      const [dragId, setDragId] = React.useState(null)
      React.useEffect(() => subscribe(forceRender), [])

      if (view === 'summary') {
        // Only the hide section belongs in the one-liner; the layout switch is
        // not something the row can meaningfully report as "hidden".
        const on = FIELDS.filter((field) => field.kind === 'hide' && values[field.key] === true)
          .map((field) => field.title)
        return h('span', null, on.length === 0 ? '未隐藏任何项' : '已隐藏：' + on.join('、'))
      }

      const rowFor = (field) =>
        h(
          'label',
          { key: field.key, className: 'dhns-row' },
          h('input', {
            type: 'checkbox',
            checked: values[field.key] === true,
            onChange: (event) => setValue(field.key, event.target.checked === true),
          }),
          h(
            'span',
            { className: 'dhns-text' },
            h('span', { className: 'dhns-title' }, field.title),
            h('span', { className: 'dhns-hint' }, field.hint),
          ),
        )

      /**
       * A mutually exclusive group. One shared `name` is what makes the browser
       * keep exactly one option selected, so the three layouts can never be
       * combined — the CSS rules are all derived from the single stored value.
       */
      const choiceFor = (field) =>
        h(
          'fieldset',
          {
            key: field.key,
            className: field.inline === true ? 'dhns-choice dhns-choiceInline' : 'dhns-choice',
            'aria-label': field.title ?? field.key,
          },
          field.title === undefined
            ? null
            : h('legend', { className: 'dhns-legend' }, field.title),
          field.options.map((option) =>
            h(
              'label',
              {
                key: option.value,
                className: 'dhns-row dhns-option',
                'data-selected': values[field.key] === option.value ? 'true' : undefined,
              },
              h('input', {
                type: 'radio',
                name: 'dhns-' + field.key,
                checked: values[field.key] === option.value,
                onChange: () => setValue(field.key, option.value),
              }),
              h(
                'span',
                { className: 'dhns-text' },
                h('span', { className: 'dhns-title' }, option.title),
                h('span', { className: 'dhns-hint' }, option.hint),
              ),
            ),
          ),
        )

      const renderField = (field) => (field.type === 'choice' ? choiceFor(field) : rowFor(field))

      const togglePanel = (id, on) => {
        const next = on
          ? values.hiddenPanels.includes(id) ? values.hiddenPanels : [...values.hiddenPanels, id]
          : values.hiddenPanels.filter((one) => one !== id)
        values = { ...values, hiddenPanels: next }
        writeStore()
        syncStyle()
        notify()
      }

      /** Drop `fromId` where `toId` sits, then persist the whole arrangement. */
      const movePanel = (fromId, toId) => {
        const ids = orderedPanelEntries().map((one) => one.id)
        const from = ids.indexOf(fromId)
        const to = ids.indexOf(toId)
        if (from < 0 || to < 0 || from === to) return
        const [moved] = ids.splice(from, 1)
        ids.splice(to, 0, moved)
        values = { ...values, panelOrder: ids }
        writeStore()
        syncStyle()
        notify()
      }

      /** Drop the arrangement and fall back to the registration order. */
      const resetPanelOrder = () => {
        if (values.panelOrder.length === 0) return
        values = { ...values, panelOrder: [] }
        writeStore()
        syncStyle()
        notify()
      }

      const panelBlock = () => {
        if (panelEntries.length === 0) {
          return h('p', { className: 'dhns-hint' }, '当前没有检测到已注册的面板。')
        }
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'dhns-subheadRow', key: 'subhead' },
            h('span', { className: 'dhns-subhead' }, '面板'),
            h(
              'button',
              {
                type: 'button',
                className: 'dhns-subheadBtn',
                disabled: values.panelOrder.length === 0,
                onClick: resetPanelOrder,
              },
              '还原默认',
            ),
          ),
          h(
            'div',
            { className: 'dhns-grid', key: 'grid' },
            orderedPanelEntries().map((entry) =>
              h(
                'label',
                {
                  key: entry.id,
                  className: dragId === entry.id ? 'dhns-row dhns-rowDragging' : 'dhns-row',
                  onDragOver: (event) => {
                    if (dragId === null) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  },
                  onDrop: (event) => {
                    if (dragId === null) return
                    event.preventDefault()
                    movePanel(dragId, entry.id)
                    setDragId(null)
                  },
                },
                h(
                  'span',
                  {
                    className: 'dhns-grip',
                    title: '拖动排序',
                    draggable: true,
                    onDragStart: (event) => {
                      setDragId(entry.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', entry.id)
                    },
                    onDragEnd: () => setDragId(null),
                  },
                  '⠿',
                ),
                h('input', {
                  type: 'checkbox',
                  checked: values.hiddenPanels.includes(entry.id),
                  onChange: (event) => togglePanel(entry.id, event.target.checked === true),
                }),
                h(
                  'span',
                  { className: 'dhns-text' },
                  h('span', { className: 'dhns-title' }, entry.label),
                  h('span', { className: 'dhns-hint' }, entry.id),
                ),
              ),
            ),
          ),
        )
      }

      const togglePicked = (index, on) => {
        const next = values.picked.map((one, position) =>
          position === index ? { ...one, enabled: on } : one,
        )
        values = { ...values, picked: next }
        writeStore()
        syncStyle()
        notify()
      }

      const pickedBlock = () => {
        const running = picker !== null
        return [
          h(
            'div',
            { className: 'dhns-actions', key: 'actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dhns-btn',
                'data-tone': running ? undefined : 'primary',
                onClick: () => (running ? stopPicker() : startPicker()),
              },
              running ? '结束点选' : '开始点选',
            ),
            values.picked.length === 0
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'dhns-btn',
                    onClick: () => {
                      values = { ...values, picked: [] }
                      writeStore()
                      syncStyle()
                      notify()
                    },
                  },
                  '清空列表',
                ),
          ),
          values.picked.length === 0
            ? h('p', { className: 'dhns-hint', key: 'empty' }, '还没有点选任何元素。')
            : h(
                'div',
                { className: 'dhns-rows', key: 'list' },
                values.picked.map((one, index) =>
                  h(
                    'label',
                    { className: 'dhns-row', key: one.selector + ':' + index },
                    h('input', {
                      type: 'checkbox',
                      checked: one.enabled !== false,
                      onChange: (event) => togglePicked(index, event.target.checked === true),
                    }),
                    h(
                      'span',
                      { className: 'dhns-text' },
                      h('span', { className: 'dhns-title' }, one.label),
                      h(
                        'span',
                        { className: 'dhns-hint dhns-sel', title: one.selector },
                        one.selector,
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dhns-btn',
                        onClick: (event) => {
                          event.preventDefault()
                          removePickedAt(index)
                        },
                      },
                      '移除',
                    ),
                  ),
                ),
              ),
        ]
      }

      const menuBlock = () => {
        const presetKeys = MENU_PRESETS.map((one) => one.key)
        const other = menuState.seen
          .filter((one) => !presetKeys.includes(one.key) && !isPresetMenuKey(one.key))
          .sort((a, b) => a.key.localeCompare(b.key, 'zh'))
        const rowOf = (one) =>
          h(
            'label',
            { key: one.key, className: 'dhns-row' },
            h('input', {
              type: 'checkbox',
              checked: menuState.hidden.includes(one.key),
              onChange: (event) => setMenuRowHidden(one.key, event.target.checked === true),
            }),
            h(
              'span',
              { className: 'dhns-text' },
              h('span', { className: 'dhns-title' }, one.key),
              one.accel === '' ? null : h('span', { className: 'dhns-hint' }, one.accel),
            ),
          )
        return h(
          'div',
          null,
          h('div', { className: 'dhns-subhead', key: 'official' }, '官方'),
          h('div', { className: 'dhns-grid', key: 'official-grid' },
            MENU_PRESETS.map((one) => rowOf({ key: one.key, accel: one.accel }))),
          other.length === 0
            ? null
            : h('div', { className: 'dhns-subhead', key: 'other' }, '社区（插件添加）'),
          other.length === 0
            ? null
            : h('div', { className: 'dhns-grid', key: 'other-grid' }, other.map(rowOf)),
        )
      }

      return h(
        'div',
        { className: 'dhns-form' },
        SECTIONS.map((section) =>
          h(
            'section',
            { key: section.title, className: 'dhns-section' },
            h(
              'div',
              { className: 'dhns-sectionHead' },
              h('h4', { className: 'dhns-sectionTitle' }, section.title),
              section.hint === undefined
                ? null
                : h('span', { className: 'dhns-sectionHint' }, section.hint),
            ),
            section.fields.length === 0
              ? null
              : h(
                  'div',
                  {
                    className: section.columns === 2
                      ? 'dhns-grid dhns-grid-2'
                      : section.columns === 3
                        ? 'dhns-grid'
                        : 'dhns-rows',
                  },
                  section.fields.map(renderField),
                ),
            section.kind === 'picked' ? pickedBlock() : null,
            section.kind === 'menu' ? menuBlock() : null,
            section.panels === true ? panelBlock() : null,
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        values = readStore()
        readMenuState()

        // Mirror the panel registry the sidebar renders from: it is the only
        // place that knows every left-column button and its display name, so the
        // checkboxes follow newly installed plugins without any code change.
        const syncPanels = () => {
          try {
            panelEntries = ctx.slots
              .entriesOfSlot('sidebar.panellist')
              .map(({ options }) => ({
                id: options.id,
                order: options.order ?? 0,
                label:
                  typeof options.label === 'function'
                    ? options.label()
                    : options.label ?? options.id,
              }))
              .sort((a, b) => a.order - b.order)
          } catch {
            panelEntries = []
          }
          stampPanelRows()
          syncStyle()
          notify()
        }

        ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'dsh-sidebar-declutter: panel registry')
        const locale = (() => {
          try {
            return ctx.get('locale')
          } catch {
            return null
          }
        })()
        if (locale !== null && typeof locale?.subscribe === 'function') {
          ctx.effect(() => locale.subscribe(syncPanels), 'dsh-sidebar-declutter: panel labels')
        }
        syncPanels()
        ctx.effect(() => watchPanelRows(), 'dsh-sidebar-declutter: panel rows')

        ctx.effect(() => {
          registerTeardown(() => {
            if (picker !== null) stopPicker()
          })
          return () => {
            if (picker !== null) stopPicker()
          }
        }, 'dsh-sidebar-declutter: pick teardown')

        ctx.effect(() => {
          const tag = syncStyle()

          // Diagnose selector drift after an upgrade instead of failing silently:
          // the sidebar is on screen but nothing matches the button.
          let timer = null
          if (typeof document !== 'undefined' && values.newSession) {
            timer = setTimeout(() => {
              timer = null
              if (document.querySelector('[class*="_panelList"]') === null) return
              if (document.querySelector('button[class*="_newSession"]') !== null) return
              console.warn(
                '[dsh-sidebar-declutter] 侧栏已渲染但没匹配到新会话按钮，选择器可能随版本变化。',
              )
            }, 2000)
          }

          return () => {
            if (timer !== null) clearTimeout(timer)
            if (tag !== null) tag.remove()
          }
        }, 'dsh-sidebar-declutter: stylesheet')


        ctx.effect(() =>
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'sidebar-declutter-collapse', order: 10 },
              CollapseAction,
            ),
          ),
        )

        if (ENABLE_ROW_CONFIG) {
          ctx.effect(() =>
            ctx.slots.inject('plugins.row.config', () =>
              ctx.slots.register({ name: 'plugins.row.config', key: ROW_CONFIG_KEY }, SettingsCard),
            ),
          )
        }

        // Menu rows are plain DOM: sweep after every click that could have opened
        // one, never with a body-level observer (the chat stream mutates per token).
        ctx.effect(() => {
          const sweep = (event) => {
            const target = event && event.target
            const fromRow = !!(target && target.closest && target.closest('[class*="_sessionRow"]'))
            menuScheduleSweep(fromRow)
          }
          document.addEventListener('click', sweep, true)
          document.addEventListener('contextmenu', sweep, true)
          return () => {
            document.removeEventListener('click', sweep, true)
            document.removeEventListener('contextmenu', sweep, true)
            menuStopWatch()
          }
        }, 'dsh-sidebar-declutter: menu rows')
      },
    }
  },
})