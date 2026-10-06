# dsh-declutter

A **view declutterer** for DeepSeek Harness. It puts parts of the transcript away
that the platform drew but the user does not want to read.

It does not delete anything. It does not edit the session log. Every action is an
attribute on a node the platform owns, fully reversible, and every rule that
decides to act is a row in one table with its own self-check.

## The first principle

**The log is the append-only record of what happened. This plugin's whole value
is putting the facts away, not erasing them.**

Concretely, and enforced mechanically by `test/host.test.js`:

* there is no `append`, no `surfaceOp`, no `sessionController` and no
  `SessionStore` reference anywhere in `src/` — comments naming them are fine,
  code is not;
* the host half only ever *reads* through `sessionQuery.readSession`, the
  official service, so the event shapes it reasons about are the ones the runtime
  itself validated and persisted;
* every visible change is a `data-dshdc-*` attribute plus a stylesheet keyed to
  it, and the teardown pass removes exactly those and nothing else.

## The rule table

One table, in [src/logic.js](src/logic.js). Adding a rule means adding one object
there. Nothing else needs to change: the host iterates the table to answer the
self-check, and the browser half *fetches the same table over HTTP* and executes
whatever view descriptors it finds. The browser half contains no branch for any
specific rule and never learns what `stale-turn-error` means.

| id | symptom (why the rule exists) | log criterion | view action |
| --- | --- | --- | --- |
| `stale-turn-error` | A turn reported a failure and the same work later succeeded, so the transcript holds two contradictory statements and the user reads the failure as the truth. | A turn that closed with `reason.kind === 'error'` **and** carries later evidence of success: the same turn closed again without an error, **or** a `request/header` with `reason === 'resume'` was followed by a real `assistant/message`, **or** a later turn answered the same prompt fingerprint. | collapse the `[class*="_turnErrorRow"]` notice, leaving an expandable one-line summary |
| `empty-turn` | A turn opened, ran and closed with nothing to show; the user cannot tell "nothing happened" from "content was swallowed". | A closed turn with **zero** surface events (`system/message`, `developer/message`, `user/message`, `assistant/message`, `tool/result`). Failed turns are excluded by default so the two rules never report one turn twice. | **none — see below** |
| `edit-turn-synthetic` | Editing an earlier answer opens a synthetic turn; the transcript shows it with no explanation, as if the assistant volunteered a second answer. | A turn containing a message whose `source.editedBy` names the configured producer (`dsh-edit-turn` by default). Carriers, which keep the *original* turn number, are counted but not flagged. | annotate the trajectory section-start row with a badge |

### Why `empty-turn` has no view action

The trajectory view builds rows per *cell*, and it builds no cell for a turn with
no content — `pushStep` and `pushMessage` both return early when the laid-out
list is empty. **A turn with nothing in it produces no row, so there is nothing to
mark.** Rather than put a badge on a neighbouring turn, the rule reports
`view: null`, the self-check labels it `host-only`, and the browser half skips it.

It is also worth knowing that this shape may simply not occur in practice: across
a real 116-turn session, **zero** turns had no surface events.

## Configuration

Retire or reconfigure any rule by id. No code change, no second place to edit:

```yaml
- id: dsh-declutter
  name: 'dsh-declutter'
  config:
    rules:
      empty-turn:
        enabled: false          # retire it
      stale-turn-error:
        options:
          signals: ['resumed']  # only consider the resume signal
      edit-turn-synthetic:
        options:
          producers: ['dsh-edit-turn', 'some-other-editor']
          scope: 'any'          # include carriers, not just corrections
```

A rule id that matches nothing in the table is reported in the state as
`unknownRuleConfig` rather than being ignored, so a typo in a retirement does not
silently leave a rule running.

## The self-check

```
GET /dsh-declutter/state                 -> 400   (mount probe: 404 means "not installed")
GET /dsh-declutter/state?sessionId=<id>  -> 200   the per-rule self-check
POST /dsh-declutter/report                       the browser half's anchor health
```

The host half knows what the log says; the browser half knows what the DOM looks
like. The state merges both, per rule:

| field | meaning |
| --- | --- |
| `matches` | how many places in this log the rule found today |
| `lastMatchAt` | when the most recent one happened (`null` = never) |
| `anchorOk` | `true` the selector resolved nodes, `false` the surface is on screen and it resolved **nothing**, `null` the surface is not on screen so the answer is unknown |
| `applied` | how many nodes the browser half actually acted on |
| `verdict` | one-glance state — see below |

```
off         disabled by configuration
broken      the rule's judge threw; it is isolated and cannot affect the others
host-only   the rule has no view anchor by design
unmounted   the surface is not on screen, so anchor health is unknown
ok          matches > 0 and the anchor resolves
quiet       matches === 0
alarm       matches > 0 but the anchor resolves NOTHING — the selector has rotted
```

**`alarm` is the state this endpoint exists for.** `matches: 0` is never hidden
either: a rule that has silently stopped matching is the other half of the same
failure, and it looks identical to a working rule with nothing to do unless you
can see the count.

## Platform anchors, and how fragile they are

DSH style names are CSS-module hashes (`Sixlwa_turnErrorRow`) and the prefix is
regenerated on every build, so **a rule must never write the full class name.**
The rules anchor on a local-name fragment (`[class*="_turnErrorRow"]`) or, far
better, on a `data-*` attribute.

| what | anchor | stability |
| --- | --- | --- |
| the failure / max-tokens notice | `[class*="_turnErrorRow"]` | **fragile** — local name fragment, no `data-*` alternative exists |
| which turn a notice belongs to | `closest('[data-chat-turn]')` | **stable** — a real `data-*` attribute every chat flow item carries |
| failure notice vs max-tokens notice | `closest('[data-chat-flow-kind="turn-error"]')` | **stable** — both notices share one CSS class, so this guard is load-bearing |
| a trajectory turn boundary row | `tr[data-turn-start="true"]` | **stable** |
| the turn number on that row | `[class*="_turnLabelCompact"]` text `#<n>` | **fragile** — a local name fragment *and* a text parse; the only turn number the trajectory table publishes |

### R1's DOM mapping, verified

The error block is **not** a loose node. Every chat flow item is a wrapper
`<div class="…flowItem" data-chat-turn="N" data-chat-flow-kind="…">` and the
notice renders inside it, so the turn number is a real attribute one `closest()`
away:

```html
<div data-chat-turn="86" data-chat-flow-kind="turn-error" data-chat-node-key="…">
  <div class="Sixlwa_turnErrorRow" role="status">
    <span class="Sixlwa_turnErrorDot"></span>
    <div class="Sixlwa_turnErrorCopy">…</div>
    <code class="Sixlwa_turnErrorCode">TRANSPORT</code>
  </div>
</div>
```

Verified against the installed build:

| file | lines | what it proves |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-chat/lib/client.js` | 1757–1766 | the flow item wrapper, `data-chat-turn` at 1766 |
| same | 1285–1311 | `TurnErrorItem` → `turnErrorRow` + `role="status"` |
| same | 1312–1334 | `TurnMaxTokensItem` → the **same** class name |
| same | 1659–1662 | `turnOf`: the number comes from `location.turn.turn` |
| `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` | 1776–1786 | a step-less turn node resolves to `{ kind: 'turn', turn }`, which is why the attribute is always populated |

The chain closes: a `turn/end` with `reason.kind === 'error'` creates a
`turn-error` chat node, whose location is the turn, whose number the wrapper
publishes as `data-chat-turn`. Nothing in that chain is a text parse.

## What this plugin does to the DOM

* **Adopt, never rebuild.** The platform's node stays exactly where it is, with
  all of its own children and attributes untouched.
* **One namespace.** Only `data-dshdc-*` attributes and `[data-dshdc-toggle]` /
  `[data-dshdc-badge]` elements. Nothing else is ever cleared, so another
  plugin's markers on the same node survive.
* **Idempotent and re-appliable.** A `MutationObserver` batched on
  `requestAnimationFrame` re-runs an idempotent sweep. That is what makes the
  trajectory half viable at all: its virtual list discards rows and builds new
  ones as you scroll, so a marker placed once disappears almost immediately. The
  sweep keys on the row's own identity and reports the same result however many
  times it runs.
* **Reversible.** The collapse is a `data-dshdc-collapsed` attribute plus a
  stylesheet rule. React re-renders the children; it does not manage that
  attribute, so the state survives, and a click flips it back.
* **Loopback only.** Same guards as the rest of the house: loopback socket,
  loopback `Host`, and a same-origin check when an `Origin` is present.

## Testing

```
node --test test/*.test.js
```

67 tests: pure log rules, the HTTP routes, the DOM executor against a stub DOM,
and negative verification. No browser and no dependency beyond what Node ships —
`test/dom-stub.js` is a small DOM implementing exactly the selector surface the
engine uses, and it **throws** on a selector it does not understand rather than
quietly matching nothing.

The log fixtures are real session events, not approximations: every one is pushed
through `snapshotSessionEvent` from `@deepseek-ai/dsh-session`, the runtime's own
validator. That package is not a dependency of this plugin, so the suite resolves
it opportunistically — link it into `node_modules` to have the validation run,
or the suite reports it as skipped rather than pretending it passed.

To read the self-check against a real transcript over a real socket:

```
node tools/probe-state.mjs /path/to/session.jsonl
```

## Where this will rot first

1. `[class*="_turnErrorRow"]` — the notice has no `data-*` attribute, so a
   rename of that local class name (or a refactor that stops using
   `MessageItem.module.css`) breaks R1 silently. The self-check turns to
   `alarm` when it does, which is exactly why `anchorOk` is not optional.
2. The trajectory turn label — `[class*="_turnLabelCompact"]` read as text
   `#<n>`. It is a local name fragment *and* a text parse, and it is the weakest
   anchor in the plugin. It is also the only turn number the trajectory table
   publishes at all.
3. `source.editedBy` is a **plugin-level** convention, not a platform one.
   Nothing under `@deepseek-ai` writes it, so R3 detects only producers that
   volunteer the marker. If `dsh-edit-turn` renames it, R3 goes quiet and
   `producers: []` in the self-check is the only clue.
4. A rule whose view descriptor is dropped from the served table stops being
   executed with no error anywhere. The `applied` count is the intended tell.

## License

MIT
