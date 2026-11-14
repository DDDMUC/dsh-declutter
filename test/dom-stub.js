// A deliberately small DOM stub, sized to exactly the selector surface the
// dsh-declutter view engine uses.
//
// The engine is written against real browser DOM; this stub exists so the
// view side can be exercised under `node --test` with no browser and no third
// party dependency. It is NOT a general DOM: it implements the selector forms
// the rules table actually declares, and it throws on anything else rather than
// silently matching nothing. That is deliberate — a stub that quietly returns
// an empty list for an unsupported selector would turn "the engine stopped
// working" into "the test still passes".

const ATTR_RE = /\[([a-zA-Z-]+)(?:([*^$~|]?)=["']([^"']*)["'])?\]/g

/** One element. */
class StubElement {
  constructor(tagName, attrs) {
    this.tagName = String(tagName).toUpperCase()
    this.attributes = new Map()
    this.children = []
    this.parentNode = null
    this._text = ''
    this.listeners = new Map()
    this.dataset = new Proxy(
      {},
      {
        get: (_target, key) => {
          const name = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
          return this.attributes.get(name)
        },
        set: (_target, key, value) => {
          const name = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
          this.setAttribute(name, value)
          return true
        },
        has: (_target, key) => {
          const name = 'data-' + String(key).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
          return this.attributes.has(name)
        },
      },
    )
    for (const [key, value] of Object.entries(attrs ?? {})) this.setAttribute(key, value)
  }

  get firstChild() {
    return this.children.length === 0 ? null : this.children[0]
  }

  get textContent() {
    if (this.children.length === 0) return this._text
    return this._text + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value) {
    this._text = String(value ?? '')
    for (const child of this.children) child.parentNode = null
    this.children = []
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value ?? ''))
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  appendChild(child) {
    if (child.parentNode !== null) child.remove()
    child.parentNode = this
    this.children.push(child)
    return child
  }

  insertBefore(child, reference) {
    if (child.parentNode !== null) child.remove()
    child.parentNode = this
    const at = reference === null || reference === undefined ? this.children.length : this.children.indexOf(reference)
    if (at < 0) this.children.push(child)
    else this.children.splice(at, 0, child)
    return child
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  /** Dispatch one event to this element's listeners. */
  dispatch(type, event = {}) {
    let prevented = false
    const payload = {
      type,
      target: this,
      preventDefault: () => {
        prevented = true
      },
      stopPropagation: () => {},
      ...event,
    }
    for (const handler of this.listeners.get(type) ?? []) handler(payload)
    return prevented
  }

  remove() {
    if (this.parentNode === null) return
    const at = this.parentNode.children.indexOf(this)
    if (at >= 0) this.parentNode.children.splice(at, 1)
    this.parentNode = null
  }

  /** Depth-first descendants. */
  descendants() {
    const out = []
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }

  matches(selector) {
    return parseSelector(selector).some((parts) => matchesParts(this, parts))
  }

  closest(selector) {
    let node = this
    while (node !== null) {
      if (node.matches(selector)) return node
      node = node.parentNode
    }
    return null
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector) {
    const alternatives = parseSelector(selector)
    const out = []
    for (const parts of alternatives) {
      if (parts[0] === ':scope') {
        // Only the ':scope > child' form is used.
        if (parts.length !== 2) throw new Error('dom-stub: unsupported :scope form ' + selector)
        for (const child of this.children) {
          if (matchesCompound(child, parts[1]) && !out.includes(child)) out.push(child)
        }
        continue
      }
      if (parts.length !== 1) throw new Error('dom-stub: unsupported selector ' + selector)
      for (const node of this.descendants()) {
        if (matchesCompound(node, parts[0]) && !out.includes(node)) out.push(node)
      }
    }
    return out
  }
}

/** Split a selector list into its alternatives, each split on '>'. */
function parseSelector(selector) {
  return String(selector)
    .split(',')
    .map((alternative) =>
      alternative
        .split('>')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    )
    .filter((parts) => parts.length > 0)
}

function matchesParts(element, parts) {
  if (parts.length === 1) return matchesCompound(element, parts[0])
  throw new Error('dom-stub: unsupported selector chain ' + parts.join(' > '))
}

function matchesCompound(element, spec) {
  let rest = spec.trim()
  if (rest === '') throw new Error('dom-stub: empty compound selector')
  if (rest.startsWith(':scope')) return false

  const tagMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest)
  if (tagMatch !== null) {
    if (element.tagName !== tagMatch[0].toUpperCase()) return false
    rest = rest.slice(tagMatch[0].length)
  }

  if (rest.includes(':last-of-type')) {
    const siblings = element.parentNode === null ? [] : element.parentNode.children.filter((c) => c.tagName === element.tagName)
    if (siblings[siblings.length - 1] !== element) return false
    rest = rest.replace(/:last-of-type/g, '')
  }

  if (rest.includes(':')) throw new Error('dom-stub: unsupported pseudo in ' + spec)

  ATTR_RE.lastIndex = 0
  let consumed = 0
  let match
  while ((match = ATTR_RE.exec(rest)) !== null) {
    consumed += match[0].length
    const [, name, operator, value] = match
    const actual = element.getAttribute(name)
    if (operator === undefined) {
      if (actual === null) return false
      continue
    }
    if (actual === null) return false
    if (operator === '*') {
      if (!actual.includes(value)) return false
    } else if (operator === '^') {
      if (!actual.startsWith(value)) return false
    } else if (operator === '$') {
      if (!actual.endsWith(value)) return false
    } else if (operator === '~') {
      if (!actual.split(/\s+/).includes(value)) return false
    } else if (operator === '|') {
      if (actual !== value && !actual.startsWith(value + '-')) return false
    } else if (actual !== value) {
      return false
    }
  }
  if (consumed !== rest.replace(/\s+/g, '').length + 0) {
    // Leftover text means an attribute form this stub does not understand.
    const stripped = rest.replace(ATTR_RE, '').trim()
    if (stripped !== '') throw new Error('dom-stub: unsupported selector fragment ' + JSON.stringify(stripped))
  }
  return true
}

/** Minimal document with the members the engine and the CSS loader touch. */
function createDocument() {
  const root = new StubElement('#root')
  const head = new StubElement('head')
  root.appendChild(head)
  const document = {
    head,
    documentElement: root,
    hidden: false,
    createElement: (tag) => new StubElement(tag),
    querySelector: (selector) => (selector.startsWith('style') ? head.querySelector(selector) : root.querySelector(selector)),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    body: null,
  }
  const body = new StubElement('body')
  root.appendChild(body)
  document.body = body
  document._root = root
  document._head = head
  return document
}

/**
 * Evaluate src/client.js against a fresh stub document.
 * @returns `{ api, document, element }` where `api` is the module exports.
 */
export async function loadClient() {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const document = createDocument()

  let registered = null
  const window = {
    __ModuleLoader__: {
      load: (spec) => {
        registered = spec
      },
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
  }

  const reactStub = {
    useEffect: () => {},
    createElement: (tag, props, ...children) => ({ tag, props, children }),
  }
  const require = (id) => {
    if (id === 'react') return reactStub
    throw new Error('dom-stub: unexpected require ' + id)
  }

  const factory = new Function(
    'window',
    'document',
    'MutationObserver',
    'requestAnimationFrame',
    'fetch',
    'require',
    'module',
    'exports',
    source + '\nreturn { window, document };',
  )

  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback
      this.observations = []
      MutationObserverStub.instances.push(this)
    }
    observe(target, options) {
      this.observations.push({ target, options })
    }
    disconnect() {
      this.disconnected = true
    }
  }
  MutationObserverStub.instances = []

  factory(window, document, MutationObserverStub, (fn) => fn(), () => Promise.reject(new Error('no fetch')), require, {}, {})

  if (registered === null) throw new Error('client bundle did not register with __ModuleLoader__')
  const module = { exports: {} }
  const api = registered.factory(require)
  return { api, document, element: (tag, attrs, children) => build(document, tag, attrs, children), MutationObserverStub, window }
}

function build(document, tag, attrs, children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value)
  for (const child of children ?? []) node.appendChild(child)
  return node
}

export { StubElement, createDocument, parseSelector, matchesCompound }
