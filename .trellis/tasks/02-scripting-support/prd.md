# Add scripting support for custom HEX processing

## Goal

Allow users to automate custom HEX file operations via TypeScript/JavaScript scripts. Scripts should be able to read and modify data, perform calculations (CRC, hashes, signatures), interact with external services (PKI/HSM), and display results. The scripting system lives in `src/core/` so both the VS Code extension and the future CLI tool can use it.

## Confirmed Facts (from codebase inspection)

- Extension is VS Code extension host (Node.js runtime)
- Future: standalone CLI tool built on `src/core/`
- Webview-based UI with message passing protocol (`src/webviewProtocol.ts`)
- Existing integrity system: CRC algorithms (`crc16-ccitt-false`, `crc32-iso-hdlc`), hash algorithms (`sha-1`, `sha-256`, `sha-512`), stored in `src/core/integrity.ts` and `src/core/byte-tools/crc.ts`
- Integrity profiles system with reusable check sets already exists (#63, delivered)
- No existing scripting infrastructure
- esbuild available in build pipeline

## Requirements

- R1. User can author TypeScript/JavaScript scripts that run in the extension host
- R2. Scripts can read the hex data currently loaded in the active editor
- R3. Scripts can write/modify hex data in the active document (with user confirmation per write)
- R4. Scripts can use the existing CRC, hash, and digest algorithms already built into Hex Scope
- R5. Scripts can call external processes (exec) and web services (fetch), each requiring explicit user confirmation
- R6. Script results can be displayed in the webview UI
- R7. Scripts are stored as files in the project/workspace (`.hexscope/scripts/`)
- R8. Scripts have a way to be triggered by the user
- R9. Scripts cannot crash the extension host
- R10. Core scripting module (`src/core/scripting/`) has zero VS Code imports — platform adapter pattern
- R11. CLI tool (future) can reuse `src/core/scripting/` with its own host adapter

## Acceptance Criteria

- [ ] AC1. User can write a `.ts` script in `.hexscope/scripts/` and run it from the extension
- [ ] AC2. Script receives the current hex document's raw data and metadata
- [ ] AC3. Script can compute CRC32 over an address range and display result
- [ ] AC4. Script can call `exec()` with user confirmation dialog and display stdout
- [ ] AC5. Script can call `fetch()` with user confirmation dialog and display response
- [ ] AC6. Script can write hex data with user confirmation and persist edits
- [ ] AC7. Script runtime errors are caught and reported (not crash the host)
- [ ] AC8. Script output displayed in sidebar panel
- [ ] AC9. User can select a script from quick pick or sidebar and invoke it
- [ ] AC10. `src/core/scripting/` contains no references to `vscode` namespace

## Out of Scope

- General-purpose REPL or interactive script debugger
- Script marketplace or sharing infrastructure
- Hot-reload of scripts on file change
- Non-JS/TS language support
- CLI tool itself (future task)

## Decisions

- **Location**: `src/core/scripting/` — core has zero VS Code deps
- **Platform adapter**: `ScriptHost` interface injected at runtime — VS Code and CLI each provide implementation
- **exec/fetch**: implemented in core (child_process, http/https), host only provides confirmation gates
- **Execution surface**: sidebar panel + command palette quick pick
- **Isolation**: `vm.createContext` — no `require/process/fs` in sandbox, API-only bridge
- **Gated operations**: `hex.write()`, `exec()`, `fetch()` each show confirmation before executing
- **Timeout**: 30s kill-switch on all scripts
- **API surface**: `hex.read/size/write`, `crc8/16/32`, `sha1/256/512`, `exec`, `fetch`, `output`, `setResult`
