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

    /** Row-config key: `<bundle package>#<row id from the bundle patch>`. */
    const ROW_CONFIG_KEY = 'dsh-sidebar-declutter#sidebar-declutter'
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
        fields: [
          {
            key: 'brand',
            title: '顶部品牌行（deepseek HARNESS）',
            hint: '侧栏最上面那一行。macOS 上它只是装饰，不含任何控件；Windows/Linux 上该行右侧还有折叠按钮，那种情况下只隐藏品牌本身、保留按钮。',
          },
          {
            key: 'newSession',
            title: '「新会话」按钮',
            hint: '侧栏品牌行下面那一行。隐藏后仍可用快捷键和工作区那行的 + 新建会话。',
          },
          {
            key: 'sidebarMore',
            title: '左栏面板列表的「更多」',
            hint: '收起这一行后，面板将无法再取消固定，已固定的面板会一直列在侧栏。',
          },
          {
            key: 'fnRow',
            title: '在面板列表里放一个功能按钮',
            hint: '点一次收起「更多」和全部面板，再点一次恢复。品牌行与「新会话」不参与，它们只看自己的开关。',
          },
        ],
      },
      {
        kind: 'hide',
        title: '其它位置',
        fields: [
          {
            key: 'rightMore',
            title: '右侧栏起始页的「更多」',
            hint: '右栏 guide 页底部的「更多」，只影响右侧栏。',
          },
          {
            key: 'headerMore',
            title: '会话头部 View 行的「更多」',
            hint: 'View 标签行右端的 ⋯ 图标按钮，界面上没有「更多」两个字。',
          },
        ],
      },
      {
        kind: 'layout',
        title: '排布',
        fields: [
          {
            key: 'panelLayout',
            title: '面板列表排布',
            type: 'choice',
            options: [
              {
                value: 'stack',
                title: '一列',
                hint: '每个面板独占一行，和界面原样一致。',
              },
              {
                value: 'two',
                title: '一行两个',
                hint: '固定两列网格，左右对齐；名字长的会被截断成省略号。',
              },
              {
                value: 'wrap',
                title: '自动紧凑',
                hint: '按名字宽度自动换行：两个字的一行能放三四个，长名字占多少算多少，不截断。「更多」排在第二个面板之后。',
              },
            ],
          },
        ],
      },
      {
        kind: 'picked',
        title: '自由隐藏',
        hint: '点「开始点选」，然后点击界面上任意一个元素，它就会被收起来。收起项列在下方，随时可以恢复。',
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
      /** Elements the user picked by hand: `[{ selector, label }]`. */
      picked: [],
      /** Panel ids (from `sidebar.panellist`) the user ticked off. */
      hiddenPanels: [],
      /** Whether the panel list carries our own action row. */
      fnRow: true,
      /**
       * The bulk layer the eye button drives. It is deliberately separate from
       * `hiddenPanels`: collapsing and expanding must never touch what the user
       * ticked by hand, and the checkboxes never show this layer.
       */
      collapsedAll: false,
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
        // Deliberately not restored: a collapsed list plus a missing expand
        // control is a lockout, and a lockout that survives a restart is
        // unacceptable. Collapse lasts for the session only.
        if (Array.isArray(parsed?.hiddenPanels)) {
          next.hiddenPanels = parsed.hiddenPanels.filter((one) => typeof one === 'string')
        }
        if (Array.isArray(parsed?.picked)) {
          next.picked = parsed.picked.filter(
            (one) => one && typeof one.selector === 'string' && one.selector.trim() !== '',
          )
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

    function setValue(key, value) {
      if (values[key] === value) return
      // Turning the button off while the list is collapsed would remove the only
      // way back, so that switch expands first.
      if (key === 'fnRow' && value === false && values.collapsedAll === true) {
        values = { ...values, [key]: value, collapsedAll: false }
      } else {
        values = { ...values, [key]: value }
      }
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
          // The More launcher is the last child in the DOM, and flex-wrap only
          // fills forward: an item that does not fit never looks back at a hole
          // left on the line above. Its turn therefore always comes with a full
          // line above it, so it drops to a row of its own no matter how much room
          // the first line has.
          //
          // Sitting it after the second panel is a fixed ordering by position:
          // panel rows are the nav's only `button` children (the More trigger is
          // nested inside its `_moreAnchor` wrapper), so `:nth-of-type(n+3)` is
          // exactly "the third panel onwards", and the anchor stays in the default
          // order-0 group behind them. When the first line has no room left, the
          // anchor simply wraps and lands under the panels — the same rule then
          // degrades gracefully instead of overlapping anything.
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + ' > button:nth-of-type(n+3){order:1}',
          '[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]'
            + ' > [class*="_moreAnchor"]{order:0}',
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
        // The bulk layer, and only this layer: every panel row plus the list's
        // own More launcher. The individual switches and the checkbox list are
        // untouched, so expanding later restores exactly what was there.
        rules.push(
          '[class*="_panelList"] > button[aria-label]:not([data-dsh-fn-row])'
            + '{display:none!important}',
          '[class*="_panelList"] [class*="_moreAnchor"]{display:none!important}',
          '[class*="_panelList"] button[aria-haspopup="menu"]{display:none!important}',
        )
      }
      for (const id of values.hiddenPanels) {
        const entry = panelEntries.find((one) => one.id === id)
        if (entry === undefined) continue
        // Primary: the id stamped on the row by `stampPanelRows`. It survives two
        // panels sharing a label.
        rules.push('button[data-dsh-panel="' + cssAttrValue(id) + '"]{display:none!important}')
        // Fallback for the first paint, before stamping has run: the label is
        // safe to use only when no other panel carries it.
        const shared = panelEntries.some((one) => one.id !== id && one.label === entry.label)
        if (!shared) {
          rules.push(
            '[class*="_panelList"] > button[aria-label="' + cssAttrValue(entry.label) + '"]'
              + '{display:none!important}',
          )
        }
      }
      for (const one of values.picked) {
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
      '.dhns-row{display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:8px 10px;',
      'border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.18))}',
      '.dhns-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-row input{margin:2px 0 0;flex:none}',
      '.dhns-choice{margin:0;padding:0;border:0;display:flex;flex-direction:column;gap:8px}',
      '.dhns-legend{padding:0;font-size:13px;font-weight:500;',
      'color:var(--dsw-alias-label-primary);margin-bottom:2px}',
      '.dhns-option[data-selected=true]{border-color:var(--dsw-alias-state-business-primary,rgba(44,123,229,.55));',
      'background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-text{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dhns-title{font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.dhns-hint{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}',
      '.dhns-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}',
      '.dhns-btn{font:inherit;font-size:12px;line-height:18px;padding:5px 12px;cursor:pointer;',
      'border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));',
      'background:transparent;color:var(--dsw-alias-label-primary)}',
      '.dhns-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dhns-btn[data-tone=primary]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-primary,#fff);',
      'border-color:var(--dsw-alias-label-primary)}',
      '.dhns-status{font-size:11px;line-height:1.4;color:var(--dsw-alias-state-business-primary,#2c7be5)}',
      '.dhns-subhead{font-size:12px;font-weight:500;letter-spacing:.02em;',
      'color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.dhns-picked{display:flex;flex-direction:column;gap:6px;margin-top:4px}',
      '.dhns-pickedRow{display:flex;align-items:center;gap:10px;padding:6px 10px;',
      'border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.18))}',
      '.dhns-pickedRow .dhns-hint{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dhns-sel{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'color:var(--dsw-alias-label-secondary);max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('')

    function syncStyle() {
      if (typeof document === 'undefined') return null
      let tag = document.querySelector('style[' + STYLE_ATTR + ']')
      if (tag === null) {
        tag = document.createElement('style')
        tag.setAttribute(STYLE_ATTR, '1')
        document.head.appendChild(tag)
      }
      const css = '/* dsh-sidebar-declutter */\n' + hiddenRules().join('\n') + '\n' + FORM_CSS
      // The tag outlives the module instance: a newer build re-executing in the
      // same document must rewrite it rather than keep the old stylesheet.
      if (tag.textContent !== css) tag.textContent = css
      return tag
    }

    // --- action row -------------------------------------------------------------
    // `sidebar.panellist` rows are navigation by contract — a click runs
    // `selectPanel(id)` and the id must address a main panel, so an action has no
    // seat there. This row is therefore inserted into the rendered list.
    //
    // The anchor matters: a bare `[class*="_panelList"]` query can match a
    // same-named class in another package, and appending into the wrong container
    // produced a node that covered the window. The list is now located from the
    // sidebar's own `data-sidebar-toggle` attribute, checked by size, and the
    // inserted row is measured afterwards — anything that reads as an overlay is
    // removed on the spot.

    const FN_ROW_ATTR = 'data-dsh-fn-row'
    let fnRowButton = null
    let fnObserver = null
    let fnScheduled = false

    /** The panel list inside the sidebar column, located from the same anchor. */
    function findPanelNav() {
      if (typeof document === 'undefined') return null
      const toggle = document.querySelector('[data-sidebar-toggle]')
      if (toggle === null) return null
      let node = toggle.parentElement
      while (node !== null && node !== document.body) {
        const nav = node.querySelector('[class*="_panelList"]')
        if (nav !== null) {
          const rect = nav.getBoundingClientRect()
          if (rect.width > 0 && rect.width < 520) return nav
        }
        node = node.parentElement
      }
      return null
    }

    /**
     * The top strip: the row holding the sidebar's collapse toggle. Its own
     * `data-sidebar-toggle` attribute is the anchor, so `parentElement` is the
     * strip itself — no class-suffix guessing, and nothing else can match.
     */
    function findTopStrip() {
      if (typeof document === 'undefined') return null
      const toggle = document.querySelector('[data-sidebar-toggle]')
      if (toggle === null) return null
      const strip = toggle.parentElement
      if (strip === null || strip === document.body) return null
      const rect = strip.getBoundingClientRect()
      // A sidebar strip; anything wider is a different layout entirely.
      if (rect.width === 0 || rect.width > 520) return null
      return { strip, toggle }
    }

    /**
     * Stamp each rendered panel row with the registration id it belongs to, so a
     * hide rule can name the panel instead of its (possibly shared) label. Rows
     * are matched by label first; when several panels share one, the buttons and
     * the entries are paired in render order. A failed pass hides nothing, which
     * is the safe direction: the user still sees every panel and can re-tick it.
     */
    function stampPanelRows() {
      const nav = findPanelNav()
      if (nav === null) return
      const buttons = Array.from(nav.querySelectorAll(':scope > button[aria-label]'))
        .filter((one) => !one.hasAttribute(FN_ROW_ATTR))
      if (buttons.length === 0) return

      const claimed = new Set()
      const take = (label) => {
        const hit = panelEntries.find((entry) => entry.label === label && !claimed.has(entry.id))
        if (hit === undefined) return null
        claimed.add(hit.id)
        return hit.id
      }
      for (const button of buttons) {
        const label = button.getAttribute('aria-label') ?? ''
        const id = take(label)
        if (id === null) {
          button.removeAttribute('data-dsh-panel')
          continue
        }
        if (button.getAttribute('data-dsh-panel') !== id) button.setAttribute('data-dsh-panel', id)
      }
    }

    function allFunctionRows() {
      if (typeof document === 'undefined') return []
      return Array.from(document.querySelectorAll('[' + FN_ROW_ATTR + ']'))
    }

    function removeFunctionRow() {
      for (const stale of allFunctionRows()) stale.remove()
      fnRowButton = null
    }

    /**
     * Collapse or expand the list. This writes one boolean and nothing else —
     * the manual set stays exactly as the user left it.
     */
    function toggleCollapse() {
      values = { ...values, collapsedAll: values.collapsedAll !== true }
      writeStore()
      syncStyle()
      syncFunctionRow()
      notify()
    }

    function functionRowLabel() {
      return values.collapsedAll === true ? '全部展开' : '全部收起'
    }

    function refreshFunctionRow() {
      if (fnRowButton === null) return
      const label = functionRowLabel()
      fnRowButton.setAttribute('aria-pressed', values.collapsedAll === true ? 'true' : 'false')
      fnRowButton.setAttribute('aria-label', label)
      fnRowButton.setAttribute('title', label)
    }

    const FN_ICON =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.6" aria-hidden="true"><path d="M3 3l18 18"/>'
      + '<path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/>'
      + '<path d="M6.5 6.9C4.6 8.2 3.2 10 2.5 12c1.4 3.6 5 6 9.5 6 1.6 0 3.1-.35 4.4-1"/>'
      + '<path d="M19.4 15.1c.9-1 1.6-2 2.1-3.1-1.4-3.6-5-6-9.5-6-.9 0-1.8.1-2.6.35"/></svg>'

    function syncFunctionRow() {
      try {
        syncFunctionRowInner()
      } catch (error) {
        console.warn('[dsh-sidebar-declutter] 功能按钮同步失败：', error)
      }
    }

    function syncFunctionRowInner() {
      if (typeof document === 'undefined') return
      if (values.fnRow !== true) {
        removeFunctionRow()
        return
      }
      const found = findTopStrip()
      if (found === null) return
      const { strip, toggle } = found

      const existing = allFunctionRows()
      const owned =
        existing.length === 1 && existing[0] === fnRowButton && fnRowButton.parentElement === strip
      if (owned) {
        refreshFunctionRow()
        return
      }
      removeFunctionRow()

      const row = document.createElement('button')
      row.type = 'button'
      row.setAttribute(FN_ROW_ATTR, '1')
      // Reuse the toggle's own button class so geometry and hover match, minus
      // the toggle-specific one.
      const buttonClass = String(toggle.className)
        .split(/\s+/)
        .filter((one) => one !== '' && !/_toggle\b/.test(one))
        .join(' ')
      if (buttonClass !== '') row.className = buttonClass
      row.setAttribute('aria-label', functionRowLabel())
      row.setAttribute('aria-pressed', values.collapsedAll === true ? 'true' : 'false')
      row.setAttribute('title', functionRowLabel())
      // The strip is a window-drag region; without this the click starts a drag.
      row.style.webkitAppRegion = 'no-drag'
      row.style.display = 'inline-flex'
      row.style.alignItems = 'center'
      row.style.justifyContent = 'center'
      row.style.background = 'none'
      row.style.border = 'none'
      row.style.padding = '0'
      row.style.cursor = 'pointer'
      row.style.color = 'inherit'
      row.innerHTML = FN_ICON

      row.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        toggleCollapse()
      })
      try {
        strip.insertBefore(row, toggle)
      } catch {
        // The toggle may not be a direct child of the strip after a layout
        // change; appending still keeps the button inside the same row.
        try {
          strip.appendChild(row)
        } catch {
          return
        }
      }

      // Self-check: this seat holds one 28px icon button. Anything that reports
      // more than that is not a button, and is undone immediately.
      const rowRect = row.getBoundingClientRect()
      if (rowRect.width > 56 || rowRect.height > 56) {
        row.remove()
        console.warn('[dsh-sidebar-declutter] 功能按钮尺寸异常，已回退（未注入）。')
        return
      }
      fnRowButton = row
    }

    function watchFunctionRow() {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return null
      fnObserver = new MutationObserver(() => {
        if (fnScheduled) return
        fnScheduled = true
        // setTimeout, not requestAnimationFrame: a background tab pauses rAF, and
        // a row removed while the window is hidden would never come back.
        setTimeout(() => {
          fnScheduled = false
          stampPanelRows()
          syncFunctionRow()
        }, 0)
      })
      fnObserver.observe(document.body, { childList: true, subtree: true })
      stampPanelRows()
      syncFunctionRow()
      return () => {
        fnObserver?.disconnect()
        fnObserver = null
        removeFunctionRow()
      }
    }

    // --- pick mode -------------------------------------------------------------
    // The switches above cover the rows this bundle was written for. "Hide
    // anything" needs the user to point at the element, so this mode captures one
    // click at a time, turns the target into a selector, and appends it to the
    // stored list. Every pick stays restorable from the plugin page.

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
    let panelEntries = []

    /** Escape a value for a double-quoted CSS attribute selector. */
    function cssAttrValue(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    }

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
      return false
    }

    function addPicked(el) {
      const selector = buildSelector(el)
      if (selector.trim() === '') return null
      if (values.picked.some((one) => one.selector === selector)) return { selector, duplicate: true }
      const entry = { selector, label: labelFor(el) }
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

    function notify() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // One broken subscriber must not stop the rest.
        }
      }
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
            ? '这一项已经隐藏过了'
            : '已隐藏：' + labelFor(el) + '（可撤销）'
        setTimeout(refreshBar, 1400)
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

    /**
     * The plugin page card, registered at `plugins.row.config` for this bundle's
     * row. `summary` is the one-liner the row shows when collapsed; `page` is the
     * form the row's configure control opens.
     */
    function SettingsCard(props) {
      const view = props?.view
      const [, forceRender] = React.useReducer((count) => count + 1, 0)
      React.useEffect(() => subscribe(forceRender), [])

      if (view === 'summary') {
        // Only the hide section belongs in the one-liner; the layout switch is
        // not something the row can meaningfully report as "hidden".
        const on = FIELDS.filter((field) => field.kind === 'hide' && values[field.key] === true)
          .map((field) => field.title)
        return h('span', null, on.length === 0 ? '未隐藏任何项' : '已隐藏：' + on.join('、'))
      }

      /** Where the action button stands right now, readable without DevTools. */
      const actionRowStatus = () => {
        if (values.fnRow !== true) return '已关闭'
        if (typeof document === 'undefined') return '页面未就绪'
        const found = allFunctionRows().length
        if (found > 0) return '已插入'
        const strip = typeof findTopStrip === 'function' ? findTopStrip() : null
        return strip === null ? '找不到侧栏顶栏（折叠按钮不存在）' : '找到顶栏，但插入失败'
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
            field.key === 'fnRow'
              ? h('span', { className: 'dhns-status' }, '状态：' + actionRowStatus())
              : null,
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
          { key: field.key, className: 'dhns-choice', 'aria-label': field.title },
          h('legend', { className: 'dhns-legend' }, field.title),
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

      const panelBlock = () => {
        if (panelEntries.length === 0) {
          return h('p', { className: 'dhns-hint' }, '当前没有检测到已注册的面板。')
        }
        return h(
          'div',
          { className: 'dhns-rows' },
          h('div', { className: 'dhns-subhead', key: 'subhead' }, '面板'),
          panelEntries.map((entry) =>
            h(
              'label',
              { key: entry.id, className: 'dhns-row' },
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
        )
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
              running ? '结束点选' : '开始点选隐藏',
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
                  '全部恢复',
                ),
          ),
          values.picked.length === 0
            ? null
            : h(
                'div',
                { className: 'dhns-picked', key: 'list' },
                values.picked.map((one, index) =>
                  h(
                    'div',
                    { className: 'dhns-pickedRow', key: one.selector + ':' + index },
                    h('code', { className: 'dhns-sel', title: one.selector }, one.selector),
                    h('span', { className: 'dhns-hint' }, one.label),
                    h(
                      'button',
                      { type: 'button', className: 'dhns-btn', onClick: () => removePickedAt(index) },
                      '恢复',
                    ),
                  ),
                ),
              ),
        ]
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
            section.kind === 'picked' ? pickedBlock() : null,
            section.fields.length === 0 ? null : h('div', { className: 'dhns-rows' }, section.fields.map(renderField)),
            section.panels === true ? panelBlock() : null,
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        values = readStore()

        // Started first: if anything later throws, the button still gets a chance
        // to appear and the console carries the reason.
        ctx.effect(() => {
          try {
            return watchFunctionRow()
          } catch (error) {
            console.warn('[dsh-sidebar-declutter] 功能按钮安装失败：', error)
            return undefined
          }
        }, 'dsh-sidebar-declutter: action row')

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

        ctx.effect(() => {
          try {
            stampPanelRows()
          } catch (error) {
            console.warn('[dsh-sidebar-declutter] 面板打标失败：', error)
          }
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

        // Dead-man switch: the collapse layer is only reachable through a button
        // that lives in a React-owned row. If that button is ever missing while
        // the list is collapsed, expand instead of trapping the user.
        ctx.effect(() => {
          const timer = setInterval(() => {
            if (values.collapsedAll !== true) return
            if (document.querySelector('[' + FN_ROW_ATTR + ']') !== null) return
            syncFunctionRow()
            if (document.querySelector('[' + FN_ROW_ATTR + ']') !== null) return
            values = { ...values, collapsedAll: false }
            writeStore()
            syncStyle()
            notify()
            console.warn('[dsh-sidebar-declutter] 展开按钮缺失，已自动展开面板以免锁死。')
          }, 3000)
          return () => clearInterval(timer)
        }, 'dsh-sidebar-declutter: dead-man switch')


        ctx.effect(() =>
          ctx.slots.inject('plugins.row.config', () =>
            ctx.slots.register({ name: 'plugins.row.config', key: ROW_CONFIG_KEY }, SettingsCard),
          ),
        )
      },
    }
  },
})