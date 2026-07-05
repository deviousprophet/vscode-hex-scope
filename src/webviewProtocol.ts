import type { CopyCommand } from './core/byte-tools';
import type { HexScopeFormat } from './core/document';
import type { IntegrityCheckSet, IntegrityProfile } from './core/integrity';
import type { SegmentLabel, SerializedParseResult, StructDef, StructPin } from './core/types';

export type HexScopeEndian = 'le' | 'be';

export type ProviderToWebviewMessage =
    | {
        type: 'init';
        parseResult: SerializedParseResult;
        labels: SegmentLabel[];
        structs: StructDef[];
        structPins: StructPin[];
        endian: HexScopeEndian;
        integrityProfiles: { profiles: IntegrityProfile[]; activeChecks: IntegrityCheckSet };
    }
    | { type: 'loadError'; message: string }
    | { type: 'addLabel'; label: SegmentLabel }
    | { type: 'updateLabel'; label: SegmentLabel }
    | { type: 'copyCommand'; command?: CopyCommand; format?: string }
    | { type: 'savedEdits'; parseResult: SerializedParseResult }
    | { type: 'externalChange'; parseResult: SerializedParseResult; labels: SegmentLabel[] }
    | {
        type: 'externalChangeError';
        parseResult: SerializedParseResult;
        labels: SegmentLabel[];
        checksumErrors: number;
        malformedLines: number;
        errorCount: number;
        canQuickRepair: boolean;
    }
    | { type: 'repairComplete'; parseResult: SerializedParseResult }
    | { type: 'integrityProfiles'; profiles: IntegrityProfile[]; error: string };

export type WebviewToProviderMessage =
    | { type: 'ready' }
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
    | { type: 'viewInNormalEditor' };

export function messageType(message: unknown): string | undefined {
    return typeof (message as { type?: unknown })?.type === 'string'
        ? (message as { type: string }).type
        : undefined;
}
