# HexScope Sample Files

Test and demo files for the HexScope extension, organised by format.

```
sample/
├── ihex/          Intel HEX (.hex) samples
│   ├── minimal.hex
│   ├── firmware.hex
│   ├── stm32_16bpr.hex
│   ├── stm32_32bpr.hex
│   └── errors.hex
└── srec/          Motorola SREC (.srec) samples
    ├── minimal.srec
    ├── firmware_s1.srec
    ├── firmware_s3.srec
    ├── stm32_s3.srec
    ├── mixed_addr.srec
    └── errors.srec
```

---

## Intel HEX (`ihex/`)

### `minimal.hex`

**Format:** Intel HEX without extended addressing (16-bit address space only)

**Target:** 8051 microcontroller

| Address | Content | Bytes |
|---------|---------|-------|
| `0x0000` | `LJMP 0x0030` reset vector | 3 |
| `0x0003` | Zero-padding | 5 |
| `0x0030` | Application entry stub + `"Hello"` string | 32 |

**Stats:** 2 segments · 40 bytes · 0 errors

**Use for:** Simplest valid IHEX file; no ELA records; tests basic 16-bit parsing and contiguous segment building.

---

### `firmware.hex`

**Format:** Intel HEX I32 (Extended Linear Address, type 04)

**Target:** STM32-class MCU

| Address | Content |
|---------|---------|
| `0x08000000` | Cortex-M3 partial vector table (2 x 16-byte records) |
| `0x08002000` | `0xDEADBEEF` + `0xCAFEBABE` magic + sequential data |
| `0x08010000` | `"HELLO WORLD!"` + bootloader string |

**Stats:** 3 segments · 9 records · 0 errors
**Use for:** ELA segment switching, non-contiguous segments, short (14-byte) record, `0xDEADBEEF` sentinel detection.

---

### `stm32_16bpr.hex`

**Format:** Intel HEX I32, **16 bytes per data record** (`:10...`)

**Target:** STM32F103C8T6 (Cortex-M3, 64 KB flash)

| Address | Content | Size |
|---------|---------|------|
| `0x08000000` | Cortex-M3 vector table (SP + 19 exception/IRQ vectors) | 128 B |
| `0x080000C0` | ARM Thumb-2 Reset_Handler + app function stubs | 70 B |
| `0x08000100` | String constants: extension ID, MCU name, version, status tokens | 48 B |
| `0x08010000` | Flash options word (A5 5A pattern) + reset handler address | 16 B |

**Stats:** 4 segments · 262 bytes · 20 records · 0 errors

**Use for:** Standard 16-byte record parsing, ELA-based segment gaps, realistic STM32-style layout with 4 non-contiguous segments.

---

### `stm32_32bpr.hex`

**Format:** Intel HEX I32, **32 bytes per data record** (`:20...`)

**Target:** Same as `stm32_16bpr.hex` — byte-for-byte identical data, different record size.

**Stats:** 4 segments · 262 bytes · 0 errors

**Use for:** Verifying that the parser produces identical results regardless of record byte count.

> **Key invariant:** `stm32_16bpr.hex` and `stm32_32bpr.hex` must produce identical `ParseResult`.

---

### `errors.hex`

**Format:** Intel HEX I32 with intentional errors

| Line | Record | Status |
|------|--------|--------|
| 1 | ELA `0x0800` | Valid |
| 2 | Data `0x08000000` | Valid |
| 3 | Data `0x08000010` | **Bad checksum** |
| 4 | `;; this is a comment` | **Malformed** (no `:` start code) |
| 5 | `:00000006FA` | **Malformed** (unknown record type `0x06`) |
| 6 | `:02000001DEAD72` | **Malformed** (EOF with byte count 2, must be 0) |
| 7 | Data `0x08000020` | Valid |
| 8 | Data `0x08000030` | **Bad checksum** |
| 9 | Data `0x08000040` | Valid |
| 10 | EOF | Valid |

**Stats:** 2 checksum errors · 3 malformed lines

**Use for:** Error detection; exercises bad checksum, missing start code, unknown record type, and wrong byte count for a fixed-size record type.

---

## Motorola SREC (`srec/`)

### `minimal.srec`

**Format:** SREC with S1 (2-byte address) data records

**Records:** S0 header · 2x S1 data · S5 record count · S9 end-of-file

| Address | Content | Bytes |
|---------|---------|-------|
| `0x0000` | Sequential bytes `0x01-0x10` | 16 |

**Stats:** 1 segment · 16 bytes · 5 records · 0 errors

**Use for:** Simplest valid SREC file; exercises S0, S1, S5, S9 record types and one's-complement checksum validation.

---

### `firmware_s1.srec`

**Format:** SREC with S1 (2-byte address) records

**Target:** 8051 microcontroller — content mirrors `ihex/minimal.hex`

| Address | Content | Bytes |
|---------|---------|-------|
| `0x0000` | `LJMP 0x0030` reset vector | 3 |
| `0x0003` | Zero-padding | 5 |
| `0x0030` | Application entry stub + `"Hello"` string | 32 |

**Stats:** 2 segments · 40 bytes · 7 records · 0 errors · start address `0x0030`

**Use for:** Cross-format parity — SREC and IHEX parsers must produce byte-identical segments and addresses for the same underlying content.

---

### `firmware_s3.srec`

**Format:** SREC with S3 (4-byte address) records

**Target:** STM32-class MCU

| Address | Content |
|---------|---------|
| `0x08000000` | Cortex-M3 partial vector table (2 x 16-byte records) |
| `0x08002000` | `0xDEADBEEF` + `0xCAFEBABE` magic + sequential data bytes |
| `0x08010000` | `"HELLO WORLD!"` + firmware identity string |

**Stats:** 3 segments · 103 bytes · 9 records · 0 errors · start address `0x08000141`

**Use for:** S3 32-bit address parsing, multi-segment layout, `0xDEADBEEF` sentinel detection, S7 execution address record.

---

### `stm32_s3.srec`

**Format:** SREC with S3 (4-byte address) records

**Target:** STM32F103C8T6 (Cortex-M3) — realistic firmware image

| Address | Content | Bytes |
|---------|---------|-------|
| `0x08000000` | Cortex-M3 vector table (SP + 19 vectors) | 128 |
| `0x080000C0` | ARM Thumb-2 Reset_Handler + app stubs | 70 |
| `0x08010000` | Flash config block + identity strings | 66 |

**Stats:** 5 segments · 264 bytes · 20 records · 0 errors · start address `0x080000C1`

**Use for:** Realistic STM32 firmware in S3 SREC format, large address gaps between segments, S7 execution start address.

---

### `mixed_addr.srec`

**Format:** SREC mixing **S1, S2, and S3** data records in a single file

| Record | Address | Data |
|--------|---------|------|
| S1 | `0x0100` | `0x11 0x22 0x33 0x44` (4 bytes) |
| S2 | `0x100000` | `0xAA 0xBB 0xCC 0xDD` (4 bytes) |
| S3 | `0x08000000` | `0xDE AD BE EF CA FE BA BE` (8 bytes) |

**Stats:** 3 segments · 16 bytes · 6 records · 0 errors

**Use for:** Validating correct resolution of all three SREC address widths (2-byte S1, 3-byte S2, 4-byte S3) within the same file. Each record type uses a distinct address range.

---

### `errors.srec`

**Format:** SREC with intentional errors

| Line | Record | Status |
|------|--------|--------|
| 1 | S0 header | Valid |
| 2 | S1 data `0x0000` | **Bad checksum** |
| 3 | S1 data `0x0010` | **Bad checksum** |
| 4 | `;; not a valid srec record` | **Malformed** (no `S` start code) |
| 5 | `S4030000FC` | **Malformed** (reserved record type S4) |
| 6 | `S1020000` | **Malformed** (byte count 2 too small for S1, minimum 3) |
| 7 | `S5050003AABB92` | **Malformed** (S5 count record must have byte count 3, got 5) |
| 8 | S1 data `0x0020` | Valid |
| 9 | S9 end-of-file | Valid |

**Stats:** 1 segment · 3 bytes · 2 checksum errors · 4 malformed lines

**Use for:** Error detection in SREC; exercises bad checksum, missing start code, reserved type S4, byte count too small, and wrong byte count for a non-data record type.
