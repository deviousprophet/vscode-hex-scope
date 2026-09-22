import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    COMPARE_SELECT_HINT,
    COMPARE_TWO_HINT,
    runCompare,
    selectAsFirst,
    selectedComparePair,
    stashedComparePair,
    type CompareCommandDeps,
    type SelectCompareDeps,
} from '../../extension';
import { CompareSelectionStore, selectionName } from '../../diff/compareSelection';
import { diffCopyText, diffMessageType } from '../../diffProtocol';

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
            'hexScope.selectAsFirst',
            'hexScope.compareToStaged',
            'hexScope.compareSelected',
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

    test('the dialog-based and superseded compare commands are gone', async () => {
        await getActivatedExtension();
        const commands = await vscode.commands.getCommands(true);
        for (const removed of [
            'hexScope.compareWith',
            'hexScope.selectForCompare',
            'hexScope.compareWithSelected',
            'hexScope.compareSelectedFiles',
            'hexScope.clearCompareSelection',
        ]) {
            assert.ok(!commands.includes(removed), `${removed} should no longer exist`);
        }
    });

    interface MenuItem { command?: string; submenu?: string; group?: string; when?: string }

    function submenuItems(ext: vscode.Extension<unknown>): MenuItem[] {
        return ext.packageJSON.contributes.menus['hexScope.actions'] as MenuItem[];
    }

    test('the compare group holds exactly the three commands, gated for the Explorer', async () => {
        const ext = await getActivatedExtension();
        const compare = submenuItems(ext).filter(item => item.group === '3_compare');
        const whenFor = (command: string) => compare.find(item => item.command === command)?.when ?? '';

        assert.deepStrictEqual(
            compare.map(item => item.command).sort(),
            ['hexScope.compareSelected', 'hexScope.compareToStaged', 'hexScope.selectAsFirst'],
            'only the three compare commands sit in the 3_compare group',
        );
        for (const item of compare) {
            assert.ok(
                (item.when ?? '').includes('explorerViewletFocus'),
                `${item.command} is Explorer-only, so it never reaches the editor title`,
            );
        }
        assert.ok(whenFor('hexScope.selectAsFirst').includes('!listMultiSelection'), 'one file: Set as 1st');
        assert.ok(whenFor('hexScope.compareToStaged').includes('hexScope.hasCompareSelection'), 'staged gate');
        assert.ok(whenFor('hexScope.compareSelected').includes('listDoubleSelection'), 'three files: no item');
    });

    test('no menu point outside the HexScope submenu lists a compare command', async () => {
        const ext = await getActivatedExtension();
        const compareCommands = new Set(['hexScope.selectAsFirst', 'hexScope.compareToStaged', 'hexScope.compareSelected']);
        const menus = ext.packageJSON.contributes.menus as Record<string, MenuItem[]>;

        for (const [point, items] of Object.entries(menus)) {
            const commands = items.flatMap(item => (item.command ? [item.command] : []));
            if (point === 'hexScope.actions') { continue; }
            for (const command of commands) {
                assert.ok(!compareCommands.has(command), `${command} must not be contributed at ${point}`);
            }
        }
        assert.deepStrictEqual(
            submenuItems(ext).filter(item => item.group === 'navigation').map(item => item.command).sort(),
            ['hexScope.openInHexScope', 'hexScope.quickRepair'],
            'navigation keeps only Open with HexScope / Quick Repair',
        );
    });
});

suite('HexScope compare selection store', () => {
    // The `hexScope.hasCompareSelection` context key has no read API in the extension host, so these
    // tests assert the observable stash lifecycle and the naming helper only.
    test('stashes the pending file, then clears it', () => {
        const store = new CompareSelectionStore();
        const uri = vscode.Uri.file('C:/fw/firmware.hex');
        assert.strictEqual(store.get(), null);

        store.set(uri);
        assert.strictEqual(store.get()?.name, 'firmware.hex');
        assert.strictEqual(store.get()?.uri.fsPath, uri.fsPath);

        store.clear();
        assert.strictEqual(store.get(), null);
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

    test('Compare Two Files keeps the clicked file as A/left', async () => {
        const { opened, validated, deps } = compareDeps();
        const pair = selectedComparePair(b, [a, b]);
        assert.ok(pair, 'a two-file selection yields a pair');
        await runCompare(pair, COMPARE_TWO_HINT, deps);

        assert.strictEqual(opened.length, 1);
        assert.strictEqual(opened[0][0].fsPath, b.fsPath);
        assert.strictEqual(opened[0][1].fsPath, a.fsPath);
        assert.deepStrictEqual(validated.map(u => u.fsPath), [b.fsPath, a.fsPath], 'both sides validated in order');
    });

    test('Compare Two Files rejects one or three selected files', () => {
        assert.strictEqual(selectedComparePair(a, [a]), undefined);
        assert.strictEqual(selectedComparePair(a, [a, b, c]), undefined);
        assert.strictEqual(selectedComparePair(a, undefined), undefined);
    });

    test('Compare Two Files dedupes a repeated selection URI', () => {
        const pair = selectedComparePair(a, [a, b, b]);
        assert.ok(pair, 'a duplicated companion still yields one pair');
        assert.strictEqual(pair[0].fsPath, a.fsPath);
        assert.strictEqual(pair[1].fsPath, b.fsPath);
    });

    test('Compare Two Files ignores an unsupported companion file', () => {
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

    test('Compare with the 1st file puts the stash first and the clicked file second', async () => {
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

    test('Compare with the 1st file without a stash or resource warns', async () => {
        const { opened, warnings, deps } = compareDeps();
        assert.strictEqual(stashedComparePair(null, b), undefined);
        assert.strictEqual(stashedComparePair({ uri: a, name: 'a.hex' }, undefined), undefined);

        await runCompare(stashedComparePair(null, b), COMPARE_SELECT_HINT, deps);
        assert.strictEqual(opened.length, 0);
        assert.deepStrictEqual(warnings, [COMPARE_SELECT_HINT]);
    });

    test('Compare with the 1st file does not clear the stash when validation fails', async () => {
        const { deps } = compareDeps(false);
        let cleared = false;
        await runCompare(stashedComparePair({ uri: a, name: 'a.hex' }, b), COMPARE_SELECT_HINT, deps, () => { cleared = true; });
        assert.strictEqual(cleared, false);
    });

    test('Compare with the 1st file keeps the stash when opening the panel fails', async () => {
        const deps: CompareCommandDeps = {
            validate: async () => true,
            open: async () => { throw new Error('panel failed'); },
            warn: () => { /* noop */ },
        };
        let cleared = false;
        await assert.rejects(
            runCompare(stashedComparePair({ uri: a, name: 'a.hex' }, b), COMPARE_SELECT_HINT, deps, () => { cleared = true; }),
            /panel failed/,
        );
        assert.strictEqual(cleared, false, 'a failed open must not clear the staged file');
    });

    test('Set as 1st file stashes a supported file and names the next step', () => {
        const { stashed, warnings, infos, deps } = selectDeps();
        const result = selectAsFirst(a, deps);

        assert.strictEqual(result, true);
        assert.deepStrictEqual(stashed, [a]);
        assert.deepStrictEqual(warnings, []);
        assert.ok(infos[0].includes('a.hex'), 'info message names the file');
        assert.ok(infos[0].includes('Compare with the 1st file'), 'info message names the next step');
    });

    test('Set as 1st file warns without a supported resource', () => {
        const { stashed, warnings, deps } = selectDeps();
        assert.strictEqual(selectAsFirst(unsupported, deps), false);
        assert.strictEqual(selectAsFirst(undefined, deps), false);
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

    test('diffProgress is a recognized diff provider message', () => {
        assert.strictEqual(diffMessageType({ type: 'diffProgress', stage: 'diff', completed: 1, total: 1 }), 'diffProgress');
        assert.strictEqual(diffMessageType({ type: 'diffInit' }), 'diffInit');
    });
});
