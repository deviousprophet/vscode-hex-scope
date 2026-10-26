import * as assert from 'assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    COMPARE_SELECT_HINT,
    COMPARE_TWO_HINT,
    NO_BIN_PANEL_MESSAGE,
    requestBinBaseAddressChange,
    runCompare,
    selectAsFirst,
    selectedComparePair,
    stashedComparePair,
    type CompareCommandDeps,
    type SelectCompareDeps,
} from '../../extension';
import { HexEditorProvider } from '../../hexEditorProvider';
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
            'hexScope.setBinBaseAddress',
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
            ['hexScope.openInHexScope', 'hexScope.quickRepair', 'hexScope.setBinBaseAddress'],
            'navigation keeps Open with HexScope / Quick Repair / Set Raw Binary Base Address',
        );
    });

    test('raw .bin is an opt-in custom editor and a compare/open target', async () => {
        const ext = await getActivatedExtension();
        const editor = (ext.packageJSON.contributes.customEditors as Array<{ selector: Array<{ filenamePattern?: string }>; priority?: string }>)[0];
        assert.strictEqual(editor.priority, 'option', '.bin stays opt-in');
        const patterns = editor.selector.map(selector => selector.filenamePattern);
        assert.ok(patterns.includes('*.bin'), 'the custom editor selector includes *.bin');

        const menus = ext.packageJSON.contributes.menus as Record<string, MenuItem[]>;
        const binGate = /resourceExtname =~ \/\\\.bin\$\/i/;
        for (const point of ['explorer/context', 'editor/title', 'editor/title/context', 'editor/context']) {
            const host = menus[point].find(item => item.submenu === 'hexScope.actions');
            assert.ok(host, `${point} hosts the HexScope submenu`);
            assert.match(host.when ?? '', binGate, `${point} offers the submenu for .bin`);
        }
    });

    test('open and all three compare commands allow .bin', async () => {
        const ext = await getActivatedExtension();
        const binGate = /resourceExtname =~ \/\\\.bin\$\/i/;
        for (const command of ['hexScope.openInHexScope', 'hexScope.selectAsFirst', 'hexScope.compareToStaged', 'hexScope.compareSelected']) {
            const item = submenuItems(ext).find(entry => entry.command === command);
            assert.ok(item, `${command} is contributed`);
            assert.match(item.when ?? '', binGate, `${command} allows .bin`);
        }
    });

    test('quick repair stays text-only and never offers .bin', async () => {
        const ext = await getActivatedExtension();
        const binGate = /resourceExtname =~ \/\\\.bin\$\/i/;
        const quickRepair = submenuItems(ext).find(entry => entry.command === 'hexScope.quickRepair');
        assert.ok(quickRepair, 'quick repair is contributed');
        assert.ok(!binGate.test(quickRepair.when ?? ''), 'quick repair stays text-only');
        assert.match(quickRepair.when ?? '', /resourceLangId =~ \/\^\(intel-hex\|srec\)\$\//);
    });

    test('setBinBaseAddress is contributed for .bin inside the HexScope editor only', async () => {
        const ext = await getActivatedExtension();
        const commands = ext.packageJSON.contributes.commands as Array<{ command: string; title: string; category?: string }>;
        const entry = commands.find(command => command.command === 'hexScope.setBinBaseAddress');
        assert.ok(entry, 'the command is contributed');
        assert.strictEqual(entry.title, 'Set Raw Binary Base Address');
        assert.strictEqual(entry.category, 'HexScope');

        const item = submenuItems(ext).find(menuItem => menuItem.command === 'hexScope.setBinBaseAddress');
        assert.ok(item, 'the submenu item is contributed');
        assert.match(item.when ?? '', /resourceExtname =~ \/\\\.bin\$\/i/, 'only raw binaries');
        assert.ok(
            (item.when ?? '').includes("activeCustomEditorId == 'hexScope.hexEditor'"),
            'only while the HexScope editor is active',
        );
    });

    test('the base-address command reports when no HexScope panel is active', () => {
        const infos: string[] = [];

        assert.strictEqual(requestBinBaseAddressChange(() => false, message => infos.push(message)), false);
        assert.deepStrictEqual(infos, [NO_BIN_PANEL_MESSAGE]);

        let delivered = 0;
        infos.length = 0;
        assert.strictEqual(requestBinBaseAddressChange(() => { delivered += 1; return true; }, message => infos.push(message)), true);
        assert.strictEqual(delivered, 1);
        assert.deepStrictEqual(infos, [], 'a delivered request needs no fallback message');
        assert.strictEqual(
            HexEditorProvider.postToActive({ type: 'requestBaseAddressChange' }),
            false,
            'no panel means no delivery',
        );
    });
});

suite('HexScope compare selection store', () => {
    // The `hexScope.hasCompareSelection` context key has no read API in the extension host, so these
    // tests assert the observable stash lifecycle and the naming helper only.
    test('stashes the pending file, then clears it', () => {
        const store = new CompareSelectionStore();
        const uri = vscode.Uri.file(path.join('fw', 'firmware.hex'));
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
    const a = vscode.Uri.file(path.join('fw', 'a.hex'));
    const b = vscode.Uri.file(path.join('fw', 'b.srec'));
    const c = vscode.Uri.file(path.join('fw', 'c.mot'));
    const binA = vscode.Uri.file(path.join('fw', 'boot.bin'));
    const binB = vscode.Uri.file(path.join('fw', 'app.BIN'));
    const unsupported = vscode.Uri.file(path.join('fw', 'notes.txt'));

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

    test('raw binaries participate in all three compare flows, including bin vs bin', async () => {
        const selected = selectedComparePair(binA, [binA, binB]);
        assert.ok(selected, 'two .bin files yield a pair');
        assert.strictEqual(selected![0].fsPath, binA.fsPath);
        assert.strictEqual(selected![1].fsPath, binB.fsPath);

        const mixed = selectedComparePair(binA, [binA, a]);
        assert.ok(mixed, 'bin vs HEX is comparable');
        assert.strictEqual(mixed![1].fsPath, a.fsPath);

        const { opened, deps } = compareDeps();
        await runCompare(selected, COMPARE_TWO_HINT, deps);
        assert.strictEqual(opened.length, 1);

        const stashed = stashedComparePair({ uri: binA, name: 'boot.bin' }, binB);
        assert.ok(stashed, 'a stashed raw image pairs with a clicked raw image');
        assert.strictEqual(stashed![0].fsPath, binA.fsPath);
        assert.strictEqual(stashed![1].fsPath, binB.fsPath);

        const { stashed: selectionStash, deps: selectDepsValue } = selectDeps();
        assert.strictEqual(selectAsFirst(binA, selectDepsValue), true, 'a raw image can be set as the 1st file');
        assert.deepStrictEqual(selectionStash, [binA]);
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
