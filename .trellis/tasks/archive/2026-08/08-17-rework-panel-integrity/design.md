# Rework Integrity — Technical Design

## Scope

Declutter the profile library into one select + menu; add mismatch-count header badge; spinner during calculate.

## Ownership

| layer | change |
|---|---|
| `integrityPanel.ts` | profile row: keep `.sb-select`, replace 4 admin buttons with select-integrated menu (dropdown list on "⌄" or select + gear menu). Header badge emission: `setBadge('main', "3 · 1!")` with mismatch styling — badge needs two-tone support (sidebar.ts `.sb-badge.danger` variant). Calculating state passes to cards. |
| `sidebar.css` | `.sb-badge.danger` (danger color bg/fore), maybe `.sb-dock`-adjacent mobile collapse. |
| `integrityPanel.css` | profile menu popover style; `.integrity-card-status.calculating` spinner (turn circle into border-spin or overlay ring via ::before animation); remove 4-button cluster paddings. |
| `integrityPanel.test.ts` | badge text format; profile ops via menu; spinner class present while calculating. |

## Data flow

- Badge: `checks.filter(mismatch).length` → `setBadge('main', \`${checks.length} · ${bad}!\`)` when bad>0 else plain count; danger class when bad>0.
- Profile menu: local popover bound to one menu button next to select; items Apply / Save as… / Rename / Delete (Delete → last profile guard + confirm). Same callbacks as today.
- Calculating: card status circle adds `.calculating` while a check has pending calculation (existing scheduling flags) → CSS spinner; removing only color.

## Rendered DOM sketch

```
section.sb-section#integrity-main
  head: "Integrity" [badge: 3 · 1!]   ← danger badge
  body:
    [Fix all] [Add]                       (unchanged placement)
    profile select ⌄ [menu button ⋮]
      menu: Apply | Save as… | Rename | Delete
    [action-error]
    [check form] [cards]
      card status circle (.calculating → spinner)
```

## Compatibility / rollback

- Same callback surface; only chrome changes. Profile delete guard preserved. Card/check form layout untouched.

## Risks

| risk | mitigation |
|---|---|
| Badge text parse ("><" counts) readability | format `N · M!` fixed, danger color; tests assert exact string |
| Menu replace may frustrate muscle-memory | menu keeps identical actions/order, one extra click for rename/delete |
| Spinner lifecycle (endless spin if calc pending stuck) | tie to schedule flags; clear on result; timeout supersedes (existing calc timers) |
| Two-tone badge leaks generic primitive | `.sb-badge.danger` opt-in only; other panels unaffected |