import type { CopyCommand } from './core/byteTools/copyCommand';
import type { HexScopeFormat } from './core/document';
import type { IntegrityCheckSet } from './core/integrity';
import type { SegmentLabel, SerializedRecord, StructDef, StructPin, WireParseResult } from './core/types';

export const RECORD_PAGE_SIZE = 512;

export type HexScopeEndian = 'le' | 'be';

/** Single shared endian normalizer (session slot normalizer + webview model). */
export function endianOrDefault(value: unknown): HexScopeEndian {
    return value === 'be' ? 'be' : 'le';
}

/** Pinned-segment name overrides, keyed by segment start address (decimal string). */
export type SegmentNameOverrides = Record<string, string>;

/** One registry profile as carried in webview payloads (no contents). */
export interface ProfileSummary {
    id: string;
    name: string;
}

export type ProviderToWebviewMessage =
    | {
        type: 'init';
        generation: number;
        parseResult: WireParseResult;
        labels: SegmentLabel[];
        segmentNames?: SegmentNameOverrides;
        structs: StructDef[];
        structPins: StructPin[];
        endian: HexScopeEndian;
        activeChecks: IntegrityCheckSet;
        /** Current bound profile display state. */
        profile: { profiles: ProfileSummary[]; current: string | null; boundFileCount: number };
    }
    | { type: 'loadProgress'; generation: number; stage: 'read' | 'parse' | 'build' | 'transfer'; completed: number; total?: number }
    | { type: 'recordPage'; generation: number; start: number; records: SerializedRecord[] }
    | { type: 'loadError'; generation?: number; message: string }
    | { type: 'addLabel'; label: SegmentLabel }
    | { type: 'updateLabel'; label: SegmentLabel }
    | { type: 'copyCommand'; command?: CopyCommand; format?: string }
| { type: 'savedEdits'; generation: number; parseResult?: WireParseResult }
| { type: 'structsExternalChange'; structs: StructDef[] }
| { type: 'perFileDataChange'; labels: SegmentLabel[]; segmentNames?: SegmentNameOverrides; pins: StructPin[]; endian: HexScopeEndian; activeChecks: IntegrityCheckSet }
| { type: 'profilesState'; profiles: ProfileSummary[]; current: string | null; boundFileCount: number }
| { type: 'externalChange'; generation: number; parseResult: WireParseResult; labels: SegmentLabel[]; segmentNames?: SegmentNameOverrides }
    | {
        type: 'externalChangeError';
        generation: number;
        parseResult: WireParseResult;
        labels: SegmentLabel[];
        segmentNames?: SegmentNameOverrides;
        checksumErrors: number;
        malformedLines: number;
        errorCount: number;
        canQuickRepair: boolean;
    }
    | { type: 'repairComplete'; generation: number; parseResult: WireParseResult }
    | { type: 'scriptInfo'; trusted: boolean; scripts: Array<{ name: string; filePath: string; capabilities: string[]; fingerprint: string }> }
    | { type: 'scriptResult'; scriptPath: string; result: { results: Array<{ label: string; value: string }>; log: string[] } | null; error: string; errorType?: 'compile' | 'runtime' | 'timeout' | 'cancel'; pendingWriteCount: number; pendingWrites?: Array<[number, number]> }
    | { type: 'scriptOutput'; scriptPath: string; text: string }
    | { type: 'activateScriptsTab' }
    | { type: 'activateProfilePicker' };

export type WebviewToProviderMessage =
    | { type: 'ready' }
    | { type: 'requestRecordPage'; generation: number; start: number; count: number }
    | { type: 'reloadAccepted' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'saveLabels'; labels: SegmentLabel[]; segmentNames?: SegmentNameOverrides }
    | { type: 'saveStructs'; structs: StructDef[] }
    | { type: 'saveStructPins'; pins: StructPin[] }
    | { type: 'saveIntegrityChecks'; state: IntegrityCheckSet }
    | { type: 'saveEndian'; endian: HexScopeEndian }
    | { type: 'selectProfile'; profileId: string | null }
    | { type: 'newProfile'; name: string | null }
    | { type: 'saveProfile' }
    | { type: 'duplicateProfile' }
    | { type: 'renameProfile' }
    | { type: 'deleteProfile' }
    | { type: 'updateLabelVisibility'; id: string; hidden: boolean }
    | { type: 'reorderLabel'; id: string; dir: number }
    | { type: 'saveEdits'; edits: Array<[number, number]> }
    | { type: 'repairAndReload' }
    | { type: 'closePanel' }
    | { type: 'viewInNormalEditor' }
    | { type: 'requestScriptList' }
    | { type: 'runScript'; scriptPath: string; generation: number; selectionRange?: { start: number; end: number } }
    | { type: 'cancelScript'; scriptPath: string };

export function messageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}
