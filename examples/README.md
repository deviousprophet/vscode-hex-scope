# Hex Scope example scripts

Working starting points for every supported scripting surface. All examples use
only the public `HexScopeAPI`; adapt the placeholder addresses and constants at
the top of each file to your firmware. `hello.js` is the minimal manual script;
the role examples show the optional `address`, `size`, and `integrity` entries.

## Install

Run **HexScope: Add Example Scripts** from the Command Palette, or use **Add
example scripts** in the Scripts panel (header button or the empty-state
button). The command copies these files into your workspace:

```text
.hexscope/
└── scripts/
    ├── types/hexscope.d.ts
    ├── hello.js
    ├── verify-crc.js
    ├── write-pattern.js
    ├── follow-pointer.js
    ├── array-size-from-header.js
    └── verify-integrity.js
```

It never overwrites or deletes: files that already exist are reported as
skipped. Remove an installed example at any time — the catalog in the extension
is untouched.

Behaviors that need approval are approved **inside the run**, in the Scripts
panel. There is no pre-run gate.

## Catalog

| File | Role / capability | Demonstrates | Adapt |
|------|-------------------|--------------|-------|
| `hello.js` | `run` | The minimal manual script: `run(api)`, `setResult`, `output` | none |
| `verify-crc.js` | `run` | Reading a range, `crc32`, `setResult`, `output` | `START`, `LENGTH` |
| `write-pattern.js` | `run`, `@requires write` | One inline approval, staged writes, auto-save and undo | `START`, `PATTERN` |
| `follow-pointer.js` | `@script address` → `getAddress` | Reading a pointer and returning it as an instance address | `POINTER_AT` |
| `array-size-from-header.js` | `@script size` → `getSize` | Reading a count for one templated parameter | `PARAM_NAME`, `COUNT_AT` |
| `verify-integrity.js` | `@script integrity` → `verifyIntegrity`, `getIntegrityValue` | Checksum over the check range, excluding the stored field | `DEFAULT_START`, `DEFAULT_END` |

## Type checking

`types/hexscope.d.ts` is ambient: reference it with

```typescript
/// <reference path="./types/hexscope.d.ts" />
```

`tsconfig.json` in this directory type-checks every example against the shipped
declaration (`npm run check-examples` in the extension repository), so the
catalog cannot drift from the API.

Every example declares its role with a `@script <role>` header tag and its
required capabilities with `@requires <capability>`; the tags are discovery
metadata for the Scripts panel, while the exported function name is the call
contract. Examples are plain `.js` so they run without the optional TypeScript
compiler; they use the sandbox's CommonJS shim (`module.exports`) and JSDoc
types for editor IntelliSense. The `.d.ts` file is never listed as a runnable
script (the scanner skips `.d.ts` files and never descends into subdirectories).

See `docs/SCRIPTING.md` in the extension repository for the full API reference,
the approval model, and the role contracts.
