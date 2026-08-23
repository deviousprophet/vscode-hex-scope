// ── Workspace config model (runtime-neutral) ──────────────────────
// Team-shared configuration living in `.hexscope/config.json`.
// Pure: no `vscode` import; file I/O and VS Code storage live in the
// host adapter (`src/workspaceConfigStore.ts`) and `HexEditorSession`.

import { normalizeIntegrityProfiles, type IntegrityProfile } from './integrity';
import type { SegmentLabel, StructDef, StructPin } from './types';

export const WORKSPACE_CONFIG_SCHEMA_VERSION = 1 as const;

export interface FileProfile {
    id: string;
    name: string;
    /** Struct instances applied when the profile is active. */
    pins: StructPin[];
    endian: 'le' | 'be';
    /** Referenced entry of the shared integrity-profile library. */
    integrityProfileId: string | null;
}

export interface FileScopeConfig {
    labels: SegmentLabel[];
    segmentNames: Record<string, string>;
    endian: 'le' | 'be';
}

export interface WorkspaceConfig {
    schemaVersion: typeof WORKSPACE_CONFIG_SCHEMA_VERSION;
    /** Shared struct-type library (workspace wins over user-global). */
    structs: StructDef[];
    /** Shared integrity-profile library (workspace wins over user-global). */
    integrityProfiles: IntegrityProfile[];
    /** Named File Profiles; each bundles pins + endian + an integrity ref. */
    profiles: FileProfile[];
    /** Per-firmware-file config, keyed by workspace-relative path. */
    files: Record<string, FileScopeConfig>;
}

const VALID_ENDIAN = new Set(['le', 'be']);

function isEndian(value: unknown): value is 'le' | 'be' {
    return VALID_ENDIAN.has(value as string);
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Normalize one struct pin from unknown; null when malformed. */
export function normalizeFileProfilePin(value: unknown): StructPin | null {
    if (!isRecord(value)) { return null; }
    const id = stringOrNull(value.id);
    const structId = stringOrNull(value.structId);
    const name = stringOrNull(value.name);
    if (!id || !structId || !name) { return null; }
    if (typeof value.addr !== 'number' || !Number.isSafeInteger(value.addr)) { return null; }
    return {
        id,
        structId,
        addr: value.addr,
        name,
        pointerSources: Array.isArray(value.pointerSources) ? value.pointerSources as StructPin['pointerSources'] : undefined,
    };
}

/** Normalize one FileProfile from unknown; null when malformed. */
export function normalizeFileProfile(value: unknown): FileProfile | null {
    if (!isRecord(value)) { return null; }
    const id = stringOrNull(value.id);
    const name = stringOrNull(value.name);
    if (!id || !name) { return null; }
    const endian = isEndian(value.endian) ? value.endian : 'le';
    const pins = Array.isArray(value.pins)
        ? value.pins.map(normalizeFileProfilePin).filter((pin): pin is StructPin => pin !== null)
        : [];
    const integrityProfileId = value.integrityProfileId === null || value.integrityProfileId === undefined
        ? null
        : stringOrNull(value.integrityProfileId);
    return { id, name, pins, endian, integrityProfileId };
}

/** Normalize one per-file scope config from unknown; null when malformed. */
export function normalizeFileScopeConfig(value: unknown): FileScopeConfig | null {
    if (!isRecord(value)) { return null; }
    const labels = Array.isArray(value.labels) ? value.labels as SegmentLabel[] : [];
    const segmentNames = isRecord(value.segmentNames)
        ? value.segmentNames as Record<string, string>
        : {};
    return { labels, segmentNames, endian: isEndian(value.endian) ? value.endian : 'le' };
}

/**
 * Normalize a `.hexscope/config.json` payload from unknown.
 * Malformed entries are dropped element-wise; a non-object payload yields
 * an empty default config (safe to write back). Struct/integrity arrays are
 * assumed already normalized upstream (session normalizes before merge).
 */
export function normalizeWorkspaceConfig(value: unknown): WorkspaceConfig {
    if (!isRecord(value)) {
        return {
            schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
            structs: [],
            integrityProfiles: [],
            profiles: [],
            files: {},
        };
    }
    const structs = Array.isArray(value.structs)
        ? value.structs.filter(isRecord) as unknown as StructDef[]
        : [];
    const profiles = Array.isArray(value.profiles)
        ? value.profiles.map(normalizeFileProfile).filter((profile): profile is FileProfile => profile !== null)
        : [];
    const files: Record<string, FileScopeConfig> = {};
    if (isRecord(value.files)) {
        for (const [key, rawScope] of Object.entries(value.files)) {
            const scope = normalizeFileScopeConfig(rawScope);
            if (scope) { files[key] = scope; }
        }
    }
    return {
        schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
        structs,
        integrityProfiles: normalizeIntegrityProfiles(value.integrityProfiles),
        profiles,
        files,
    };
}

type Identity = { id: string; name: string };

function identityOf(value: { id: string; name: string }): Identity {
    return { id: value.id, name: value.name };
}

function hasIdentity(identity: Identity, seenIds: Set<string>, seenNames: Set<string>): boolean {
    return seenIds.has(identity.id) || seenNames.has(identity.name);
}

function rememberIdentity(identity: Identity, seenIds: Set<string>, seenNames: Set<string>): void {
    seenIds.add(identity.id);
    seenNames.add(identity.name);
}

/**
 * Workspace-wins, private-fills-gaps merge for the struct library.
 * Workspace definitions come first; user-global entries are appended only
 * when their id AND name are not already taken.
 */
export function mergeStructLibraries(workspace: StructDef[], globalState: StructDef[]): StructDef[] {
    const out: StructDef[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const def of [...workspace, ...globalState]) {
        if (hasIdentity(identityOf(def), seenIds, seenNames)) { continue; }
        rememberIdentity(identityOf(def), seenIds, seenNames);
        out.push(def);
    }
    return out;
}

/** Same merge rule for the shared integrity-profile library (name match is case-insensitive, mirroring profile CRUD). */
export function mergeIntegrityLibraries(workspace: IntegrityProfile[], globalState: IntegrityProfile[]): IntegrityProfile[] {
    const out: IntegrityProfile[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const profile of [...workspace, ...globalState]) {
        const identity = { id: profile.id, name: profile.name.toLocaleLowerCase() };
        if (hasIdentity(identity, seenIds, seenNames)) { continue; }
        rememberIdentity(identity, seenIds, seenNames);
        out.push(profile);
    }
    return out;
}

/** Fresh config seeded from current private data (first-open auto-migration). */
export function seedWorkspaceConfig(input: {
    structs: StructDef[];
    integrityProfiles: IntegrityProfile[];
}): WorkspaceConfig {
    return {
        schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
        structs: input.structs,
        integrityProfiles: input.integrityProfiles,
        profiles: [],
        files: {},
    };
}