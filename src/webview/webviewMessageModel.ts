import type { CopyCommand } from '../core/byte-tools/copyCommand';
import type { IntegrityCheckSet, IntegrityProfile } from '../core/integrity';
import type { ProviderToWebviewMessage } from '../webviewProtocol';
import {
    addLabel,
    applyInitialState,
    clearEditModel,
    hasUnsavedEdits,
    incomingFile,
    loadIncomingFile,
    loadParsedMemory,
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
};

type WebviewMessage = ProviderToWebviewMessage;
type WebviewMessageByType<T extends WebviewMessage['type']> = Extract<WebviewMessage, { type: T }>;
type ModelAppliers = {
    [T in WebviewMessage['type']]: (msg: WebviewMessageByType<T>) => WebviewModelUpdate;
};

const MODEL_APPLIERS: ModelAppliers = {
    init: applyInitMessage,
    integrityProfiles: applyIntegrityProfilesMessage,
    loadError: applyLoadErrorMessage,
    addLabel: applyAddLabelMessage,
    updateLabel: applyUpdateLabelMessage,
    copyCommand: applyCopyCommandMessage,
    savedEdits: applySavedEditsMessage,
    externalChange: applyExternalChangeMessage,
    externalChangeError: applyExternalChangeErrorMessage,
    repairComplete: applyRepairCompleteMessage,
};

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
    loadParsedMemory(msg.parseResult);
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

function applyExternalChangeMessage(msg: WebviewMessageByType<'externalChange'>): WebviewModelUpdate {
    lockForExternalChange();
    return {
        removeExternalChangeBanners: true,
        externalChange: { incoming: incomingFileFromExternalChange(msg), hasUnsavedEdits: hasUnsavedEdits() },
        invalidations: { lockState: true },
    };
}

function applyExternalChangeErrorMessage(msg: WebviewMessageByType<'externalChangeError'>): WebviewModelUpdate {
    loadIncomingFile(incomingFile(msg.parseResult, msg.labels));
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
    loadParsedMemory(msg.parseResult);
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
    return incomingFile(msg.parseResult, msg.labels);
}
