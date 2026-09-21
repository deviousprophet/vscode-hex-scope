import * as assert from 'assert';
import * as vscode from 'vscode';
import { resolveComparisonTarget, type ComparisonPickerDeps } from '../../extension';
import { diffCopyText } from '../../diffProtocol';

suite('HexScope Extension', () => {

    async function getActivatedExtension() {
        const ext = vscode.extensions.all.find(e => e.id.includes('vscode-hex-scope'));
        assert.ok(ext, 'HexScope extension should be present in the test instance');
        if (ext && !ext.isActive) {
            await ext.activate();
        }
        return ext!;
    }

    test('extension can be located and activated', async () => {
        const ext = await getActivatedExtension();
        assert.ok(ext.isActive, 'extension should be active after activation');
    });

    test('all HexScope commands are registered', async () => {
        await getActivatedExtension();
        const commands = await vscode.commands.getCommands(true);

        const expected = [
            'hexScope.openInHexScope',
            'hexScope.compareWith',
            'hexScope.addSegmentLabel',
            'hexScope.copyAsHexString',
            'hexScope.copyAsCArray',
            'hexScope.copyAsAscii',
            'hexScope.copyRawRecord',
            'hexScope.selectProfile',
            'hexScope.newProfile',
            'hexScope.duplicateProfile',
            'hexScope.renameProfile',
            'hexScope.deleteProfile',
        ];

        for (const cmd of expected) {
            assert.ok(commands.includes(cmd), `command "${cmd}" should be registered`);
        }
    });
});

suite('HexScope comparison picker', () => {
    const base = vscode.Uri.file('C:/fw/base.hex');
    const other = vscode.Uri.file('C:/fw/other.hex');
    const CONFIRM = 'Compare base.hex ↔ other.hex';

    function deps(confirmChoice: string | undefined, otherUri: vscode.Uri | undefined, valid = true): ComparisonPickerDeps {
        return {
            validate: async () => valid,
            chooseOther: async () => otherUri,
            confirm: async () => confirmChoice,
        };
    }

    test('Compare keeps the base file as side A', async () => {
        const result = await resolveComparisonTarget(base, deps(CONFIRM, other));
        assert.strictEqual(result?.uri.fsPath, other.fsPath);
        assert.strictEqual(result?.swap, false);
    });

    test('Swap reports the pair reversed for the panel', async () => {
        const result = await resolveComparisonTarget(base, deps('Swap', other));
        assert.strictEqual(result?.uri.fsPath, other.fsPath);
        assert.strictEqual(result?.swap, true);
    });

    test('Cancel returns no comparison target', async () => {
        assert.strictEqual(await resolveComparisonTarget(base, deps('Cancel', other)), undefined);
    });

    test('an invalid base file aborts before choosing the second file', async () => {
        let picked = false;
        const result = await resolveComparisonTarget(base, {
            validate: async () => false,
            chooseOther: async () => { picked = true; return other; },
            confirm: async () => 'Swap',
        });
        assert.strictEqual(result, undefined);
        assert.strictEqual(picked, false, 'second-file picker never opened');
    });

    test('a dismissed file picker aborts the comparison', async () => {
        assert.strictEqual(await resolveComparisonTarget(base, deps('Swap', undefined)), undefined);
    });

    test('copyText messages carry the clipboard payload', async () => {
        assert.strictEqual(diffCopyText({ type: 'copyText', text: 'DE AD' }), 'DE AD');
        assert.strictEqual(diffCopyText({ type: 'ready' }), null);
        assert.strictEqual(diffCopyText({ type: 'copyText', text: 42 }), null);
        await vscode.env.clipboard.writeText('DE AD');
        assert.strictEqual(await vscode.env.clipboard.readText(), 'DE AD');
    });
});
