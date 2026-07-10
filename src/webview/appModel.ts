import type { SegmentLabel, SerializedParseResult, WireParseResult } from '../core/types';
import type { ProviderToWebviewMessage } from '../webviewProtocol';
import { buildMemRows, initFlatBytes } from './memory/memoryData';
import { S } from './state';

export type InitMessage = Extract<ProviderToWebviewMessage, { type: 'init' }>;
export type IncomingFile = {
    parseResult: SerializedParseResult;
    generation: number;
    labels: SegmentLabel[];
};

export type ClearEditReason = 'refresh' | 'discard';

export function applyInitialState(msg: InitMessage): void {
    S.documentGeneration = msg.generation;
    loadParsedMemory(hydrateParseResult(msg.parseResult));
    S.labels = messageArray(msg.labels);
    S.structs = messageArray(msg.structs);
    S.structPins = messageArray(msg.structPins);
    S.endian = msg.endian;
    S.currentView = 'memory';
}

export function hydrateParseResult(result: WireParseResult): SerializedParseResult {
    return {
        ...result,
        records: [],
        segments: result.segments.map(segment => ({
            startAddress: segment.startAddress,
            data: new Uint8Array(segment.data),
        })),
    };
}

function messageArray<T>(value: T[]): T[] {
    return Array.isArray(value) ? value : [];
}

export function loadParsedMemory(parseResult: SerializedParseResult): void {
    S.parseResult = parseResult;
    initFlatBytes();
    buildMemRows();
}

export function rebuildMemoryRows(): void {
    buildMemRows();
}

export function addLabel(label: SegmentLabel): void {
    S.labels = [...S.labels, label];
}

export function updateLabel(label: SegmentLabel): void {
    S.labels = S.labels.map(item => item.id === label.id ? label : item);
}

export function incomingFile(parseResult: WireParseResult, labels: SegmentLabel[], generation: number): IncomingFile {
    return { parseResult: hydrateParseResult(parseResult), labels, generation };
}

export function loadIncomingFile(file: IncomingFile): void {
    loadParsedMemory(file.parseResult);
    S.documentGeneration = file.generation;
    S.labels = file.labels;
}

export function lockForExternalChange(): void {
    S.lockedDueToExternalChange = true;
}

export function unlockExternalChange(): void {
    S.lockedDueToExternalChange = false;
}

export function clearEditModel(): void {
    S.edits.clear();
    S.undoStack.length = 0;
    S.editMode = false;
}

export function hasUnsavedEdits(): boolean {
    return S.editMode && S.edits.size > 0;
}
