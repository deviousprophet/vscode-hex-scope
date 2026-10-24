import * as assert from 'assert';

import {
    deriveScriptUsages,
    type ScriptUsageInput,
} from '../../../../../webview/components/sidebar/scriptsPanel/scriptUsages';

const VERIFY_FILE = 'D:\\ws\\.hexscope\\scripts\\verify.js';
const FOLLOW_FILE = 'D:\\ws\\.hexscope\\scripts\\follow.js';
const SIZE_FILE = 'D:\\ws\\.hexscope\\scripts\\size-from-header.js';

const SCRIPTS = [
    { filePath: VERIFY_FILE, relativePath: '.hexscope/scripts/verify.js' },
    { filePath: FOLLOW_FILE, relativePath: '.hexscope/scripts/follow.js' },
    { filePath: SIZE_FILE, relativePath: '.hexscope/scripts/size-from-header.js' },
];

function input(partial: Partial<ScriptUsageInput> = {}): ScriptUsageInput {
    return { checks: [], pins: [], scripts: SCRIPTS, ...partial };
}

suite('script usage derivation', () => {
    test('a workspace-relative check path resolves to the scanned card identity', () => {
        const usages = deriveScriptUsages(input({
            checks: [{ checkId: 3, scriptPath: '.hexscope/scripts/verify.js', label: 'Flash CRC' }],
        }));
        assert.deepStrictEqual(usages, [{
            scriptPath: VERIFY_FILE,
            kind: 'integrity',
            label: 'Flash CRC',
            checkId: 3,
        }]);
    });

    test('an absolute check path matches too; casing falls back to a lenient match', () => {
        const absolute = deriveScriptUsages(input({
            checks: [{ checkId: 1, scriptPath: 'D:/ws/.hexscope/scripts/verify.js', label: 'Absolute' }],
        }));
        assert.strictEqual(absolute[0]?.scriptPath, VERIFY_FILE, 'forward-slash absolute path resolves');

        const lenient = deriveScriptUsages(input({
            checks: [{ checkId: 2, scriptPath: '.HEXSCOPE/Scripts/Verify.js', label: 'Cased' }],
        }));
        assert.strictEqual(lenient[0]?.scriptPath, VERIFY_FILE, 'case-only differences still match');
    });

    test('an unresolved check keeps its configured path (no card match, nothing dropped)', () => {
        const usages = deriveScriptUsages(input({
            checks: [{ checkId: 9, scriptPath: '.hexscope/scripts/deleted.js', label: 'Gone' }],
        }));
        assert.deepStrictEqual(usages, [{
            scriptPath: '.hexscope/scripts/deleted.js',
            kind: 'integrity',
            label: 'Gone',
            checkId: 9,
        }]);
        assert.deepStrictEqual(deriveScriptUsages(input({ checks: [{ checkId: 1, scriptPath: '   ', label: 'Blank' }] })), []);
    });

    test('instance address and parameter sources become address/size usages', () => {
        const usages = deriveScriptUsages(input({
            pins: [
                {
                    id: 'pin-1',
                    name: 'boot header',
                    addressSource: { scriptPath: '.hexscope/scripts/follow.js' },
                    paramSources: { count: { scriptPath: '.hexscope/scripts/size-from-header.js' } },
                },
            ],
        }));
        assert.deepStrictEqual(usages, [
            { scriptPath: FOLLOW_FILE, kind: 'address', label: 'boot header', pinId: 'pin-1' },
            { scriptPath: SIZE_FILE, kind: 'size', label: 'boot header \u00b7 count', pinId: 'pin-1' },
        ]);
    });

    test('a manual paramValues entry wins over the script source; blank sources are skipped', () => {
        const withManual = deriveScriptUsages(input({
            pins: [{
                id: 'pin-2',
                name: 'table',
                paramSources: {
                    overridden: { scriptPath: '.hexscope/scripts/size-from-header.js' },
                    live: { scriptPath: '.hexscope/scripts/size-from-header.js' },
                    blank: { scriptPath: '   ' },
                },
                paramValues: { overridden: 4 },
            }],
        }));
        assert.deepStrictEqual(withManual.map(usage => usage.label), ['table \u00b7 live'], 'only the script-resolved parameter is a usage');
        assert.deepStrictEqual(deriveScriptUsages(input({
            pins: [{ id: 'pin-3', name: 'fixed', addressSource: { scriptPath: ' ' } }],
        })), [], 'blank address sources derive nothing');
    });

    test('checks precede instances and stored order is preserved', () => {
        const usages = deriveScriptUsages(input({
            checks: [
                { checkId: 1, scriptPath: '.hexscope/scripts/verify.js', label: 'First' },
                { checkId: 2, scriptPath: '.hexscope/scripts/verify.js', label: 'Second' },
            ],
            pins: [
                { id: 'a', name: 'alpha', addressSource: { scriptPath: '.hexscope/scripts/follow.js' } },
                { id: 'b', name: 'beta', addressSource: { scriptPath: '.hexscope/scripts/follow.js' } },
            ],
        }));
        assert.deepStrictEqual(usages.map(usage => usage.label), ['First', 'Second', 'alpha', 'beta']);
    });

    test('no checks, no pins, or no scanned scripts derive an empty list', () => {
        assert.deepStrictEqual(deriveScriptUsages(input()), []);
        assert.deepStrictEqual(deriveScriptUsages({ checks: [], pins: [], scripts: [] }), []);
    });
});
