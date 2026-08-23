import * as assert from 'assert';

import {
    mergeIntegrityLibraries,
    mergeStructLibraries,
    normalizeFileProfile,
    normalizeWorkspaceConfig,
    seedWorkspaceConfig,
    WORKSPACE_CONFIG_SCHEMA_VERSION,
    type FileProfile,
} from '../../core/workspaceConfigModel';
import type { IntegrityProfile } from '../../core/integrity';
import type { StructDef } from '../../core/types';

function structDef(id: string, name: string): StructDef {
    return { id, name, fields: [{ name: 'x', type: 'uint8', count: 1 }] };
}

function profile(id: string, name: string): IntegrityProfile {
    return {
        schemaVersion: 1,
        id,
        name,
        checks: [{ algorithm: 'crc32-iso-hdlc', startAddress: 0, endAddress: 0x100, autoFixStoredValue: false }],
    };
}

function fileProfile(id: string, name: string): FileProfile {
    return { id, name, pins: [], endian: 'le', integrityProfileId: null };
}

suite('workspaceConfigModel', () => {
    test('normalizeWorkspaceConfig yields an empty default for garbage', () => {
        for (const garbage of [null, undefined, 42, 'x', [], { schemaVersion: 2 }]) {
            const config = normalizeWorkspaceConfig(garbage);
            assert.strictEqual(config.schemaVersion, WORKSPACE_CONFIG_SCHEMA_VERSION);
            assert.deepStrictEqual(config.structs, []);
            assert.deepStrictEqual(config.integrityProfiles, []);
            assert.deepStrictEqual(config.profiles, []);
            assert.deepStrictEqual(config.files, {});
        }
    });

    test('normalizeWorkspaceConfig keeps valid entries and drops malformed ones', () => {
        const config = normalizeWorkspaceConfig({
            structs: [structDef('a', 'A'), { broken: true }, structDef('b', 'B')],
            integrityProfiles: [profile('p1', 'CRC'), 'junk', profile('p2', 'SHA')],
            profiles: [fileProfile('fp1', 'Boot'), { id: '' }, fileProfile('fp2', 'App')],
            files: {
                'dir/a.hex': { labels: [], segmentNames: {}, endian: 'be' },
                'bad': null,
            },
        });

        assert.strictEqual(config.structs.length, 3, 'structs kept verbatim (normalized upstream)');
        assert.deepStrictEqual(config.integrityProfiles.map(p => p.name), ['CRC', 'SHA']);
        assert.deepStrictEqual(config.profiles.map(p => p.name), ['Boot', 'App']);
        assert.strictEqual(config.files['dir/a.hex'].endian, 'be');
        assert.strictEqual(config.files['bad'], undefined);
    });

    test('normalizeFileProfile rejects malformed pins/endian and defaults safe values', () => {
        const good = normalizeFileProfile({
            id: 'fp',
            name: 'Boot',
            pins: [{ id: 'pin1', structId: 's1', addr: 0x1000, name: 'Header' }],
            endian: 'be',
            integrityProfileId: 'crc',
        });
        assert.ok(good);
        assert.strictEqual(good!.endian, 'be');
        assert.strictEqual(good!.pins.length, 1);
        assert.strictEqual(good!.integrityProfileId, 'crc');

        const badPin = normalizeFileProfile({
            id: 'fp',
            name: 'Boot',
            pins: [{ id: '', structId: 's1', addr: -1, name: '' }],
            endian: 'magic',
        });
        assert.ok(badPin);
        assert.strictEqual(badPin!.pins.length, 0, 'malformed pins dropped');
        assert.strictEqual(badPin!.endian, 'le', 'unknown endian defaults to le');
        assert.strictEqual(badPin!.integrityProfileId, null);

        assert.strictEqual(normalizeFileProfile(null), null);
        assert.strictEqual(normalizeFileProfile({ id: '', name: '' }), null);
    });

    test('mergeStructLibraries gives workspace priority and fills gaps by id or name', () => {
        const workspace = [structDef('w1', 'Shared'), structDef('w2', 'DupName')];
        const globalState = [
            structDef('w1', 'Shared'),      // same id → workspace wins
            structDef('g1', 'DupName'),     // same name → dropped
            structDef('g2', 'Private'),
            structDef('g3', 'Private3'),
        ];
        const merged = mergeStructLibraries(workspace, globalState);

        assert.deepStrictEqual(merged.map(s => s.id), ['w1', 'w2', 'g2', 'g3']);
        assert.strictEqual(merged[0].id, 'w1', 'workspace entry first');
    });

    test('mergeStructLibraries workspace-only and global-only inputs', () => {
        assert.deepStrictEqual(mergeStructLibraries([structDef('a', 'A')], []).map(s => s.id), ['a']);
        assert.deepStrictEqual(mergeStructLibraries([], [structDef('a', 'A')]).map(s => s.id), ['a']);
        assert.deepStrictEqual(mergeStructLibraries([], []), []);
    });

    test('mergeIntegrityLibraries dedupes by id and name with workspace priority', () => {
        const workspace = [profile('p1', 'CRC32')];
        const globalState = [profile('p1', 'CRC32'), profile('p2', 'SHA256'), profile('p3', 'crc32')];
        const merged = mergeIntegrityLibraries(workspace, globalState);

        assert.deepStrictEqual(merged.map(p => p.id), ['p1', 'p2']);

        const only = mergeIntegrityLibraries([], globalState);
        assert.deepStrictEqual(only.map(p => p.id), ['p1', 'p2'], 'case-variant duplicates dropped');
    });

    test('seedWorkspaceConfig builds a fresh shareable config', () => {
        const structs = [structDef('s1', 'Shared')];
        const integrityProfiles = [profile('crc', 'CRC')];
        const config = seedWorkspaceConfig({ structs, integrityProfiles });

        assert.strictEqual(config.schemaVersion, WORKSPACE_CONFIG_SCHEMA_VERSION);
        assert.deepStrictEqual(config.structs, structs);
        assert.deepStrictEqual(config.integrityProfiles, integrityProfiles);
        assert.deepStrictEqual(config.profiles, []);
        assert.deepStrictEqual(config.files, {});
    });
});