# 备份：点选隐藏（自由隐藏）+ 收起/展开面板列表

`client-with-pick-and-collapse.js` 是移除这两个功能之前的完整 `src/client.js`。

- Git 标签：`archive/pick-and-collapse`
- 移除日期：2026-11-09
- 移除原因：排查插件页白屏；这两个功能分别依赖 DOM 注入（点选遮罩条）与
  `sidebar.footer.action` 注册，先剥离以缩小问题面。

## 恢复方法

把本目录的 `client-with-pick-and-collapse.js` 覆盖回 `src/client.js` 即可，
但需注意其中 `ENABLE_ROW_CONFIG` / `ENABLE_FOOTER_ACTION` 两个开关。

## 两个功能当时的实现要点

**点选隐藏**：`startPicker()` 往 `document.body` 插一条浮动条，`mousemove` 描边、
`click` 捕获；`buildSelector()` 按 `id → 普通类名 → CSS Module 本地名后缀 →
data-* → nth-child 路径` 生成选择器，写入 `values.picked`，规则由 `hiddenRules()` 渲染。
保护规则 `isProtected()` 禁止隐藏设置入口所在行及其祖先。

**收起/展开**：注册 `sidebar.footer.action`（官方 list slot），组件 `CollapseAction`
写 `values.collapsedAll`；`hiddenRules()` 在该值为真时隐藏全部面板行与「更多」。
它只驱动这一层，不改 `hiddenPanels`，所以展开后手工勾选保持原样。
