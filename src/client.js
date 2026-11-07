// dsh-hide-new-session — client half.
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
  id: 'dsh-hide-new-session',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** Row-config key: `<bundle package>#<row id from the bundle patch>`. */
    const ROW_CONFIG_KEY = 'dsh-hide-new-session#hide-new-session'
    const STORE_KEY = 'dsh-hide-new-session'
    const STYLE_ATTR = 'data-dsh-hide-new-session'

    /**
     * The page groups its switches under headings; the flat `FIELDS` below is
     * derived from them, so the store, the summary and the rules keep iterating
     * one list while the page renders sections.
     */
    const SECTIONS = [
      {
        kind: 'hide',
        title: '隐藏',
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
        const raw = localStorage.getItem(STORE_KEY)
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
    ].join('')

    function syncStyle() {
      if (typeof document === 'undefined') return null
      let tag = document.querySelector('style[' + STYLE_ATTR + ']')
      if (tag === null) {
        tag = document.createElement('style')
        tag.setAttribute(STYLE_ATTR, '1')
        document.head.appendChild(tag)
      }
      const css = '/* dsh-hide-new-session */\n' + hiddenRules().join('\n') + '\n' + FORM_CSS
      // The tag outlives the module instance: a newer build re-executing in the
      // same document must rewrite it rather than keep the old stylesheet.
      if (tag.textContent !== css) tag.textContent = css
      return tag
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
            h('div', { className: 'dhns-rows' }, section.fields.map(renderField)),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        values = readStore()

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
                '[dsh-hide-new-session] 侧栏已渲染但没匹配到新会话按钮，选择器可能随版本变化。',
              )
            }, 2000)
          }

          return () => {
            if (timer !== null) clearTimeout(timer)
            if (tag !== null) tag.remove()
          }
        }, 'dsh-hide-new-session: stylesheet')

        ctx.effect(() =>
          ctx.slots.inject('plugins.row.config', () =>
            ctx.slots.register({ name: 'plugins.row.config', key: ROW_CONFIG_KEY }, SettingsCard),
          ),
        )
      },
    }
  },
})