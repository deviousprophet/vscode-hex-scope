# Rework Integrity — Execution Plan

## Preconditions

Grilling decisions fixed (prd.md). Calendar-style check scheduling unchanged.

## Implementation checklist

1. **Mismatch-count badge (integrityPanel.ts)**
   - `render()`: compute `bad = checks.filter(c => c.status === 'mismatch').length` (consult existing status/lastResult shape).
   - `setBadge('main', bad > 0 ? \`${checks.length} · ${bad}!\` : (checks.length > 0 ? String(checks.length) : null))`.
   - Toggle `.sb-badge-danger` class via sidebar.ts: `setBadge` gains optional class param? Simpler: expose `setBadgeClass(id, cls)` or include class in setBadge signature `setBadge(id, text, danger?)`. Add `danger?: boolean` param (backward compatible).
2. **Danger badge CSS (sidebar.css)**
   - `.sb-badge-danger`: danger background/foreground (reuse err tokens), rest same pill geometry.
3. **Profile library → single menu (integrityPanel.ts + css)**
   - Render: `.sb-select` (existing) + one menu button (⋮ or ⌄) → popover list: Apply, Save as…, Rename, Delete (Delete: confirm + last-profile/current-guard).
   - Remove `.integrity-profile-actions` button cluster markup/CSS.
   - Popover: focus management (focusable items, Escape close, click-outside close), `aria-haspopup=menu`.
   - Keep `refreshProfileLibrary`, apply/update/rename/delete callbacks path.
4. **Spinner-on-calculating (integrityPanel.css + ts)**
   - `.integrity-card-status.calculating` → replace flat color with spinner: keep circle geometry, animate `border-top-color` (turn border 1px into ~2px working spinner) or overlay ::before ring. No size jump.
   - Calculating class already applied via calc scheduling flags; verify it clears on result/error (existing flow).
5. **Tests (integrityPanel.test.ts)**
   - badge exact strings: `0 checks → null`, `1 ok → "1"`, `1 mismatch → "1 · 1!"` + danger class; updates after recalc.
   - profile menu: open, Apply/Rename/Delete flow, confirm guard; delete last profile blocks.
   - calculating spinner class present during pending; removed after.

## Validation

- `npm run check-types`
- `npm run lint`
- `npm test`
- Manual EDH dark+light: 2 checks (1 mismatch): badge shows updated; run Fix all → badge plain; rename profile via menu; delete blocked last; calculation flicker spinner on edit.

## Review gates

- No 4-button profile cluster in DOM/tests.
- Badge danger class only when mismatch>0.
- Spinner class clears on every terminal state (no stuck spin).

## Rollback

One-commit revert restores cluster + plain badge + color-only calculating.