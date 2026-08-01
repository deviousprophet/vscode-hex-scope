import * as assert from 'assert';
import * as vscode from 'vscode';

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
            'hexScope.addSegmentLabel',
            'hexScope.copyAsHexString',
            'hexScope.copyAsCArray',
            'hexScope.copyAsAscii',
            'hexScope.copyRawRecord',
            // diff view commands
            'hexScope.compareSelected',
            'hexScope.selectAsFirst',
            'hexScope.compareToStaged',
        ];

        for (const cmd of expected) {
            assert.ok(commands.includes(cmd), `command "${cmd}" should be registered`);
        }
    });

    test('compareSelected opens the diff editor for two valid files', async function () {
        this.timeout(10000);
        await getActivatedExtension();
        const dir = vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', '..', '..', '..', '.tmp-diff-test');
        await vscode.workspace.fs.createDirectory(dir);

        const a = vscode.Uri.joinPath(dir, 'a.hex');
        const b = vscode.Uri.joinPath(dir, 'b.hex');
        const hex = ':100000000102030405060708090A0B0C0D0E0F1068\n:00000001FF\n';
        await vscode.workspace.fs.writeFile(a, Buffer.from(hex, 'utf8'));
        await vscode.workspace.fs.writeFile(b, Buffer.from(hex, 'utf8'));

        // selectAsFirst stages A, then compareToStaged opens the diff with the current document
        const doc = await vscode.workspace.openTextDocument(b);
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('hexScope.selectAsFirst', a);

        await vscode.commands.executeCommand('hexScope.compareToStaged');
        assert.ok(await waitForTabWithScheme('hexdiff'), 'diff editor should open after compareToStaged');
        await vscode.workspace.fs.delete(dir, { recursive: true });
    });

    /** Poll tabGroups until a tab whose input URI has `scheme` appears (max 5s). */
    async function waitForTabWithScheme(scheme: string): Promise<boolean> {
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 100));
            const hasTab = vscode.window.tabGroups.all
                .flatMap(g => g.tabs)
                .some(tab => (tab.input as any)?.uri?.scheme === scheme);
            if (hasTab) { return true; }
        }
        return false;
    }
});
