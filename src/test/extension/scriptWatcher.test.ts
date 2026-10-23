import * as assert from 'assert';
import * as vscode from 'vscode';
import { ScriptRescanDebounce, watchScriptsDir } from '../../scriptWatcher';

type Emitters = {
    create: vscode.EventEmitter<vscode.Uri>;
    change: vscode.EventEmitter<vscode.Uri>;
    delete: vscode.EventEmitter<vscode.Uri>;
};

type Fake = {
    watcher: vscode.FileSystemWatcher;
    emit: Emitters;
    state: { disposed: boolean };
};

function fakeWatcher(): Fake {
    const emit: Emitters = {
        create: new vscode.EventEmitter<vscode.Uri>(),
        change: new vscode.EventEmitter<vscode.Uri>(),
        delete: new vscode.EventEmitter<vscode.Uri>(),
    };
    const state = { disposed: false };
    const watcher = {
        onDidCreate: emit.create.event,
        onDidChange: emit.change.event,
        onDidDelete: emit.delete.event,
        dispose: () => { state.disposed = true; },
    } as unknown as vscode.FileSystemWatcher;
    return { watcher, emit, state };
}

function uri(filePath: string): vscode.Uri {
    return vscode.Uri.file(filePath);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('script rescan debounce', () => {

    test('a burst of events coalesces into one trailing rescan', async () => {
        let rescans = 0;
        const debounce = new ScriptRescanDebounce(() => { rescans++; }, 20);
        debounce.notify();
        debounce.notify();
        debounce.notify();
        assert.strictEqual(rescans, 0, 'nothing fires before the window closes');
        await sleep(60);
        assert.strictEqual(rescans, 1, 'one rescan for the whole burst');
        debounce.notify();
        await sleep(60);
        assert.strictEqual(rescans, 2, 'a later event scans again');
        debounce.dispose();
    });

    test('dispose cancels a pending rescan', async () => {
        let rescans = 0;
        const debounce = new ScriptRescanDebounce(() => { rescans++; }, 20);
        debounce.notify();
        debounce.dispose();
        await sleep(60);
        assert.strictEqual(rescans, 0);
    });
});

suite('script watcher', () => {

    test('script events debounce into one rescan; declaration files are ignored', async () => {
        const fake = fakeWatcher();
        let rescans = 0;
        const subscription = watchScriptsDir({
            watch: () => fake.watcher,
            rescan: () => { rescans++; },
            debounceMs: 15,
        });

        fake.emit.create.fire(uri('D:\\ws\\.hexscope\\scripts\\types\\hexscope.d.ts'));
        fake.emit.create.fire(uri('D:\\ws\\.hexscope\\scripts\\readme.md'));
        fake.emit.change.fire(uri('D:\\ws\\.hexscope\\scripts\\types\\extra.d.ts'));
        await sleep(50);
        assert.strictEqual(rescans, 0, 'non-script files never trigger a rescan');

        fake.emit.create.fire(uri('D:\\ws\\.hexscope\\scripts\\hello.js'));
        fake.emit.change.fire(uri('D:\\ws\\.hexscope\\scripts\\hello.js'));
        fake.emit.delete.fire(uri('D:\\ws\\.hexscope\\scripts\\gone.ts'));
        await sleep(50);
        assert.strictEqual(rescans, 1, 'create/change/delete coalesce into one rescan');
        subscription.dispose();
    });

    test('dispose unsubscribes from the watcher and disposes it', async () => {
        const fake = fakeWatcher();
        let rescans = 0;
        const subscription = watchScriptsDir({
            watch: () => fake.watcher,
            rescan: () => { rescans++; },
            debounceMs: 15,
        });
        fake.emit.create.fire(uri('D:\\ws\\.hexscope\\scripts\\hello.js'));
        subscription.dispose();
        assert.strictEqual(fake.state.disposed, true, 'the underlying watcher is disposed');
        await sleep(50);
        assert.strictEqual(rescans, 0, 'a disposed watcher never rescans');

        fake.emit.create.fire(uri('D:\\ws\\.hexscope\\scripts\\other.js'));
        await sleep(50);
        assert.strictEqual(rescans, 0, 'listeners are gone after dispose');
    });
});
