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

    test('compareSelected with a multi-select Uri[] opens the diff (first = A)', async function () {
        this.timeout(10000);
        await getActivatedExtension();
        const dir = vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', '..', '..', '..', '.tmp-diff-test');
        await vscode.workspace.fs.createDirectory(dir);

        const a = vscode.Uri.joinPath(dir, 'multi-a.hex');
        const b = vscode.Uri.joinPath(dir, 'multi-b.hex');
        const hex = ':100000000102030405060708090A0B0C0D0E0F1068\n:00000001FF\n';
        await vscode.workspace.fs.writeFile(a, Buffer.from(hex, 'utf8'));
        await vscode.workspace.fs.writeFile(b, Buffer.from(hex, 'utf8'));

        // Explorer multi-select invokes the command with an array of Uris
        await vscode.commands.executeCommand('hexScope.compareSelected', [a, b]);

        assert.ok(
            await waitForTabUriWithScheme('hexdiff', p => p.includes('multi-a.hex')),
            'diff editor should open for a two-file selection'
        );
        await vscode.workspace.fs.delete(dir, { recursive: true });
    });

    test('diff tab title shows both filenames, not the opaque pair key', async function () {
        this.timeout(10000);
        await getActivatedExtension();
        const dir = vscode.Uri.joinPath(vscode.Uri.file(__dirname), '..', '..', '..', '..', '.tmp-diff-test');
        await vscode.workspace.fs.createDirectory(dir);

        const a = vscode.Uri.joinPath(dir, 'title-a.hex');
        const b = vscode.Uri.joinPath(dir, 'title-b.hex');
        const hex = ':100000000102030405060708090A0B0C0D0E0F1068\n:00000001FF\n';
        await vscode.workspace.fs.writeFile(a, Buffer.from(hex, 'utf8'));
        await vscode.workspace.fs.writeFile(b, Buffer.from(hex, 'utf8'));

        // Use the staging path so this test isolates the tab-title defect
        const doc = await vscode.workspace.openTextDocument(b);
        await vscode.window.showTextDocument(doc);
        await vscode.commands.executeCommand('hexScope.selectAsFirst', a);
        await vscode.commands.executeCommand('hexScope.compareToStaged');

        const uri = await waitForTabUriWithScheme('hexdiff', decoded => decoded.includes('title-a.hex'));
        assert.ok(uri, 'diff editor should open after compareSelected');
        const decoded = decodeURIComponent(uri!.path);
        assert.ok(decoded.includes('title-a.hex'), `title should include A filename, got "${decoded}"`);
        assert.ok(decoded.includes('title-b.hex'), `title should include B filename, got "${decoded}"`);
        assert.ok(!/^\/[A-Za-z0-9+/=%]{8,}$/.test(uri!.path), `path must not be the opaque base64 pair key, got "${uri!.path}"`);
        await vscode.workspace.fs.delete(dir, { recursive: true });
    });

    /** Poll tabGroups until a tab whose input URI has `scheme` appears (max 5s). */
    async function waitForTabWithScheme(scheme: string): Promise<boolean> {
        return (await waitForTabUriWithScheme(scheme)) !== null;
    }

    /** Poll tabGroups and return the matching tab's input URI, or null (max 5s). */
    async function waitForTabUriWithScheme(scheme: string, match?: (decodedPath: string) => boolean): Promise<vscode.Uri | null> {
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 100));
            const uri = vscode.window.tabGroups.all
                .flatMap(g => g.tabs)
                .map(tab => (tab.input as any)?.uri as vscode.Uri | undefined)
                .find(u => u?.scheme === scheme && (!match || match(decodeURIComponent(u.path))));
            if (uri) { return uri; }
        }
        return null;
    }
});
