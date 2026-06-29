// ── Shared mutable state ─────────────────────────────────────────
// All modules import this object and mutate it directly.

import type { SerializedParseResult, SegmentLabel, SearchMode, SearchEndianness, BitFieldAllocation, MemRow, StructDef, StructPin } from '../core/types';
import type { SegmentIndexEntry } from '../core/memory';
import type { SidebarTab } from './types';

export const BPR = 16; // bytes per memory row

export const S = {
    parseResult:  null   as SerializedParseResult | null,
    labels:       []     as SegmentLabel[],
    /** Segment index for O(log n) byte access (built on parseResult change) */
    segmentIndex: [] as SegmentIndexEntry[],
    currentView: 'memory' as 'record' | 'memory',
    selStart:     null   as number | null,
    selEnd:       null   as number | null,
    endian:       'le'   as 'le' | 'be',
    bitFieldAllocation: 'msb' as BitFieldAllocation,
    searchMode:   'bytes'  as SearchMode,
    searchEndianness: 'auto' as SearchEndianness,
    matchAddrs:   []     as number[],
    matchIdx:     -1,
    memRows:      []     as MemRow[],
    editMode:     false  as boolean,
    edits:        new Map<number, number>(),   // addr → new value (pending saves)
    undoStack:    [] as Array<Array<[number, number]>>,  // stack of [addr, prevVal] transactions
    structs:      [] as StructDef[],           // user-defined struct definitions
    activeStructAddr: null as number | null,   // base address for struct decode
    structPins:   [] as StructPin[],           // saved (structId, addr) overlay instances
    integrityHighlight: null as null | {
        rangeStart: number;
        rangeEnd: number;
        storedStart?: number;
        storedLength?: number;
        status: 'match' | 'mismatch' | 'unverified';
    },
    sidebarTab:     'inspector' as SidebarTab,  // active sidebar tab
    lockedDueToExternalChange: false as boolean,  // view is locked pending external change action
};
