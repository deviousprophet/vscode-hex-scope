// ── Shared Parser Types ───────────────────────────────────────────
// Common interfaces shared between IntelHexParser and SRecParser.
// Both parsers produce a ParseResult of this shape so the rest of
// the extension (provider, webview) can be format-agnostic.

// ── Record ────────────────────────────────────────────────────────

/** A single parsed line from a hex/SREC file. */
export interface HexRecord {
    /** 1-based source line number. */
    lineNumber: number;
    /** Raw source text of the line. */
    raw: string;
    /** Byte count field value as stated in the record. */
    byteCount: number;
    /** Address field value as stated in the record (16-bit for IHEX; 16/24/32-bit for SREC). */
    address: number;
    /** Record type field value. Semantics differ by format. */
    recordType: number;
    /** Data payload bytes (excludes address, checksum). */
    data: Uint8Array;
    /** Checksum byte as stated in the record. */
    checksum: number;
    /** Whether the stated checksum matches the computed one. */
    checksumValid: boolean;
    /** Full 32-bit resolved memory address (data records only; 0 for non-data). */
    resolvedAddress: number;
    /** Set when the line could not be parsed at all. */
    error?: string;
}

// ── Memory Segment ────────────────────────────────────────────────

/**
 * A contiguous block of memory data derived from one or more
 * consecutive data records with no address gaps between them.
 */
export interface MemorySegment {
    startAddress: number;
    data: Uint8Array;
}

// ── Parse Result ──────────────────────────────────────────────────

/** Complete result returned by both {@link parseIntelHex} and {@link parseSRec}. */
export interface ParseResult {
    records: HexRecord[];
    segments: MemorySegment[];
    /** Total number of data bytes across all contiguous segments. */
    totalDataBytes: number;
    /** Number of records whose checksum did not match. */
    checksumErrors: number;
    /** Number of lines that could not be parsed at all. */
    malformedLines: number;
    /** Execution start address from a start-address record, if present. */
    startAddress?: number;
}
