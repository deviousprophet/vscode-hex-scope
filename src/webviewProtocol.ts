import type { CopyCommand } from './core/byte-tools/copyCommand';
import type { DiffMeta } from './core/diff';
import type { HexScopeFormat } from './core/document';
import type { IntegrityCheckSet, IntegrityProfile } from './core/integrity';
import type { SearchEndianness, SearchMode } from './core/types';
import type { SegmentLabel, SerializedRecord, StructDef, StructPin, WireParseResult } from './core/types';

export const RECORD_PAGE_SIZE = 512;

export type HexScopeEndian = 'le' | 'be';

export type ProviderToWebviewMessage =
    | {
        type: 'init';
        generation: number;
        parseResult: WireParseResult;
        labels: SegmentLabel[];
        structs: StructDef[];
        structPins: StructPin[];
        endian: HexScopeEndian;
        integrityProfiles: { profiles: IntegrityProfile[]; activeChecks: IntegrityCheckSet };
    }
    | { type: 'loadProgress'; generation: number; stage: 'read' | 'parse' | 'build' | 'transfer'; completed: number; total?: number }
    | { type: 'recordPage'; generation: number; start: number; records: SerializedRecord[] }
    | { type: 'loadError'; generation?: number; message: string }
    | { type: 'addLabel'; label: SegmentLabel }
    | { type: 'updateLabel'; label: SegmentLabel }
    | { type: 'copyCommand'; command?: CopyCommand; format?: string }
    | { type: 'savedEdits'; generation: number; parseResult: WireParseResult }
    | { type: 'externalChange'; generation: number; parseResult: WireParseResult; labels: SegmentLabel[] }
    | {
        type: 'externalChangeError';
        generation: number;
        parseResult: WireParseResult;
        labels: SegmentLabel[];
        checksumErrors: number;
        malformedLines: number;
        errorCount: number;
        canQuickRepair: boolean;
    }
    | { type: 'repairComplete'; generation: number; parseResult: WireParseResult }
    | { type: 'integrityProfiles'; profiles: IntegrityProfile[]; error: string }
    | { type: 'scriptInfo'; trusted: boolean; scripts: Array<{ name: string; filePath: string; capabilities: string[] }> }
    | { type: 'scriptResult'; scriptPath: string; result: { results: Array<{ label: string; value: string }>; log: string[] } | null; error: string; errorType?: 'compile' | 'runtime' | 'timeout' | 'cancel'; pendingWriteCount: number }
    | { type: 'scriptOutput'; scriptPath: string; text: string }
    | { type: 'activateScriptsTab' }
    | { type: 'diffInit'; generation: number; a: WireParseResult; b: WireParseResult; meta: DiffMeta; aLabel: string; bLabel: string; aFormat: HexScopeFormat; bFormat: HexScopeFormat; aError: string | null; bError: string | null; aLabels: SegmentLabel[]; bLabels: SegmentLabel[] }
    | { type: 'diffUpdate'; generation: number; a: WireParseResult; b: WireParseResult; meta: DiffMeta; aError: string | null; bError: string | null }
    | { type: 'diffProgress'; generation: number; stage: 'read' | 'parse' | 'build' | 'transfer'; completed: number; total: number }
    | { type: 'diffSwap'; generation: number; swapped: boolean }
    | { type: 'diffSearch'; generation: number; query: string; matches: number[]; done: boolean };

export type WebviewToProviderMessage =
    | { type: 'ready' }
    | { type: 'requestRecordPage'; generation: number; start: number; count: number }
    | { type: 'reloadAccepted' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'saveLabels'; labels: SegmentLabel[] }
    | { type: 'saveStructs'; structs: StructDef[] }
    | { type: 'saveStructPins'; pins: StructPin[] }
    | { type: 'saveIntegrityChecks'; state: IntegrityCheckSet }
    | { type: 'saveEndian'; endian: HexScopeEndian }
    | { type: 'createIntegrityProfile'; profile: IntegrityProfile }
    | { type: 'updateIntegrityProfile'; profile: IntegrityProfile }
    | { type: 'renameIntegrityProfile'; id: string; name: string }
    | { type: 'deleteIntegrityProfile'; id: string }
    | { type: 'updateLabelVisibility'; id: string; hidden: boolean }
    | { type: 'reorderLabel'; id: string; dir: number }
    | { type: 'saveEdits'; edits: Array<[number, number]> }
    | { type: 'repairAndReload' }
    | { type: 'closePanel' }
    | { type: 'viewInNormalEditor' }
    | { type: 'requestScriptList' }
    | { type: 'runScript'; scriptPath: string; generation: number; selectionRange?: { start: number; end: number } }
    | { type: 'cancelScript'; scriptPath: string }
    | { type: 'diffReady' }
    | { type: 'diffSwapRequest' }
    | { type: 'diffSearchRequest'; generation: number; query: string; mode: SearchMode; endianness: SearchEndianness };

export function messageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}
