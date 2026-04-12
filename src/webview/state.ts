// ── Shared mutable state ─────────────────────────────────────────
// All modules import this object and mutate it directly.

import type { SerializedParseResult, SegmentLabel, SearchMode, MemRow, StructDef, StructPin } from './types';

export const BPR = 16; // bytes per memory row

export const S = {
    parseResult:  null   as SerializedParseResult | null,
    labels:       []     as SegmentLabel[],
    flatBytes:    new Map<number, number>(),
    sortedAddrs:  []     as number[],
    currentView: 'raw'    as 'record' | 'memory' | 'raw',  // raw until file validity is known
    rawSource:    ''     as string,
    selStart:     null   as number | null,
    selEnd:       null   as number | null,
    endian:       'le'   as 'le' | 'be',
    searchMode:   'hex'  as SearchMode,
    matchAddrs:   []     as number[],
    matchIdx:     -1,
    memRows:      []     as MemRow[],
    editMode:     false  as boolean,
    edits:        new Map<number, number>(),   // addr → new value (pending saves)
    undoStack:    [] as Array<Array<[number, number]>>,  // stack of [addr, prevVal] transactions
    structs:      [] as StructDef[],           // user-defined struct definitions
    activeStructId:   null as string | null,   // id of currently selected struct
    activeStructAddr: null as number | null,   // base address for struct decode
    structPins:   [] as StructPin[],           // saved (structId, addr) overlay instances
    sidebarTab:     'inspector' as 'inspector' | 'struct',  // active sidebar tab
};
