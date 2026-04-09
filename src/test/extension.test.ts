import * as assert from 'assert';
import * as vscode from 'vscode';

suite('HexScope Extension', () => {

    async function getActivatedExtension() {
        const ext = vscode.extensions.all.find(e => e.id.includes('hex-scope-vscode'));
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
        ];

        for (const cmd of expected) {
            assert.ok(commands.includes(cmd), `command "${cmd}" should be registered`);
        }
    });
});
