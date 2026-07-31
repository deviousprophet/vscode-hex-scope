# PRD: Fix crc16 API to be real Modbus

Source: [Issue #140](https://github.com/deviousprophet/vscode-hex-scope/issues/140)

## Problem

`api.crc.crc16()` documented as "CRC-16 (Modbus)" but implementation is CRC-16/ANSI (ARC/IBM):

- Same poly `0xA001`, but init `0x0000` instead of Modbus's `0xFFFF`.
- Verified against "123456789" check vector: impl returns `0xBB3D` (ANSI), Modbus check value is `0x4B37`.
- `crc8` (`0xF4`) and `crc32` (`0xCBF43926`) match docs — only `crc16` wrong.
- Both scripting API and Analyze context menu call through the same function; anyone following docs gets silently wrong CRC.

## Requirements

- Change `crc16` init to `0xFFFF` in `src/core/byte-tools/crc.ts` so it computes real Modbus CRC-16.
- Do not change `crc8` / `crc32` behavior.
- Add check-vector unit tests (currently zero coverage) at `src/test/core/byte-tools/crc.test.ts`.
- Keep docs accurate: `docs/SCRIPTING.md` "CRC-16 (Modbus)" stays correct after fix; verify `analysis.ts` label.
- Add CHANGELOG entry noting script-output behavior change for existing users.

## Constraints

- Fix implementation to match docs (real Modbus), per issue decision.
- Minimal diff; no new dependencies.

## Acceptance Criteria

- [ ] `crc16("123456789")` returns `0x4B37`.
- [ ] `crc8("123456789")` returns `0xF4` (unchanged).
- [ ] `crc32("123456789")` returns `0xCBF43926` (unchanged).
- [ ] New tests cover all three check vectors.
- [ ] Scripting API and Analyze context menu output Modbus-correct.
- [ ] Docs consistent; CHANGELOG entry added.
- [ ] `npm test` passes; lint clean.
