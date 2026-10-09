# dsh-declutter

**DSH 界面「收纳」插件 —— 把平台画出来、但你不想读的部分收起来。** 它不删除任何东西，不改会话日志：每一次动作都是平台自己节点上的一个属性，完全可逆；而每一条"决定动手"的规则都是同一张表里的一行，各自带自检。收起的是**读起来的样子**，不是**发生过的事实**。

它专门治三种"看着像真的、其实误导"的行：**已经失败但后来成功的轮次**（同一件事留下了两条互相矛盾的记录）、**开了却什么都没发生的空轮**、**编辑旧回答产生的合成轮**（看起来像模型自己又答了一遍）。每条规则都能按 id 单独关掉或改参数，不用改代码。

[中文](#中文) · [English](#english)

---

## 中文

### 安装

```sh
# 通过插件管理器（推荐）
dsh plugin --profile web add dsh-declutter

# 重启 dsh web，之后硬刷新浏览器
```

开发时也可以直接挂工作树：

```sh
dsh plugin --profile web add "link:/path/to/dsh-declutter"
```

### 第一条原则

**日志是"发生过什么"的追加式记录。这个插件的全部价值在于把事实收起来，而不是抹掉它。**

这一点由 `test/host.test.js` 机械地强制：

* `src/` 里**没有** `append`、没有 `surfaceOp`、没有 `sessionController`、没有 `SessionStore` 引用——注释里提到它们可以，代码里不行；
* 宿主半区只通过 `sessionQuery.readSession` 这个官方服务**读**，所以它推理用的事件形状，正是运行时自己校验并落盘过的那些；
* 每一处可见改动都是一个 `data-dshdc-*` 属性 + 一张以它为键的样式表；拆除时只清掉这些，别的一律不动。

### 规则表

只有一张表，在 [src/logic.js](src/logic.js)。加一条规则 = 在那里加一个对象，别处都不用动：宿主遍历这张表回答自检，浏览器半区**通过 HTTP 取同一张表**，执行里面出现的视图描述符。浏览器半区里没有任何针对具体规则的分支，它也永远不知道 `stale-turn-error` 是什么意思。

| id | 症状（为什么有这条规则） | 日志判据 | 视图动作 |
| --- | --- | --- | --- |
| `stale-turn-error` | 某一轮报了失败，同一件事后来成功了——于是记录里留下两条互相矛盾的话，而用户会把失败当成事实读。 | 该轮以 `reason.kind === 'error'` 收尾**且**带有更晚的成功证据：同轮后来又无错地收尾过一次，**或**一条 `reason === 'resume'` 的 `request/header` 之后跟着真正的 `assistant/message`，**或**更晚的某一轮回答了相同的 prompt 指纹。 | 收起 `[class*="_turnErrorRow"]` 提示，只留一行可展开的摘要 |
| `empty-turn` | 某一轮开了、跑了、什么都没留下就收尾；用户分不清"什么都没发生"和"内容被吞了"。 | 已收尾且**零**个表面事件（`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`）的轮次。默认排除失败轮，这样两条规则永远不会对同一轮各报一次。 | **无——见下** |
| `edit-turn-synthetic` | 编辑更早的回答会开出一个合成轮；记录里它没有任何说明地出现，像是模型自己又答了一遍。 | 某轮包含一条消息，其 `source.editedBy` 命中配置的生产者（默认 `dsh-edit-turn`）。保留**原轮号**的载体（carrier）会被计数但不标记。 | 在轨迹的分节起始行上加一个徽标 |

#### 为什么 `empty-turn` 没有视图动作

轨迹视图是按**单元格**建行的，而一个没有内容的轮次根本不会产生单元格——`pushStep` 和 `pushMessage` 在排布列表为空时都会提前返回。**空轮不产生行，所以没有东西可以标记。** 与其把徽标贴到相邻轮次上，这条规则直接报 `view: null`，自检把它标成 `host-only`，浏览器半区跳过它。

也值得知道：这种形状在现实中可能压根不出现——在一个真实的 116 轮会话里，**零**个轮次没有表面事件。

### 配置

按 id 退掉或重新配置任何一条规则。不用改代码，也没有第二处要改：

```yaml
- id: dsh-declutter
  name: 'dsh-declutter'
  config:
    rules:
      empty-turn:
        enabled: false          # 退掉它
      stale-turn-error:
        options:
          signals: ['resumed']  # 只考虑 resume 这一个信号
      edit-turn-synthetic:
        options:
          producers: ['dsh-edit-turn', 'some-other-editor']
          scope: 'any'          # 连载体一起纳入，而不只是纠正
```

配置里出现了表里没有的 id，会在状态里报成 `unknownRuleConfig`，而不是被悄悄忽略——这样"退掉一条规则"时打错字，不会留下一条还在跑的规则。

### 自检

```
GET /dsh-declutter/state                 -> 400   （挂载探针：404 表示"没装"）
GET /dsh-declutter/state?sessionId=<id>  -> 200   逐条规则的自检
POST /dsh-declutter/report                       浏览器半区上报锚点健康度
```

宿主半区知道日志说了什么，浏览器半区知道 DOM 长什么样。状态把两边按规则合并：

| 字段 | 含义 |
| --- | --- |
| `matches` | 这条规则今天在这份日志里找到多少处 |
| `lastMatchAt` | 最近一次发生在什么时候（`null` = 从未） |
| `anchorOk` | `true` = 选择器解析到了节点；`false` = 界面就在屏幕上却**什么都没解析到**；`null` = 界面不在屏幕上，无法判断 |
| `applied` | 浏览器半区实际动手了多少个节点 |
| `verdict` | 一眼可见的状态——见下 |

```
off         被配置关掉
broken      该规则的判定器抛错了；它被隔离，不影响其它规则
host-only   该规则按设计没有视图锚点
unmounted   界面不在屏幕上，锚点健康度未知
ok          matches > 0 且锚点能解析
quiet       matches === 0
alarm       matches > 0 但锚点什么都解析不到——选择器烂了
```

**`alarm` 就是这个端点存在的理由。** `matches: 0` 也从不被藏起来：一条已经悄悄停止匹配的规则，是同一种失败的另一半，而它和"一条没事可做的正常规则"看上去一模一样——除非你能看见计数。

### 平台锚点与它的脆弱程度

DSH 的样式名是 CSS-module 哈希（`Sixlwa_turnErrorRow`），前缀每次构建都会重新生成，所以**规则绝不能写完整类名**。规则锚定在局部名片段（`[class*="_turnErrorRow"]`）上，或者——好得多——锚定在 `data-*` 属性上。

| 什么 | 锚点 | 稳定性 |
| --- | --- | --- |
| 失败 / 超长提示 | `[class*="_turnErrorRow"]` | **脆弱**——局部名片段，而且没有 `data-*` 可选 |
| 提示属于哪一轮 | `closest('[data-chat-turn]')` | **稳定**——每个聊天流条目都带的真 `data-*` 属性 |
| 失败提示 vs 超长提示 | `closest('[data-chat-flow-kind="turn-error"]')` | **稳定**——两种提示共用一个 CSS 类，所以这道守卫是承重的 |
| 轨迹的轮次分界行 | `tr[data-turn-start="true"]` | **稳定** |
| 那一行上的轮号 | `[class*="_turnLabelCompact"]` 文本 `#<n>` | **脆弱**——局部名片段**加上**文本解析；这是轨迹表唯一公布的轮号 |

#### R1 的 DOM 映射（已核实）

错误块**不是**一个游离节点。每个聊天流条目都是包装元素 `<div class="…flowItem" data-chat-turn="N" data-chat-flow-kind="…">`，提示渲染在它里面，所以轮号就是一次 `closest()` 之外的真属性：

```html
<div data-chat-turn="86" data-chat-flow-kind="turn-error" data-chat-node-key="…">
  <div class="Sixlwa_turnErrorRow" role="status">
    <span class="Sixlwa_turnErrorDot"></span>
    <div class="Sixlwa_turnErrorCopy">…</div>
    <code class="Sixlwa_turnErrorCode">TRANSPORT</code>
  </div>
</div>
```

对着已安装的构建核实过：

| 文件 | 行 | 它证明了什么 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-ui-chat/lib/client.js` | 1757–1766 | 聊天流条目包装元素，`data-chat-turn` 在 1766 |
| 同上 | 1285–1311 | `TurnErrorItem` → `turnErrorRow` + `role="status"` |
| 同上 | 1312–1334 | `TurnMaxTokensItem` → **同一个**类名 |
| 同上 | 1659–1662 | `turnOf`：轮号来自 `location.turn.turn` |
| `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` | 1776–1786 | 无步骤的轮次节点解析成 `{ kind: 'turn', turn }`，所以那个属性总是有值 |

链路闭合：`turn/end` 带 `reason.kind === 'error'` 会造出一个 `turn-error` 聊天节点，它的 location 就是那一轮，而包装元素把轮号公布成 `data-chat-turn`。这条链上没有一处是文本解析。

### 它对 DOM 做什么

* **只收编，不重建。** 平台的节点原地不动，它自己的所有子节点与属性一概不碰。
* **单一命名空间。** 只用 `data-dshdc-*` 属性与 `[data-dshdc-toggle]` / `[data-dshdc-badge]` 元素。别的东西从不被清除，所以同一个节点上别的插件的标记能活下来。
* **幂等、可重复施加。** 一个按 `requestAnimationFrame` 批量触发的 `MutationObserver` 反复跑同一遍幂等清扫。这正是轨迹那一半能成立的原因：它的虚拟列表会随着你滚动丢掉行、建出新行，所以"贴一次"的标记几乎立刻就没了。清扫以行自身的身份为键，跑多少次都报同一个结果。
* **可逆。** 收起 = 一个 `data-dshdc-collapsed` 属性 + 一条样式表规则。React 会重渲染子节点，但它不管这个属性，所以状态活了下来，点一下就翻回去。
* **只走回环。** 与全仓其余部分同样的守卫：回环 socket、回环 `Host`，以及存在 `Origin` 时的同源校验。

### 测试

```
node --test test/*.test.js
```

67 条测试：纯日志规则、HTTP 路由、对着桩 DOM 的 DOM 执行器，以及反面验证。不需要浏览器，除 Node 自带的之外没有依赖——`test/dom-stub.js` 是一个小 DOM，只实现引擎用到的那点选择器面，而且遇到看不懂的选择器会**抛错**，不会悄悄匹配到零个。

日志夹具是真实的会话事件，不是近似物：每一条都经过 `@deepseek-ai/dsh-session` 的 `snapshotSessionEvent`——运行时自己的校验器。那个包不是本插件的依赖，所以测试套件是**机会性解析**它的：把它链进 `node_modules`，校验就会真的跑；否则套件报成跳过，而不是假装通过。

要对着一份真实记录、走真实 socket 读自检：

```
node tools/probe-state.mjs /path/to/session.jsonl
```

### 它会先烂在哪里

1. `[class*="_turnErrorRow"]`——那个提示没有 `data-*` 属性，所以一旦这个局部类名被改名（或者重构后不再用 `MessageItem.module.css`），R1 会**静默**失效。届时时自检会变成 `alarm`，这正是 `anchorOk` 不是可有可无的原因。
2. 轨迹里的轮号标签——`[class*="_turnLabelCompact"]`，按文本 `#<n>` 读。它既是局部名片段**又是**文本解析，是本插件里最弱的锚点；而它同时又是轨迹表唯一公布轮号的地方。
3. `source.editedBy` 是**插件级**约定，不是平台级的。`@deepseek-ai` 下没有任何东西写它，所以 R3 只能发现"自愿打标记"的生产者。如果 `dsh-edit-turn` 改了名，R3 会转静，自检里的 `producers: []` 是唯一的线索。
4. 一条规则的视图描述符若从被服务的表里掉了，它就停止执行，而任何地方都不会报错。`applied` 计数是为此准备的提示。

### License

MIT

## English

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
