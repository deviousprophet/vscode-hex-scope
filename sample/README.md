# HexScope Sample Files

Test and demo files for the HexScope extension. All files use the [Intel HEX](https://en.wikipedia.org/wiki/Intel_HEX) format (`.hex`).

---

## Files

### `minimal.hex`
**Format:** Intel HEX without extended addressing (16-bit address space only)  
**Target:** 8051 microcontroller  
**Content:**
- `0x0000` — `LJMP 0x0030` reset vector (3 bytes)
- `0x0003` — 5 zero-padding bytes
- `0x0030` — small application entry stub with "Hello" string

**Use for:** Testing the parser with the simplest valid file (no ELA records, no gaps larger than a few bytes, record byte counts: 3, 5, 16, 16).

---

### `firmware.hex`
**Format:** Intel HEX I32 (Extended Linear Address, type 04)  
**Target:** STM32-class MCU  
**Content:**
- `0x08000000` — Cortex-M3 partial vector table (2 ×16-byte data records)
- `0x08002000` — `0xDEADBEEF` + `0xCAFEBABE` magic + sequential data bytes
- `0x08010000` — `"HELLO WORLD!"` + bootloader string (two records, one short at 14 bytes)

**Use for:** Testing ELA segment switching, multiple non-contiguous segments, and a short (non-standard length) record.

---

### `stm32_16bpr.hex`
**Format:** Intel HEX I32, **16 bytes per data record** (`:10…`)  
**Target:** STM32F103C8T6 (Cortex-M3, 64 KB flash)  
**Memory layout:**
| Address | Content | Size |
|---------|---------|------|
| `0x08000000` | Cortex-M3 vector table (SP + 19 exception/IRQ vectors) | 128 B |
| `0x080000C0` | ARM Thumb-2 Reset_Handler, SystemInit, main, app_run stubs | 70 B |
| `0x08010000` | Flash config block (magic, version, app_start, CRC) | 16 B |
| `0x08010000` ← ELA switch | String constants: `"HexScope"`, `"STM32F103C8T6"`, `"v1.0.0"`, `"OK"`, `"ERR"` | 48 B (in 0x0800 segment) |

**Total data:** 262 bytes across 2 segments (gap between `0x08000106` → `0x08010000`).

**Use for:** Testing standard 16-byte record parsing, ELA-based segment gaps, and realistic STM32 firmware layout.

---

### `stm32_32bpr.hex`
**Format:** Intel HEX I32, **32 bytes per data record** (`:20…`)  
**Target:** Same as `stm32_16bpr.hex`  
**Content:** Byte-for-byte identical data to `stm32_16bpr.hex`, only the record size differs.

**Use for:** Verifying that the parser produces identical parse results regardless of record byte count. The 32-byte format is common in GCC ARM toolchains with `-O2`/`-O3`.

> **Key test:** `stm32_16bpr.hex` and `stm32_32bpr.hex` must produce the same segments, totalDataBytes, and resolved addresses.

---

### `errors.hex`
**Format:** Intel HEX I32  
**Target:** STM32 address space (`0x08000000`)  
**Content:**
| Line | Record | Status |
|------|--------|--------|
| 1 | ELA `0x0800` | ✅ Valid |
| 2 | Data `0x08000000` (vector table bytes) | ✅ Valid |
| 3 | Data `0x08000010` (`DEADBEEF…`) | ❌ **Bad checksum** (intentional) |
| 4 | `;; this is a comment…` | ❌ **Malformed** (no `:` start code) |
| 5 | Data `0x08000020` (`"Hello World"`) | ✅ Valid |
| 6 | Data `0x08000030` (`AABBCCDD…`) | ❌ **Bad checksum** (intentional) |
| 7 | Data `0x08000040` (sequential bytes) | ✅ Valid |
| 8 | EOF | ✅ Valid |

**Expected parse result:** `checksumErrors: 2`, `malformedLines: 1`, `segments` containing only the 3 valid data records (48 bytes total, split across non-contiguous valid records).

**Use for:** Testing error detection, error counts, and that corrupted records are excluded from segment building.

---

## Intel HEX Record Format Reference

```
:LLAAAATT[DD...]CC
 │ │     │ │     └─ Checksum  (two's complement of sum of all bytes)
 │ │     │ └─────── Record Type (00=Data, 01=EOF, 02=ExtSegAddr, 04=ExtLinAddr)
 │ │     └───────── Data bytes
 │ └─────────────── Address   (16-bit, big-endian)
 └───────────────── Byte Count (LL bytes of data follow)
```

**Record types used in these files:**
- `00` Data
- `01` End of File
- `02` Extended Segment Address (legacy, 20-bit address space) — not used here but supported by parser
- `04` Extended Linear Address (I32, 32-bit address space) — used in `firmware.hex`, `stm32_*.hex`, `errors.hex`
