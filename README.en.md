# dsh-ui-hide

English | [中文](README.md)

Declutters the DSH sidebar: hides the brand row, the New session button and the three “More” launchers behind individual switches, and lays the panel list out two per row (or packed by width). It injects stylesheets only — no source edits, no session data touched, and disabling or removing the bundle restores everything.

## Install

Open **Plugins → Add** in DSH and paste the package name or this repository:

```bash
# npm (preferred)
dsh plugin install dsh-ui-hide

# or straight from the repo
dsh plugin install https://github.com/DDDMUC/dsh-ui-hide
```

Then open **Plugins → Installed → dsh-ui-hide** and use the configure arrow on that bundle's row.

## Defaults

- Hidden: the brand row, the New session button, the sidebar panel list's More, and the right column's More
- Layout: two panels per row
- The Session header View row's `⋯` is **not** hidden by default

## What it targets

Each surface is rendered directly into the layout by a shipped package, so none of them is a slot registration and no config switch exists for any of them:

| Surface | Package | Selector |
|---|---|---|
| Brand row | `dsh-client-ui-sidebar` | `_logoRow` (guarded by `:has([data-sidebar-toggle])`) |
| New session button | `dsh-client-ui-sidebar` | `button[class*="_newSession"]` |
| Sidebar More | `dsh-client-ui-sidebar` | `_panelList > _moreAnchor` |
| Right column More | `dsh-client-ui-sidebar-right` | `[data-sidebar-right-guide] _moreAnchor` |
| View row More | `dsh-client-ui-conversation` | `_viewsMore` |

Selectors key on CSS-module **local suffixes** (`_newSession`), never on the build-hashed prefix (`kB3qhq_`), because the prefix changes on every build while the local name follows the source.

## Layout modes

`panelLayout` is a single choice, not three independent switches — two layout rules enabled at once would fight over the same element.

| Value | Effect |
|---|---|
| `stack` | One per row, exactly as shipped |
| `two` (default) | Fixed two-column grid; long names truncate with an ellipsis |
| `wrap` | Content-sized chips that wrap greedily; short names pack three or four per row and nothing truncates |

## Caveats

- The brand row carries the sidebar collapse toggle on Windows and Linux. The rule hides the whole row only where it has no `[data-sidebar-toggle]`, and otherwise hides just the brand, so the toggle always survives.
- Where the row does hold the toggle, the plugin gives back the row's **height, not the button**: height and padding drop to 0 with `overflow: visible`, the button stays where it was and is drawn above the panel list (`z-index: 2`), and the collapsed rail restores a 28px row so the sidebar can be expanded again. Pure CSS — no JS, no timer, no forced layout.
- Preferences are stored in `localStorage`. Its scope is the page origin, which includes the port; if the app picks a new port on restart, the switches fall back to these defaults.
- Hiding the sidebar's More also retires pin/unpin: that menu is the only place a panel can be pinned or unpinned.

## License

MIT
