import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    COMPARE_SELECT_HINT,
    COMPARE_TWO_HINT,
    runCompare,
    runSelectForCompare,
    selectedComparePair,
    stashedComparePair,
    type CompareCommandDeps,
    type SelectCompareDeps,
} from '../../extension';
import { CompareSelectionStore, selectionName } from '../../diff/compareSelection';
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
            'hexScope.selectForCompare',
            'hexScope.compareWithSelected',
            'hexScope.compareSelectedFiles',
            'hexScope.clearCompareSelection',
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

    test('the dialog-based compare command is gone', async () => {
        await getActivatedExtension();
        const commands = await vscode.commands.getCommands(true);
        assert.ok(!commands.includes('hexScope.compareWith'), 'hexScope.compareWith should no longer exist');
    });
});

suite('HexScope compare selection store', () => {
    // The status-bar item and the `hexScope.hasCompareSelection` context key have no read API in the
    // extension host, so these tests assert the observable stash lifecycle and the naming helper only.
    test('stashes the pending file, then clears it', () => {
        const store = new CompareSelectionStore();
        const uri = vscode.Uri.file('C:/fw/firmware.hex');
        assert.strictEqual(store.get(), null);

        store.set(uri);
        assert.strictEqual(store.get()?.name, 'firmware.hex');
        assert.strictEqual(store.get()?.uri.fsPath, uri.fsPath);

        store.clear();
        assert.strictEqual(store.get(), null);
        store.dispose();
    });

    test('selection name keeps the basename for either separator style', () => {
        for (const path of ['/fw/firmware.srec', 'C:\\fw\\firmware.srec']) {
            assert.strictEqual(selectionName(vscode.Uri.file(path)), 'firmware.srec', `basename for ${path}`);
        }
    });
});

suite('HexScope compare commands', () => {
    const a = vscode.Uri.file('C:/fw/a.hex');
    const b = vscode.Uri.file('C:/fw/b.srec');
    const c = vscode.Uri.file('C:/fw/c.mot');
    const unsupported = vscode.Uri.file('C:/fw/notes.txt');

    function compareDeps(valid = true) {
        const opened: Array<[vscode.Uri, vscode.Uri]> = [];
        const warnings: string[] = [];
        const validated: vscode.Uri[] = [];
        const deps: CompareCommandDeps = {
            validate: async uri => { validated.push(uri); return valid; },
            open: async (first, second) => { opened.push([first, second]); },
            warn: message => { warnings.push(message); },
        };
        return { opened, warnings, validated, deps };
    }

    function selectDeps() {
        const stashed: vscode.Uri[] = [];
        const warnings: string[] = [];
        const infos: string[] = [];
        const deps: SelectCompareDeps = {
            setStash: uri => { stashed.push(uri); },
            warn: message => { warnings.push(message); },
            info: message => { infos.push(message); },
        };
        return { stashed, warnings, infos, deps };
    }

    test('Compare Selected Files keeps the clicked file as A/left', async () => {
        const { opened, validated, deps } = compareDeps();
        const pair = selectedComparePair(b, [a, b]);
        assert.ok(pair, 'a two-file selection yields a pair');
        await runCompare(pair, COMPARE_TWO_HINT, deps);

        assert.strictEqual(opened.length, 1);
        assert.strictEqual(opened[0][0].fsPath, b.fsPath);
        assert.strictEqual(opened[0][1].fsPath, a.fsPath);
        assert.deepStrictEqual(validated.map(u => u.fsPath), [b.fsPath, a.fsPath], 'both sides validated in order');
    });

    test('Compare Selected Files rejects one or three selected files', () => {
        assert.strictEqual(selectedComparePair(a, [a]), undefined);
        assert.strictEqual(selectedComparePair(a, [a, b, c]), undefined);
        assert.strictEqual(selectedComparePair(a, undefined), undefined);
    });

    test('Compare Selected Files dedupes a repeated selection URI', () => {
        const pair = selectedComparePair(a, [a, b, b]);
        assert.ok(pair, 'a duplicated companion still yields one pair');
        assert.strictEqual(pair[0].fsPath, a.fsPath);
        assert.strictEqual(pair[1].fsPath, b.fsPath);
    });

    test('Compare Selected Files ignores an unsupported companion file', () => {
        assert.strictEqual(selectedComparePair(a, [a, unsupported]), undefined);
        assert.strictEqual(selectedComparePair(unsupported, [a, unsupported]), undefined);
    });

    test('an unsupported second file warns and opens nothing', async () => {
        const { opened, warnings, deps } = compareDeps();
        const openedResult = await runCompare(selectedComparePair(a, [a, unsupported]), COMPARE_TWO_HINT, deps);

        assert.strictEqual(openedResult, false);
        assert.strictEqual(opened.length, 0);
        assert.deepStrictEqual(warnings, [COMPARE_TWO_HINT]);
    });

    test('a failed validation opens nothing', async () => {
        const { opened, deps } = compareDeps(false);
        const openedResult = await runCompare(selectedComparePair(a, [a, b]), COMPARE_TWO_HINT, deps);

        assert.strictEqual(openedResult, false);
        assert.strictEqual(opened.length, 0);
    });

    test('a palette invocation without a resource warns', async () => {
        const { opened, warnings, deps } = compareDeps();
        const openedResult = await runCompare(selectedComparePair(undefined, undefined), COMPARE_TWO_HINT, deps);

        assert.strictEqual(openedResult, false);
        assert.strictEqual(opened.length, 0);
        assert.deepStrictEqual(warnings, [COMPARE_TWO_HINT]);
    });

    test('Compare Selected puts the stash first and the clicked file second', async () => {
        const { opened, deps } = compareDeps();
        let cleared = false;
        const stash = { uri: a, name: 'a.hex' };
        const pair = stashedComparePair(stash, b);
        assert.ok(pair, 'a stash plus a clicked file yields a pair');
        await runCompare(pair, COMPARE_SELECT_HINT, deps, () => { cleared = true; });

        assert.strictEqual(opened.length, 1);
        assert.strictEqual(opened[0][0].fsPath, a.fsPath);
        assert.strictEqual(opened[0][1].fsPath, b.fsPath);
        assert.strictEqual(cleared, true, 'the stash clears on a successful compare');
    });

    test('Compare Selected without a stash or resource warns', async () => {
        const { opened, warnings, deps } = compareDeps();
        assert.strictEqual(stashedComparePair(null, b), undefined);
        assert.strictEqual(stashedComparePair({ uri: a, name: 'a.hex' }, undefined), undefined);

        await runCompare(stashedComparePair(null, b), COMPARE_SELECT_HINT, deps);
        assert.strictEqual(opened.length, 0);
        assert.deepStrictEqual(warnings, [COMPARE_SELECT_HINT]);
    });

    test('Compare Selected does not clear the stash when validation fails', async () => {
        const { deps } = compareDeps(false);
        let cleared = false;
        await runCompare(stashedComparePair({ uri: a, name: 'a.hex' }, b), COMPARE_SELECT_HINT, deps, () => { cleared = true; });
        assert.strictEqual(cleared, false);
    });

    test('Select Compare stashes a supported file and names the next step', () => {
        const { stashed, warnings, infos, deps } = selectDeps();
        const result = runSelectForCompare(a, deps);

        assert.strictEqual(result, true);
        assert.deepStrictEqual(stashed, [a]);
        assert.deepStrictEqual(warnings, []);
        assert.ok(infos[0].includes('a.hex'), 'info message names the file');
        assert.ok(infos[0].includes('Compare Selected'), 'info message names the next step');
    });

    test('Select Compare warns without a supported resource', () => {
        const { stashed, warnings, deps } = selectDeps();
        assert.strictEqual(runSelectForCompare(unsupported, deps), false);
        assert.strictEqual(runSelectForCompare(undefined, deps), false);
        assert.deepStrictEqual(stashed, []);
        assert.deepStrictEqual(warnings, [COMPARE_SELECT_HINT, COMPARE_SELECT_HINT]);
    });

    test('copyText messages carry the clipboard payload', async () => {
        assert.strictEqual(diffCopyText({ type: 'copyText', text: 'DE AD' }), 'DE AD');
        assert.strictEqual(diffCopyText({ type: 'ready' }), null);
        assert.strictEqual(diffCopyText({ type: 'copyText', text: 42 }), null);
        await vscode.env.clipboard.writeText('DE AD');
        assert.strictEqual(await vscode.env.clipboard.readText(), 'DE AD');
    });
});
