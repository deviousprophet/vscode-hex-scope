# Harden scripting engine security boundary

## Goal

Replace `node:vm` (shared-realm, no security guarantee) with a true isolate engine (`isolated-vm` or `quickjs-emscripten`), add capability-based pre-run disclosure, integrate VS Code Workspace Trust, and constrain `fetch`/`exec` APIs against SSRF and env-leakage.

## Requirements

1. **Real process/memory isolation** — scripts must not share the host V8 heap. `node:vm` / `vm.createContext` removed as execution backend.
2. **Capability manifest per script** — scripts declare `requires: ['exec', 'network']` in metadata; sidebar shows declared capabilities before the Run button.
3. **Workspace Trust integration** — `scanScripts()` and `execute()` gate on `isWorkspaceTrusted`; scripts listed but disabled in untrusted workspaces.
4. **`fetch` hardening** — response size cap (default 1 MiB); block loopback (127.0.0.1, ::1) and link-local (169.254.x.x, fe80::) by default; opt-in override API option.
5. **`exec` hardening** — run with minimal explicit `env` (only `PATH`, `SHELL`) and pinned `cwd` instead of inheriting extension host's.

## Non-requirements

- Not converting script engine to WASM or cross-process RPC — in-process isolate is sufficient.
- Not adding authentication/credential management for `fetch`.
- Not changing the script authoring format beyond the capability manifest.
- Not adding network egress policies beyond SSRF blocks.

## Acceptance Criteria

- [ ] Scripts run in a real isolate (`isolated-vm` or `quickjs-emscripten`), no shared V8 heap
- [ ] `vm.createContext` / `vm.Script.runInNewContext` no longer called for script execution
- [ ] Sidebar shows declared capabilities pre-run (dot or badge per capability type)
- [ ] Untrusted workspaces list scripts but disable the Run button with tooltip
- [ ] `fetch` caps response at 1 MiB, blocks loopback + link-local by default; per-request override exists
- [ ] `exec` uses minimal explicit env + pinned `cwd` (does not inherit `process.env` entirely)
- [ ] All existing script-runner tests pass with the new isolate backend
- [ ] No regressions in protocol message shapes (`src/webviewProtocol.ts`)
- [ ] Spec `.trellis/spec/frontend/scripting.md` updated

## Constraints

- Must remain in-process (no child-process-per-script or WASM boundary)
- Must support both `.js` and `.ts` (esbuild-compiled) scripts
- Must preserve the `ScriptHost` adapter interface for future CLI tool
