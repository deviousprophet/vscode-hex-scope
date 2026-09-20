# Copy selected byte address

## Goal

Let users copy a selected Hex Grid byte address without retyping it.

## Confirmed Facts

- The Hex Grid context menu renders distinct single-byte and multi-byte selections.
- Hex Grid addresses use eight uppercase hexadecimal digits.
- Context-menu copy actions use the webview-to-provider clipboard message path.

## Requirements

- Add a context-menu command to copy the selected byte address.
- For a multi-byte selection, copy its first address.
- Copy an uppercase, eight-digit hexadecimal address without a `0x` prefix.

## Acceptance Criteria

- [ ] For any non-empty Hex Grid selection, the context menu exposes a copy-address action.
- [ ] Invoking it copies the selection's first address as eight uppercase hexadecimal digits, with no `0x` prefix.

## Out of Scope

- New keyboard shortcuts.
- Address-format preferences.

## Key Decisions

- The action is available for every non-empty selection.
- Multi-byte selections copy their first address.
- The copied address is uppercase, padded to eight hexadecimal digits, without a `0x` prefix.
