import type { CopyCommand } from '../core/byteTools/copyCommand';
import type { IntegrityCheckSet, IntegrityProfile } from '../core/integrity';
import type { SegmentLabel, StructDef, StructPin } from '../core/types';
import type { ProviderToWebviewMessage } from '../webviewProtocol';
import { S } from './state';
import {
    addLabel,
    applyInitialState,
    clearEditModel,
    hasUnsavedEdits,
    incomingFile,
    loadIncomingFile,
    loadParsedMemory,
    hydrateParseResult,
    lockForExternalChange,
    rebuildMemoryRows,
    type IncomingFile,
    unlockExternalChange,
    updateLabel,
} from './appModel';

export type WebviewInvalidations = {
    fullRender?: boolean;
    labelsAndMemory?: boolean;
    lockState?: boolean;
    editControls?: boolean;
    dirtyBar?: boolean;
    stats?: boolean;
    segments?: boolean;
    structPins?: boolean;
    currentDataView?: boolean;
    integrityBytesChanged?: boolean;
};

export type ExternalChangeErrorDetails = {
    checksumErrors: number;
    malformedLines: number;
    errorCount: number;
    canQuickRepair: boolean;
};

export type WebviewModelUpdate = {
    invalidations: WebviewInvalidations;
    loadErrorMessage?: string;
    copyCommand?: CopyCommand;
    integrityProfiles?: { profiles: IntegrityProfile[]; activeChecks: IntegrityCheckSet } | IntegrityProfile[];
    integrityProfileError?: string;
    removeExternalChangeBanners?: boolean;
    removeExternalChangeErrorBanner?: boolean;
    externalChange?: { incoming: IncomingFile; hasUnsavedEdits: boolean };
    externalChangeError?: ExternalChangeErrorDetails;
    /** `structsExternalChange` was applied (S.structs replaced, dangling pins pruned). */
    structsExternalChangeApplied?: boolean;
    /** `perFileDataChange` applied — effect pushes activeChecks + endian chrome. */
    perFileDataApplied?: { activeChecks: IntegrityCheckSet; endian: 'le' | 'be' };
};

type WebviewMessage = ProviderToWebviewMessage;
type WebviewMessageByType<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;
type ModelAppliers = {
    [T in WebviewMessage['type']]: (msg: WebviewMessageByType<T>) => WebviewModelUpdate;
};

const MODEL_APPLIERS: ModelAppliers = {
    init: applyInitMessage,
    loadProgress: applyPassiveMessage,
    recordPage: applyPassiveMessage,
    integrityProfiles: applyIntegrityProfilesMessage,
    loadError: applyLoadErrorMessage,
    addLabel: applyAddLabelMessage,
    updateLabel: applyUpdateLabelMessage,
    copyCommand: applyCopyCommandMessage,
    savedEdits: applySavedEditsMessage,
    externalChange: applyExternalChangeMessage,
    externalChangeError: applyExternalChangeErrorMessage,
    repairComplete: applyRepairCompleteMessage,
    structsExternalChange: applyStructsExternalChangeMessage,
    perFileDataChange: applyPerFileDataChangeMessage,
    scriptInfo: applyPassiveMessage,
    scriptResult: applyPassiveMessage,
    scriptOutput: applyPassiveMessage,
    activateScriptsTab: applyPassiveMessage,
};

function applyPassiveMessage(): WebviewModelUpdate { return { invalidations: {} }; }

export function applyProviderMessageToModel(msg: WebviewMessage): WebviewModelUpdate {
    const apply = MODEL_APPLIERS[msg.type] as (message: WebviewMessage) => WebviewModelUpdate;
    return apply(msg);
}

function applyInitMessage(msg: WebviewMessageByType<'init'>): WebviewModelUpdate {
    applyInitialState(msg);
    return {
        integrityProfiles: msg.integrityProfiles,
        invalidations: { fullRender: true },
    };
}

function applyIntegrityProfilesMessage(msg: WebviewMessageByType<'integrityProfiles'>): WebviewModelUpdate {
    return {
        integrityProfiles: msg.profiles,
        integrityProfileError: typeof msg.error === 'string' ? msg.error : '',
        invalidations: {},
    };
}

function applyLoadErrorMessage(msg: WebviewMessageByType<'loadError'>): WebviewModelUpdate {
    return {
        loadErrorMessage: String(msg.message ?? 'Failed to open file.'),
        invalidations: {},
    };
}

function applyAddLabelMessage(msg: WebviewMessageByType<'addLabel'>): WebviewModelUpdate {
    addLabel(msg.label);
    rebuildMemoryRows();
    return { invalidations: { labelsAndMemory: true } };
}

function applyUpdateLabelMessage(msg: WebviewMessageByType<'updateLabel'>): WebviewModelUpdate {
    updateLabel(msg.label);
    rebuildMemoryRows();
    return { invalidations: { labelsAndMemory: true } };
}

function applyCopyCommandMessage(msg: WebviewMessageByType<'copyCommand'>): WebviewModelUpdate {
    return { copyCommand: msg.command, invalidations: {} };
}

function applySavedEditsMessage(msg: WebviewMessageByType<'savedEdits'>): WebviewModelUpdate {
    S.documentGeneration = msg.generation;
    if (msg.parseResult) {
        // Legacy/fallback: host pushed the whole parse result → full reload.
        loadParsedMemory(hydrateParseResult(msg.parseResult));
        clearEditModel();
        return {
            invalidations: {
                editControls: true,
                dirtyBar: true,
                stats: true,
                segments: true,
                structPins: true,
                currentDataView: true,
                integrityBytesChanged: true,
            },
        };
    }
    // Fast path: fold saved bytes into local segments, clear only the overlay.
    // Undo/redo stacks + edit mode survive so Ctrl+Z still reverts the save.
    foldLocalEdits();
    S.edits.clear();
    return {
        invalidations: {
            dirtyBar: true,
            editControls: true,
            currentDataView: true,
            integrityBytesChanged: true,
        },
    };
}

/** Apply pending edits into the local segment bytes (grid reads via getByteAt).
    Also keeps undo/redo base (getOriginalByte) truthful after a save. */
function foldLocalEdits(): void {
    if (!S.parseResult) { return; }
    for (const [addr, value] of S.edits) { patchLocalSegment(addr, value); }
}

function patchLocalSegment(addr: number, value: number): void {
    for (const seg of S.parseResult!.segments) {
        const off = addr - seg.startAddress;
        if (off >= 0 && off < seg.data.length) {
            (seg.data as unknown as Uint8Array)[off] = value;
            return;
        }
    }
}

function applyExternalChangeMessage(msg: WebviewMessageByType<'externalChange'>): WebviewModelUpdate {
    lockForExternalChange();
    return {
        removeExternalChangeBanners: true,
        externalChange: { incoming: incomingFileFromExternalChange(msg), hasUnsavedEdits: hasUnsavedEdits() },
        invalidations: { lockState: true },
    };
}

function applyExternalChangeErrorMessage(msg: WebviewMessageByType<'externalChangeError'>): WebviewModelUpdate {
    loadIncomingFile(incomingFile(msg.parseResult, msg.labels, msg.generation, msg.segmentNames));
    lockForExternalChange();
    clearUnsavedEditsForExternalError();
    return {
        removeExternalChangeBanners: true,
        externalChangeError: {
            checksumErrors: msg.checksumErrors,
            malformedLines: msg.malformedLines,
            errorCount: msg.errorCount,
            canQuickRepair: msg.canQuickRepair,
        },
        invalidations: {
            lockState: true,
            segments: true,
            structPins: true,
            currentDataView: true,
            integrityBytesChanged: true,
        },
    };
}

function clearUnsavedEditsForExternalError(): void {
    if (hasUnsavedEdits()) { clearEditModel(); }
}

function applyRepairCompleteMessage(msg: WebviewMessageByType<'repairComplete'>): WebviewModelUpdate {
    S.documentGeneration = msg.generation;
    loadParsedMemory(hydrateParseResult(msg.parseResult));
    clearEditModel();
    unlockExternalChange();
    return {
        removeExternalChangeErrorBanner: true,
        invalidations: {
            lockState: true,
            editControls: true,
            dirtyBar: true,
            stats: true,
            segments: true,
            structPins: true,
            currentDataView: true,
            integrityBytesChanged: true,
        },
    };
}

function incomingFileFromExternalChange(
    msg: Extract<WebviewMessage, { type: 'externalChange' }>,
): IncomingFile {
    return incomingFile(msg.parseResult, msg.labels, msg.generation, msg.segmentNames);
}

function applyStructsExternalChangeMessage(msg: WebviewMessageByType<'structsExternalChange'>): WebviewModelUpdate {
    S.structs = msg.structs;
    // Drop pins whose struct definition vanished (matches cascade-delete semantics);
    // the host persists the pruned pins so the local file stays consistent.
    const ids = new Set(msg.structs.map(def => def.id));
    S.structPins = S.structPins.filter(pin => ids.has(pin.structId));
    return {
        structsExternalChangeApplied: true,
        invalidations: { structPins: true },
    };
}

function applyPerFileDataChangeMessage(msg: WebviewMessageByType<'perFileDataChange'>): WebviewModelUpdate {
    S.labels = segmentLabelArray(msg.labels);
    S.segmentNames = segmentNamesMap(msg.segmentNames);
    S.structPins = structPinArray(msg.pins);
    S.endian = endianOrDefault(msg.endian);
    rebuildMemoryRows();
    return {
        perFileDataApplied: { activeChecks: msg.activeChecks, endian: S.endian },
        invalidations: { labelsAndMemory: true, structPins: true },
    };
}

function segmentLabelArray(value: SegmentLabel[] | undefined): SegmentLabel[] {
    return Array.isArray(value) ? value : [];
}

function segmentNamesMap(value: Record<string, string> | undefined): Record<string, string> {
    return value && typeof value === 'object' ? value : {};
}

function structPinArray(value: StructPin[] | undefined): StructPin[] {
    return Array.isArray(value) ? value : [];
}

function endianOrDefault(value: 'le' | 'be'): 'le' | 'be' {
    return value === 'be' ? 'be' : 'le';
}
