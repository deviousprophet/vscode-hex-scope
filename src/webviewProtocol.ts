import type { CopyCommand } from './core/byteTools/copyCommand';
import type { HexScopeFormat } from './core/document';
import type { IntegrityCheckSet, IntegrityProfile } from './core/integrity';
import type { FileProfile } from './core/workspaceConfigModel';
import type { SegmentLabel, SerializedRecord, StructDef, StructPin, WireParseResult } from './core/types';

export const RECORD_PAGE_SIZE = 512;

export type HexScopeEndian = 'le' | 'be';

/** Pinned-segment name overrides, keyed by segment start address (decimal string). */
export type SegmentNameOverrides = Record<string, string>;

/** Normalize untrusted segment name overrides from `unknown`. */
export function normalizeSegmentNameOverrides(value: unknown): SegmentNameOverrides {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { return {}; }
    const out: SegmentNameOverrides = {};
    const raw = value as Record<string, unknown>;
    for (const [key, name] of Object.entries(raw)) {
        if (typeof name === 'string') { out[key] = name; }
    }
    return out;
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
        integrityProfiles: { profiles: IntegrityProfile[]; activeChecks: IntegrityCheckSet };
        fileProfiles: FileProfile[];
        activeFileProfileId: string | null;
    }
    | { type: 'loadProgress'; generation: number; stage: 'read' | 'parse' | 'build' | 'transfer'; completed: number; total?: number }
    | { type: 'recordPage'; generation: number; start: number; records: SerializedRecord[] }
    | { type: 'loadError'; generation?: number; message: string }
    | { type: 'addLabel'; label: SegmentLabel }
    | { type: 'updateLabel'; label: SegmentLabel }
    | { type: 'copyCommand'; command?: CopyCommand; format?: string }
    | { type: 'savedEdits'; generation: number; parseResult?: WireParseResult }
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
    | { type: 'integrityProfiles'; profiles: IntegrityProfile[]; error: string }
    | { type: 'fileProfiles'; profiles: FileProfile[]; activeFileProfileId: string | null; error: string }
    | {
        type: 'fileProfileApplied';
        activeFileProfileId: string | null;
        structPins: StructPin[];
        endian: HexScopeEndian;
        activeChecks: IntegrityCheckSet;
    }
    | {
        type: 'workspaceConfigReloaded';
        structs: StructDef[];
        integrityProfiles: { profiles: IntegrityProfile[]; activeChecks: IntegrityCheckSet };
        labels: SegmentLabel[];
        segmentNames?: SegmentNameOverrides;
        structPins: StructPin[];
        endian: HexScopeEndian;
        fileProfiles: FileProfile[];
        activeFileProfileId: string | null;
    }
    | { type: 'scriptInfo'; trusted: boolean; scripts: Array<{ name: string; filePath: string; capabilities: string[]; fingerprint: string }> }
    | { type: 'scriptResult'; scriptPath: string; result: { results: Array<{ label: string; value: string }>; log: string[] } | null; error: string; errorType?: 'compile' | 'runtime' | 'timeout' | 'cancel'; pendingWriteCount: number; pendingWrites?: Array<[number, number]> }
    | { type: 'scriptOutput'; scriptPath: string; text: string }
    | { type: 'activateScriptsTab' };

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
    | { type: 'createIntegrityProfile'; profile: IntegrityProfile }
    | { type: 'updateIntegrityProfile'; profile: IntegrityProfile }
    | { type: 'renameIntegrityProfile'; id: string; name: string }
    | { type: 'deleteIntegrityProfile'; id: string }
    | { type: 'updateLabelVisibility'; id: string; hidden: boolean }
    | { type: 'reorderLabel'; id: string; dir: number }
    | { type: 'selectFileProfile'; id: string | null }
    | { type: 'createFileProfile'; name: string; pins: StructPin[]; endian: HexScopeEndian; integrityProfileId: string | null }
    | { type: 'updateFileProfile'; profile: FileProfile }
    | { type: 'renameFileProfile'; id: string; name: string }
    | { type: 'deleteFileProfile'; id: string }
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
