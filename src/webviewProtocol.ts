import type { CopyCommand } from './core/byteTools/copyCommand';
import type { HexScopeFormat } from './core/document';
import type { IntegrityCheckSet } from './core/integrity';
import type { ScriptInfo } from './core/scripting/types';
import type { ScriptContext, ScriptErrorType } from './core/scripting/types';
import type { BitFieldAllocation, SegmentLabel, SerializedRecord, TypeDef, TypeInstance, WireParseResult } from './core/types';

export const RECORD_PAGE_SIZE = 512;

/** Inline script-approval prompts deny (host) and close (panel) after this long. */
export const SCRIPT_PERMISSION_TIMEOUT_MS = 120_000;

export type HexScopeEndian = 'le' | 'be';

/** Single shared endian normalizer (session slot normalizer + webview model). */
export function endianOrDefault(value: unknown): HexScopeEndian {
    return value === 'be' ? 'be' : 'le';
}

/** Single shared bit-field allocation normalizer (session slot normalizer + webview model). */
export function bitAllocationOrDefault(value: unknown): BitFieldAllocation {
    return value === 'lsb' ? 'lsb' : 'msb';
}

/** Single shared "show hidden fields" normalizer (session slot normalizer + webview model). Default off. */
export function showHiddenFieldsOrDefault(value: unknown): boolean {
    return value === true;
}

/** Pinned-segment name overrides, keyed by segment start address (decimal string). */
export type SegmentNameOverrides = Record<string, string>;

/** Dangerous script capabilities that require per-call approval. */
export type ScriptCapability = 'write' | 'exec' | 'fetch';
/** A grant covers one capability, or `*` = every non-exec capability. */
export type ScriptCapabilityGrant = ScriptCapability | '*';
/** Approval lifetime chosen in the inline prompt. */
export type ScriptPermissionScope = 'once' | 'script' | 'session' | 'workspace';
/** One persisted workspace grant as shown in the panel's Permissions section. */
export interface ScriptWorkspaceGrant {
    scriptPath: string;
    capability: ScriptCapabilityGrant;
}

/** One instance address resolved by its `@script address` script. */
export type InstanceAddressResult =
    | { pinId: string; ok: true; addr: number }
    | { pinId: string; ok: false; error: string; errorType?: ScriptErrorType };

/** One dynamic instance in a batched address-resolution request. */
export interface InstanceAddressRequestEntry {
    pinId: string;
    scriptPath: string;
    /** Instance identity/params/selection; the host adds the document size. */
    context: ScriptContext;
}

/** One instance parameter resolved by its `@script size` script. */
export type InstanceParamResult =
    | { pinId: string; param: string; ok: true; value: number }
    | { pinId: string; param: string; ok: false; error: string; errorType?: ScriptErrorType };

/** One script-sourced instance parameter in a batched size-resolution request. */
export interface InstanceParamRequestEntry {
    pinId: string;
    param: string;
    scriptPath: string;
    /** Instance identity, parameter name, resolved siblings, and selection; the host adds the document size. */
    context: ScriptContext;
}

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
        types: TypeDef[];
        typeInstances: TypeInstance[];
        endian: HexScopeEndian;
        bitAllocation: BitFieldAllocation;
        showHiddenFields: boolean;
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
| { type: 'typesExternalChange'; types: TypeDef[] }
| { type: 'perFileDataChange'; labels: SegmentLabel[]; segmentNames?: SegmentNameOverrides; pins: TypeInstance[]; endian: HexScopeEndian; bitAllocation: BitFieldAllocation; showHiddenFields: boolean; activeChecks: IntegrityCheckSet }
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
    | { type: 'scriptInfo'; trusted: boolean; scripts: ScriptInfo[] }
    | { type: 'scriptResult'; scriptPath: string; result: { results: Array<{ label: string; value: string }>; log: string[] } | null; error: string; errorType?: 'compile' | 'runtime' | 'timeout' | 'cancel' | 'contract'; pendingWriteCount: number; discardedWriteCount?: number }
    | {
        type: 'integrityScriptResult';
        requestId: number;
        checkId: number;
        generation: number;
        /** Validated value/verify outcome; absent when the run failed. */
        result?: { valid?: boolean; valueBytes?: number[]; byteCount: number; scriptName: string; warnings?: string[] };
        /** Row-level failure (missing/untrusted/contract/timeout). */
        error?: string;
        errorType?: ScriptErrorType;
    }
    | {
        type: 'instanceAddressesResolved';
        requestId: number;
        generation: number;
        /** True when the document moved on; the webview keeps the previous result marked stale. */
        stale?: boolean;
        results: InstanceAddressResult[];
    }
    | {
        type: 'instanceParamsResolved';
        requestId: number;
        generation: number;
        /** True when the document moved on; the webview keeps previous values marked stale. */
        stale?: boolean;
        results: InstanceParamResult[];
    }
    | { type: 'scriptOutput'; scriptPath: string; text: string }
    | {
        type: 'scriptPermissionRequest';
        requestId: number;
        capability: ScriptCapability;
        detail: string;
        scriptPath: string;
        scriptName: string;
        fingerprint: string;
        scopes: ScriptPermissionScope[];
    }
    | { type: 'scriptPermissions'; grants: ScriptWorkspaceGrant[] }
    | { type: 'scriptWritesCommit'; scriptPath: string; writes: Array<[number, number]> }
    | { type: 'activateScriptsTab' }
    | { type: 'activateProfilePicker' };

export type WebviewToProviderMessage =
    | { type: 'ready' }
    | { type: 'requestRecordPage'; generation: number; start: number; count: number }
    | { type: 'reloadAccepted' }
    | { type: 'copyText'; text: string; label?: string }
    | { type: 'saveLabels'; labels: SegmentLabel[]; segmentNames?: SegmentNameOverrides }
    | { type: 'saveTypes'; types: TypeDef[] }
    | { type: 'saveTypeInstances'; pins: TypeInstance[] }
    | { type: 'saveIntegrityChecks'; state: IntegrityCheckSet }
    | { type: 'saveEndian'; endian: HexScopeEndian }
    | { type: 'saveBitAllocation'; bitAllocation: BitFieldAllocation }
    | { type: 'saveShowHiddenFields'; showHiddenFields: boolean }
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
    | {
        type: 'resolveInstanceAddresses';
        requestId: number;
        generation: number;
        /** Pending webview edits overlaid on the host bytes (same shape as saveEdits). */
        edits: Array<[number, number]>;
        entries: InstanceAddressRequestEntry[];
    }
    | {
        type: 'resolveInstanceParams';
        requestId: number;
        generation: number;
        /** Pending webview edits overlaid on the host bytes (same shape as saveEdits). */
        edits: Array<[number, number]>;
        entries: InstanceParamRequestEntry[];
    }
    | { type: 'openScript'; scriptPath: string }
    | {
        type: 'runIntegrityScript';
        requestId: number;
        checkId: number;
        generation: number;
        scriptPath: string;
        startAddress: number;
        endAddress: number;
        storedAddress?: number;
        /** Known stored-field length (from a previous value result); lets the script exclude it. */
        storedLength?: number;
        /** Pending webview edits overlaid on the host bytes (same shape as saveEdits). */
        edits: Array<[number, number]>;
    }
    | { type: 'cancelScript'; scriptPath: string }
    | {
        type: 'scriptPermissionResponse';
        requestId: number;
        decision: 'allow' | 'deny';
        scope: ScriptPermissionScope;
        /** Grant breadth; omitted = the requested capability. `*` = all non-exec. */
        capability?: ScriptCapabilityGrant;
    }
    | { type: 'revokeScriptPermission'; scriptPath: string; capability: ScriptCapabilityGrant }
    | { type: 'addExampleScripts' };

export function messageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}
