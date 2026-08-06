# PRD — Extract Inspector panel into self-contained component

## Origin
Child of `08-04-webview-sidebar-component` (archived, PR #160 merged). The sidebar shell established the panel seam: host `panels` config with `{ id, label, mount(root) }`, lazy mount-once. This child deepens the inspector descriptor's `mount(root)` into a real self-contained component at the same seam — no shell change.

## Problem
Inspector panel logic is split across `sidebar/sidebar.ts` (segments, labels, label form) and `sidebar/inspector/index.ts` (address/vals, bits, multi-byte interpreter), all reading the `S` global directly and rendering into global-id sections (`#s-insp`, `#s-bits`, `#s-segments`, `#s-labels`). Panel CSS lives in `styles/sidebar.css`. Host calls `updateInspector()` (11 sites), `renderSegments`, `renderLabels`, `updateLabelFormSel` directly.

## Goal
Self-contained `Inspector` component owning the four sidebar sections (Inspector / Bit View / Multi-Byte interpreter / Segments / Labels): markup, collapse state, bit hover, label-form UI state, and interaction. It never reads/writes `S`, never posts provider messages — data is pushed via setters, actions reported via callbacks. CSS moves to `components/Inspector/Inspector.css`.

## Scope
In:
- `src/webview/components/Inspector/Inspector.ts` (+ types) and `Inspector.css`.
- Host `hexViewer.ts` rewiring: panel descriptor → `inspector.mount(root)`; `updateInspector()` / `updateLabelFormSel()` → `inspector.setSelection(...)`; `renderSegments` → `inspector.setSegments(...)`; `renderLabels` → `inspector.setLabels(...)`; endian → `inspector.setEndian(...)`.
- `sidebar/sidebar.ts` segments + labels sections move into the component; file deleted once empty.
- `sidebar/inspector/index.ts` content moves into the component; file deleted.
- `styles/sidebar.css` panel-content rules claimed: `.insp-*`, `.bit-*`, `.mi-*`, `.segment-*`, `.label-*`, `.lf-*`.

Out:
- Struct / Integrity / Scripts panels (separate child tasks).
- Sidebar shell (`Sidebar.ts`/`Sidebar.css`) unchanged.
- Any behavior change.

## Acceptance Criteria
- [ ] `components/Inspector/Inspector.ts` + `Inspector.css` exist; component owns the four sections' markup, collapse state, bit hover, label-form state; zero `S` reads/writes; no `postProviderMessage`.
- [ ] Setters push data (`setSelection`, `setSegments`, `setLabels`, `setEndian`); callbacks report (`onJumpTo`, `onLabelsChange`).
- [ ] Host rewire: `updateInspector`/`renderSegments`/`renderLabels`/`updateLabelFormSel`/`renderInspectorSections` gone from `hexViewer.ts`; `sidebar.ts` + `sidebar/inspector/index.ts` deleted.
- [ ] Markup/behavior identical: collapse state, bit hover, multi-byte re-decode on endian/selection change, label add/edit validation (incl. confirm-on-warning), segment navigation.
- [ ] `styles/sidebar.css` inspector/bit/multi/segment/label rules moved to `Inspector.css`.
- [ ] `npm run lint`, `npm run check-types`, `npm test` pass; webview test batch green; fallow 0/0/0.
- [ ] No functional/visual change in the running extension.
