# dsh-ui-hide

[English](README.en.md) | 中文

DSH 侧栏整理插件：按开关收起顶部品牌行、「新会话」按钮和三处「更多」入口，并把面板列表改成一行两个（或自动紧凑排布）。纯样式注入，**不改源码、不动会话数据**，禁用或卸载即完全还原。

## 安装

在 DSH 的**插件**页 → 安装 → 填入包名或仓库地址：

```bash
# npm（推荐）
dsh plugin install dsh-ui-hide

# 或直接从仓库
dsh plugin install https://github.com/DDDMUC/dsh-ui-hide
```

装好后打开 **插件 → 已安装 → dsh-ui-hide**，点该 bundle 下面那一行的配置箭头即可调整。

## 默认设置

- 隐藏：品牌行、「新会话」按钮、左栏「更多」、右侧栏「更多」
- 排布：一行两个
- 会话头部 View 行的 `⋯` 默认**不**隐藏

## 设置页

注册在 `plugins.row.config`，key 是 `<包名>#<patch 行 id>` = `dsh-ui-hide#sidebar-declutter`。打开路径：**插件 → 已安装 → dsh-ui-hide → 该 bundle 下面那行的配置箭头**。行摘要会直接显示「已隐藏：…」。

开关分两组，改动立即生效，不重启插件、不重载页面：

**左栏**

| 键 | 默认 | 收起的面 |
|---|---|---|
| `brand` | 开 | 顶部品牌行（deepseek HARNESS） |
| `newSession` | 开 | 侧栏「新会话」按钮 |
| `sidebarMore` | 开 | 左栏面板列表的「更多」 |
| `hiddenPanels` | 空 | 勾掉列表里的任意面板（自动枚举，见下） |

**其它位置**

| 键 | 默认 | 收起的面 |
|---|---|---|
| `rightMore` | 开 | 右侧栏起始页的「更多」 |
| `headerMore` | 关 | 会话头部 View 行的 `⋯` |

**排布**

| 键 | 默认 | 作用 |
|---|---|---|
| `panelLayout` | `two` | 面板列表排布：`stack` / `two` / `wrap` 三选一 |

> 点选隐藏（自由隐藏）与「收起 / 展开面板列表」两个功能已移除，代码备份在 `backup/`，Git 标签 `archive/pick-and-collapse`。

行摘要只汇总「隐藏」组，不会把排布选项算成「已隐藏」。

旧版本存的是布尔值 `panelGrid`：`true` 迁移为 `two`（该键最初就是「一行两个」的意思），`false` 迁移为 `stack`。存储值非法时回落到默认。

值存在浏览器 `localStorage["dsh-ui-hide"]`，不写 profile 配置：因此这个 bundle 不需要 Host 侧 Config schema，改一个开关也不会重启插件。代价是偏好跟着浏览器走，换浏览器或清站点数据会回到默认。

## 收起 / 展开面板列表

侧栏底部、设置按钮上方的动作按钮，注册在官方 list slot `sidebar.footer.action`——由侧栏自己渲染，不会被重渲染移除。

- 驱动独立的一层 `collapsedAll`：收起时隐藏全部面板行与「更多」
- **不动手工勾选**：展开后，之前勾掉的面板仍然隐藏
- 折叠状态不持久化，刷新后一定是展开
- 窄栏（rail）时缩成图标

## 按 id 隐藏面板

侧栏每一行渲染后会被打上 `data-dsh-panel="<注册 id>"`，隐藏规则优先用它：

```css
button[data-dsh-panel="fishpond"]{display:none!important}
```

名字只在**唯一**时作为首帧兜底（那时属性还没打上）。因此两个插件面板取同名也不会互相牵连。

打标只写属性，不插入、不移动任何节点；打标失败的方向是安全的——什么都不会被隐藏。

## 自由隐藏（点选 → 勾选）

点「开始点选」，再点界面上任意一个元素。**它不会立刻消失**，而是作为一个条目加入下面这个列表，勾上才隐藏。

- 每条显示名字 + 选择器，可单独勾选 / 取消，右侧「移除」把它从列表里删掉
- 「清空列表」一次清掉全部条目
- 受保护的目标点不进去：设置入口所在行、以及覆盖视口 40% 以上的容器（误点主区域不会整页消失）

选择器生成顺序：`id` → 普通类名 → CSS Module 本地名后缀（`[class*="_xxx"]`）→ `data-*` → `:nth-child` 路径。

## 排布：三选一

`panelLayout` 是单选值，不是三个独立开关——同时启用两套布局规则会互相覆盖，所以设计成一个 `<fieldset>` + 共享 `name` 的 radio 组，浏览器层面就保证只能选一个。

| 值 | 界面 | 规则 |
|---|---|---|
| `stack` | 一列，界面原样 | 不注入任何排布规则 |
| `two` | 固定两列，左右对齐（默认） | `display:grid;grid-template-columns:1fr 1fr` |
| `wrap` | 按宽度自动换行 | `flex-direction:row;flex-wrap:wrap` + 内容定宽 |

默认 `two`（一行两个）。

### 两种并排的区别

- `two`：所有列共享同一宽度，行尾对齐成整齐的表格；代价是长名字被省略号截断（`自动化…`）。
- `wrap`：每个按钮按内容定宽，短名字一行能放三四个、长名字完整显示；代价是行尾参差，不再对齐。

### 一行两个（`two`）

```css
[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]{
  display:grid!important; grid-template-columns:1fr 1fr; gap:2px
}
```

### 自动紧凑（`wrap`）

```css
[class*="_root"]:not([class*="_collapsed"]) [class*="_panelList"]{
  flex-direction:row!important; flex-wrap:wrap!important;
  column-gap:6px!important; row-gap:2px!important
}
[class*="_panelList"] > [class*="_panelRow"]{
  flex:0 0 auto!important; width:auto!important; max-width:100%
}
```

顺带解决了截断：按钮按内容定宽，`自动化任务`、`上下文洞察` 都能完整显示。

### 「更多」的位置

`flex-wrap` 只向前填：一个放不下的项不会回头去看上一行有没有空位。「更多」是 DOM 里的最后一个子项，轮到它时上一行早就填满了，所以它必定独占一行——哪怕第一行还空着大半个。

目标排法：

```
插件  鱼塘  更多
自动化任务  上下文洞察
```

做法是按位置固定排序，而不是测量装箱：

```css
[class*="_panelList"] > button:nth-of-type(n+3){order:1}
[class*="_panelList"] > [class*="_moreAnchor"]{order:0}
```

`panelList` 的直接 `button` 子元素只有面板行——「更多」的触发按钮嵌在 `_moreAnchor` 那个 `span` 里面（Menu 原语的根节点），所以 `:nth-of-type(n+3)` 就是「第三个面板及以后」，它们的 `order:1` 排到了「更多」后面。

若第一行塞不下，`更多` 自然换行落到面板下方，规则优雅降级，不会和别的项重叠。这两条只属于 `wrap` 模式；`two` 模式下网格自己就消化了「更多」。

`:not([class*="_collapsed"])` 是必需的：侧栏收起时官方样式本来就把整个面板列表设成 `display:none`，一条不带作用域的 `!important` 会把它强行显示出来。

## 为什么不做「可折叠卡片」

折叠需要一个可点击的表头和一个开合状态，而 `panelList` 是 sidebar 自己渲染的，没有对应的 slot。只能往 DOM 里插节点再挂 MutationObserver 看住 React 的重渲染——side bar 每次状态变化都可能把外来节点冲掉。省下的高度和「一行两个」差不多，风险却高一个数量级，所以这个插件只做纯 CSS 的那一半。

## 品牌行的坑

`logoRow` 是列的 flex 子项，整行 `display:none` 才会连空隙一起收掉。但它在 **Windows / Linux** 上还装着侧栏折叠按钮——整行藏掉会把按钮一起藏了，就再也展不开侧栏。所以规则用 `:has()` 分流：

```css
[class*="_logoRow"]:not(:has([data-sidebar-toggle])) { display: none !important }
[class*="_logoRow"]:has([data-sidebar-toggle]) [class*="_brand"] { display: none !important }
[class*="_root"]:not([class*="_collapsed"]) [class*="_logoRow"]:has([data-sidebar-toggle]) {
  height: 0 !important; min-height: 0 !important; padding: 0 !important;
  overflow: visible !important; align-items: flex-start !important;
  justify-content: flex-end !important;
}
```

macOS 桌面端品牌行只有装饰用的 span（折叠按钮在上方那条 `topStrip` 里），所以整行隐藏。其它平台那一行里确实装着折叠按钮，藏掉就再也展不开侧栏，于是改成**只交还高度、不交还按钮**：

- 行高和内边距压成 0，`overflow: visible` 让按钮画在外面；
- **web 端**没有窗口标题栏，按钮放到侧栏右缘外的边沟里（`left: calc(var(--dsh-sidebar-width) + 8px)`，跟随侧栏拖宽；`position: fixed` 也让它不受侧栏列 `overflow: hidden` 裁剪）；
- **Windows 桌面端**的按钮由外壳固定在标题栏（`[data-windows-titlebar] .toggle { position: fixed; left: 12px }`），本条选择器特异性更高，所以用 `html:not([data-windows-titlebar])` 把它排除在外，桌面端该按钮仍在标题栏原位；
- 侧栏折叠成窄条时恢复 28px 行高，否则收起来就展不开了。

全程纯 CSS：**没有 JS、没有定时器、没有强制布局**，也不依赖外壳配合。`data-sidebar-toggle` 是侧栏自己的属性，比 CSS Module 类名稳定。

## 藏了什么

1. **顶部品牌行** —— deepseek HARNESS 那一行。
2. **「新会话」按钮** —— 品牌行下面那一行。
3. **面板列表里的「更多」** —— `插件 / 自动化任务 / 上下文洞察 / 更多` 的最后一行。

三条都由 `@deepseek-ai/dsh-client-ui-sidebar` 直接渲染进列，不是 slot 注册项，该插件行也没有 Config，所以没有「卸载」钩子和配置开关。

品牌行里那个标志本身是个 slot（`sidebar.brand.mark`，没注册时回落到 FishLogo）。隐藏品牌行等于让这个 slot 看不见——目前没人往里注册东西，但如果你以后装了换 logo 的插件，它会跟着一起不可见。

## 为什么直接藏是安全的

它们和下面的面板列表是同一列的正常流式兄弟节点，外面没有包裹元素（「新会话」的 Tooltip 是 cloneElement，不产生包裹层），因此 `display:none` 会把它们连同外边距一起从布局里拿掉，下面的内容整体上移。

新建会话本身不受影响：快捷键和工作区那行的 `+` 都还在。

## 「更多」一共三处，但只有两处写着这两个字

同一个来源（`@deepseek-ai/dsh-client-ui-entry-customization`，插件页里叫「界面自定义」）注册进三个 slot：

| 位置 | 长相 | 本插件 |
|---|---|---|
| 左栏面板列表 | 文字「更多」 | 隐藏 |
| 右侧栏起始页 | 文字「更多」 | 保留 |
| 会话头部 View 标签行 | 只有 `⋯` 图标（aria-label 才是「更多」） | 保留 |

两条规则都限定在 `_panelList` 内：右侧栏那份用了同名的 `_moreAnchor` 类（`F6Huca_moreAnchor`），不加作用域会把它一起藏掉——这正是第一版犯过的错。会话头部那个是 `_viewsMore` 图标按钮，从未被影响。

## 「更多」的取舍

「更多」只在 `sidebar.panellist.actions` 有注册项时才渲染（今天只有一项，来自 `@deepseek-ai/dsh-client-ui-entry-customization`）。它不是折叠箭头，菜单里是**面板的固定 / 取消固定**，以及插件浏览和创造模式草稿——而固定/取消固定**只有这个菜单里有**。所以藏掉它，就等于以后面板一律保持列在侧栏（目前三个面板都已固定，现状不变）。

官方更彻底的做法是在 profile 里禁用那一行：

```yaml
- id: entry-customization
  disabled: true
```

它由 `@deepseek-ai/dsh-web-app` 的 patch 插入。官方 README 写明：三个区域只在 actions slot 有注册项时显示「更多」，卸载本包会移除三个按钮——也就是左栏、会话 View 标签、右侧栏起始页一起没。它和 CSS 隐藏丢的是同一个控制权，却多影响两个区域，所以这里选了只藏一处的做法。

## 实现

- 注入一条样式：
  - `button[class*="_newSession"] { display: none !important }`
  - `[class*="_panelList"] [class*="_moreAnchor"]`, `[class*="_panelList"] button[aria-haspopup="menu"]` → `display: none !important`
- 选择器锚在 CSS Module 的**本地名后缀**上，不用构建哈希前缀（前缀每次构建都变，本地名跟随源码）；「更多」另有一条纯结构选择器兜底
- 样式表带 `data-dsh-ui-hide` 标记，重复执行会就地重写而不是叠加
- 2 秒后自检：侧栏已渲染（存在 `_panelList`）但仍匹配不到按钮时，控制台 `console.warn` 提示选择器可能已随版本变化——不会静默失效

## 还原

在插件页面禁用或卸载本 bundle，样式表随之移除，两行立刻回来；已固定的面板不会被改动。