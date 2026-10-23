import * as assert from 'assert';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    CREATE_SCRIPT_COMMAND,
    DUPLICATE_NAME_HINT,
    JS_VERSION_MISSING_TARGET,
    MANAGE_SCRIPTS_COMMAND,
    SCRIPTS_DIR_DISPLAY,
    UNTRUSTED_CREATE_MESSAGE,
    UNTRUSTED_DELETE_MESSAGE,
    buildManagerItems,
    createJsVersion,
    createScriptFromTemplate,
    deleteConfirmMessage,
    deleteScriptFile,
    duplicateMessage,
    jsVersionBody,
    jsVersionPath,
    openScriptsFolder,
    requestCreateScript,
    runDeleteScript,
    runManagePermissions,
    runManageScripts,
    runPanelDeleteScript,
    validateScriptFileName,
    type DeleteScriptDeps,
    type JsVersionDeps,
    type ManagePermissionsDeps,
    type ManageScriptsDeps,
    type ManagerItem,
    type PanelDeleteDeps,
    type PermissionItem,
    type ScriptCreateDeps,
    type ScriptsFolderDeps,
} from '../../manageScripts';
import { NO_WORKSPACE_MESSAGE } from '../../addExampleScripts';
import { SCRIPT_TEMPLATES, scriptTemplate, type ScriptTemplateId } from '../../core/scripting/templates';
import { scanScripts } from '../../core/scripting/scriptRunner';
import type { ScriptInfo } from '../../core/scripting/types';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const ACTION: ScriptInfo = {
    name: 'hello.js',
    filePath: 'D:\\ws\\.hexscope\\scripts\\hello.js',
    capabilities: [],
    roles: [],
    fingerprint: 'a',
    hasRun: true,
};
const PROVIDER: ScriptInfo = {
    name: 'follow-pointer.js',
    filePath: 'D:\\ws\\.hexscope\\scripts\\follow-pointer.js',
    capabilities: [],
    roles: ['address'],
    fingerprint: 'p',
    hasRun: false,
};
const BOTH: ScriptInfo = {
    name: 'checksum-both.js',
    filePath: 'D:\\ws\\.hexscope\\scripts\\checksum-both.js',
    capabilities: [],
    roles: ['integrity'],
    fingerprint: 'b',
    hasRun: true,
};
const UNKNOWN: ScriptInfo = {
    name: 'mystery.js',
    filePath: 'D:\\ws\\.hexscope\\scripts\\mystery.js',
    capabilities: [],
    roles: [],
    fingerprint: 'u',
    hasRun: false,
};

type CreateCapture = {
    warnings: string[];
    infos: string[];
    opened: string[];
    promptedNames: string[];
    pickedFrom: string[];
};

function tempRoot(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hexscope-manage-scripts-'));
}

function makeCreateDeps(
    root: string | null,
    options: { trusted?: boolean; name?: string; cancel?: boolean; pick?: ScriptTemplateId } = {},
): { deps: ScriptCreateDeps; captured: CreateCapture } {
    const captured: CreateCapture = { warnings: [], infos: [], opened: [], promptedNames: [], pickedFrom: [] };
    const deps: ScriptCreateDeps = {
        trusted: options.trusted ?? true,
        root,
        warn: message => { captured.warnings.push(message); },
        info: message => { captured.infos.push(message); },
        promptName: async template => {
            captured.promptedNames.push(template.fileName);
            if (options.cancel) { return undefined; }
            return options.name ?? template.fileName;
        },
        pickTemplate: async templates => {
            captured.pickedFrom.push(templates.map(template => template.id).join(','));
            return options.pick;
        },
        openFile: async filePath => { captured.opened.push(filePath); },
    };
    return { deps, captured };
}

function scriptPath(root: string, name: string): string {
    return path.join(root, SCRIPTS_DIR_DISPLAY, name);
}

suite('manage scripts file-name validation', () => {

    test('rejects names that cannot become one plain script file', () => {
        const invalid = ['', '   ', '.', '..', 'sub/x.js', 'sub\\x.js', 'script', 'script.txt', 'script.js.bak'];
        for (const name of invalid) {
            assert.ok(validateScriptFileName(name) !== null, `"${name}" must be rejected`);
        }
    });

    test('accepts .js and .ts file names (trimmed)', () => {
        const valid = ['new-action.js', 'NEW.JS', 'integrity.ts', ' my script.js ', 'array-size-from-header.js'];
        for (const name of valid) {
            assert.strictEqual(validateScriptFileName(name), null, `"${name}" must be accepted`);
        }
    });
});

suite('manage scripts create flow', () => {

    test('creating from a template writes the body, opens it, and reports it', async () => {
        const root = tempRoot();
        try {
            const { deps, captured } = makeCreateDeps(root);
            const template = scriptTemplate('integrity')!;
            const created = await createScriptFromTemplate(deps, template);

            const target = scriptPath(root, 'integrity-check.js');
            assert.strictEqual(created, target);
            assert.strictEqual(fs.readFileSync(target, 'utf-8'), template.body);
            assert.deepStrictEqual(captured.opened, [target], 'the new file opens in the editor');
            assert.deepStrictEqual(captured.infos, [`HexScope: created integrity-check.js in ${SCRIPTS_DIR_DISPLAY}.`]);
            assert.deepStrictEqual(captured.warnings, []);
            assert.deepStrictEqual(captured.promptedNames, ['integrity-check.js'], 'the suggested name prefills');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('an existing file is refused with a clear message and never overwritten', async () => {
        const root = tempRoot();
        try {
            const target = scriptPath(root, 'integrity-check.js');
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, '// my own script\n', 'utf-8');

            const { deps, captured } = makeCreateDeps(root);
            const created = await createScriptFromTemplate(deps, scriptTemplate('integrity')!);

            assert.strictEqual(created, null);
            assert.strictEqual(fs.readFileSync(target, 'utf-8'), '// my own script\n');
            assert.deepStrictEqual(captured.warnings, [duplicateMessage('integrity-check.js')]);
            assert.ok(captured.warnings[0].includes('already exists'), 'the message says the file exists');
            assert.ok(captured.warnings[0].endsWith(DUPLICATE_NAME_HINT));
            assert.deepStrictEqual(captured.opened, []);
            assert.deepStrictEqual(captured.infos, []);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('an untrusted workspace refuses before touching the disk', async () => {
        const root = tempRoot();
        try {
            const { deps, captured } = makeCreateDeps(root, { trusted: false });
            assert.strictEqual(await createScriptFromTemplate(deps, scriptTemplate('action')!), null);
            assert.deepStrictEqual(captured.warnings, [UNTRUSTED_CREATE_MESSAGE]);
            assert.ok(!fs.existsSync(path.join(root, '.hexscope')), 'nothing was created');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('a missing root is reported instead of guessed', async () => {
        const { deps, captured } = makeCreateDeps(null);
        assert.strictEqual(await createScriptFromTemplate(deps, scriptTemplate('action')!), null);
        assert.deepStrictEqual(captured.warnings, [NO_WORKSPACE_MESSAGE]);
    });

    test('an invalid typed name is refused before any write', async () => {
        const root = tempRoot();
        try {
            const { deps, captured } = makeCreateDeps(root, { name: 'sub/evil.js' });
            assert.strictEqual(await createScriptFromTemplate(deps, scriptTemplate('action')!), null);
            assert.deepStrictEqual(captured.warnings, ['HexScope: Use a plain file name without folders.']);
            assert.ok(!fs.existsSync(path.join(root, '.hexscope')), 'nothing was created');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('cancelling the name prompt writes nothing', async () => {
        const root = tempRoot();
        try {
            const { deps, captured } = makeCreateDeps(root, { cancel: true });
            assert.strictEqual(await createScriptFromTemplate(deps, scriptTemplate('action')!), null);
            assert.deepStrictEqual(captured.warnings, []);
            assert.ok(!fs.existsSync(path.join(root, '.hexscope')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('requestCreateScript creates the named template and picks when none is given', async () => {
        const root = tempRoot();
        try {
            const named = makeCreateDeps(root, { name: 'chosen.js' });
            assert.ok(await requestCreateScript(named.deps, 'size'));
            assert.strictEqual(fs.readFileSync(scriptPath(root, 'chosen.js'), 'utf-8'), scriptTemplate('size')!.body);
            assert.deepStrictEqual(named.captured.pickedFrom, [], 'a named template never opens the picker');

            const picked = makeCreateDeps(root, { name: 'picked.js', pick: 'address' });
            assert.ok(await requestCreateScript(picked.deps));
            assert.deepStrictEqual(picked.captured.pickedFrom, ['action,integrity,address,size']);
            assert.strictEqual(fs.readFileSync(scriptPath(root, 'picked.js'), 'utf-8'), scriptTemplate('address')!.body);

            const cancelled = makeCreateDeps(root);
            assert.strictEqual(await requestCreateScript(cancelled.deps), null, 'dismissed picker creates nothing');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('creating all four templates produces scripts the scanner classifies', async () => {
        const root = tempRoot();
        try {
            const { deps } = makeCreateDeps(root);
            for (const template of SCRIPT_TEMPLATES) {
                deps.promptName = async () => template.fileName;
                assert.ok(await createScriptFromTemplate(deps, template));
            }
            const scripts = scanScripts(root);
            assert.deepStrictEqual(scripts.map(script => script.name).sort(),
                SCRIPT_TEMPLATES.map(template => template.fileName).sort());
            const roles = (name: string) => scripts.find(script => script.name === name)?.roles;
            assert.deepStrictEqual(roles('integrity-check.js'), ['integrity']);
            assert.deepStrictEqual(roles('instance-address.js'), ['address']);
            assert.deepStrictEqual(roles('array-size.js'), ['size']);
            assert.strictEqual(scripts.find(script => script.name === 'new-action.js')?.hasRun, true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

suite('manage scripts folder reveal', () => {

    function makeFolderDeps(root: string | null, trusted = true): { deps: ScriptsFolderDeps; warned: string[]; revealed: string[] } {
        const warned: string[] = [];
        const revealed: string[] = [];
        return {
            deps: { root, trusted, warn: message => { warned.push(message); }, reveal: async dir => { revealed.push(dir); } },
            warned,
            revealed,
        };
    }

    test('a trusted workspace creates the scripts folder before revealing it', async () => {
        const root = tempRoot();
        try {
            const { deps, warned, revealed } = makeFolderDeps(root);
            await openScriptsFolder(deps);
            assert.ok(fs.existsSync(path.join(root, SCRIPTS_DIR_DISPLAY)));
            assert.deepStrictEqual(revealed, [path.join(root, SCRIPTS_DIR_DISPLAY)]);
            assert.deepStrictEqual(warned, []);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('an untrusted workspace reveals without creating anything', async () => {
        const root = tempRoot();
        try {
            const { deps, revealed } = makeFolderDeps(root, false);
            await openScriptsFolder(deps);
            assert.ok(!fs.existsSync(path.join(root, '.hexscope')));
            assert.deepStrictEqual(revealed, [path.join(root, SCRIPTS_DIR_DISPLAY)]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('a missing root warns instead of revealing a guessed path', async () => {
        const { deps, warned, revealed } = makeFolderDeps(null);
        await openScriptsFolder(deps);
        assert.deepStrictEqual(warned, [NO_WORKSPACE_MESSAGE]);
        assert.deepStrictEqual(revealed, []);
    });
});

suite('manage scripts QuickPick items', () => {

    const FIXED_ITEM_IDS = [
        'new-action', 'new-integrity', 'new-address', 'new-size',
        'browse-examples', 'add-all-examples', 'manage-permissions', 'open-scripts-folder',
    ];

    test('a workspace with no scripts still offers every creation and workspace action', () => {
        const items = buildManagerItems([]);
        assert.deepStrictEqual(items.map(item => item.id), FIXED_ITEM_IDS);
        assert.ok(!items.some(item => item.separator), 'no empty group headers');
        assert.ok(!items.some(item => item.id === 'reveal-script'), 'no reveal row without scripts to reveal');
        assert.ok(!items.some(item => item.id === 'delete-script'), 'no delete row without scripts to delete');
        assert.deepStrictEqual(
            items.filter(item => item.template).map(item => item.template),
            ['action', 'integrity', 'address', 'size'],
        );
    });

    test('actions come first, then role-only providers, each alphabetical', () => {
        const items = buildManagerItems([PROVIDER, UNKNOWN, ACTION, BOTH]);
        assert.deepStrictEqual(items.map(item => item.label), [
            'Actions',
            'checksum-both.js',
            'hello.js',
            'mystery.js',
            'Providers',
            'follow-pointer.js',
            '',
            'New action script', 'New integrity check', 'New instance address script', 'New array size script',
            'Browse examples\u2026', 'Add all examples', 'Manage permissions\u2026', 'Open scripts folder',
            'Reveal a script in Explorer\u2026', 'Delete a script\u2026',
        ]);
        const actions = items.filter(item => item.scriptPath).slice(0, 3);
        assert.deepStrictEqual(actions.map(item => item.description), ['Open', 'Open', 'Open']);
        assert.deepStrictEqual(actions.map(item => item.scriptPath), [BOTH.filePath, ACTION.filePath, UNKNOWN.filePath]);
    });

    test('each script row is dispatchable by its absolute path', () => {
        const items = buildManagerItems([ACTION]);
        const row = items.find(item => item.label === 'hello.js')!;
        assert.strictEqual(row.id, `script:${ACTION.filePath}`);
        assert.strictEqual(row.scriptPath, ACTION.filePath);
        assert.strictEqual(row.detail, ACTION.filePath, 'the full path stays available on hover');
    });
});

suite('manage scripts dispatch', () => {

    type DispatchCapture = {
        created: string[];
        opened: string[];
        folder: string[];
        revealed: string[];
        addAll: number;
        browse: number;
        permissions: number;
        deletes: number;
        scanned: number;
    };

    function makeManagerDeps(item: ManagerItem | undefined): { deps: ManageScriptsDeps; captured: DispatchCapture } {
        const captured: DispatchCapture = { created: [], opened: [], folder: [], revealed: [], addAll: 0, browse: 0, permissions: 0, deletes: 0, scanned: 0 };
        const deps: ManageScriptsDeps = {
            scanScripts: () => { captured.scanned++; return [ACTION]; },
            pick: async () => item,
            create: async template => { captured.created.push(template.id); return null; },
            addAllExamples: async () => { captured.addAll++; },
            browseExamples: async () => { captured.browse++; },
            managePermissions: async () => { captured.permissions++; },
            deleteScript: async () => { captured.deletes++; },
            openFolder: async dir => { captured.folder.push(dir); },
            openFile: async filePath => { captured.opened.push(filePath); },
            revealScript: async filePath => { captured.revealed.push(filePath); },
            scriptsDir: path.join('D:\\ws', SCRIPTS_DIR_DISPLAY),
        };
        return { deps, captured };
    }

    test('a template row creates that template', async () => {
        const { deps, captured } = makeManagerDeps({ id: 'new-integrity', label: 'New integrity check', template: 'integrity' });
        await runManageScripts(deps);
        assert.deepStrictEqual(captured.created, ['integrity']);
        assert.deepStrictEqual(captured.opened, [], 'creating is not opening');
    });

    test('a script row opens the file instead of running it', async () => {
        const { deps, captured } = makeManagerDeps({
            id: `script:${ACTION.filePath}`, label: 'hello.js', description: 'Open', scriptPath: ACTION.filePath,
        });
        await runManageScripts(deps);
        assert.deepStrictEqual(captured.opened, [ACTION.filePath]);
        assert.strictEqual(captured.scanned, 1, 'the list comes from one scan');
    });

    test('the workspace rows dispatch to their flows', async () => {
        const cases: Array<[ManagerItem, keyof DispatchCapture]> = [
            [{ id: 'add-all-examples', label: 'Add all examples' }, 'addAll'],
            [{ id: 'browse-examples', label: 'Browse examples' }, 'browse'],
            [{ id: 'manage-permissions', label: 'Manage permissions' }, 'permissions'],
            [{ id: 'delete-script', label: 'Delete a script\u2026' }, 'deletes'],
        ];
        for (const [item, key] of cases) {
            const { deps, captured } = makeManagerDeps(item);
            await runManageScripts(deps);
            assert.strictEqual(captured[key], 1, `${item.id} dispatched`);
        }
        const folder = makeManagerDeps({ id: 'open-scripts-folder', label: 'Open scripts folder' });
        await runManageScripts(folder.deps);
        assert.deepStrictEqual(folder.captured.folder, [path.join('D:\\ws', SCRIPTS_DIR_DISPLAY)]);
    });

    test('a dismissed picker runs nothing', async () => {
        const { deps, captured } = makeManagerDeps(undefined);
        await runManageScripts(deps);
        assert.deepStrictEqual(captured, {
            created: [], opened: [], folder: [], revealed: [], addAll: 0, browse: 0, permissions: 0, deletes: 0, scanned: 1,
        });
    });

    test('the reveal row picks a script from the same list and reveals it in Explorer', async () => {
        const { deps, captured } = makeManagerDeps(undefined);
        const scriptRow: ManagerItem = {
            id: `script:${ACTION.filePath}`, label: 'hello.js', description: 'Open', scriptPath: ACTION.filePath,
        };
        const seen: ManagerItem[][] = [];
        let call = 0;
        deps.pick = async items => {
            seen.push([...items]);
            return call++ === 0 ? { id: 'reveal-script', label: 'Reveal a script in Explorer\u2026' } : scriptRow;
        };
        await runManageScripts(deps);
        assert.deepStrictEqual(captured.revealed, [ACTION.filePath]);
        assert.ok(seen[1].length > 0 && seen[1].every(item => item.scriptPath), 'the second pick lists only script rows');

        const dismissed = makeManagerDeps(undefined);
        let calls = 0;
        dismissed.deps.pick = async () => (calls++ === 0 ? { id: 'reveal-script', label: 'Reveal' } : undefined);
        await runManageScripts(dismissed.deps);
        assert.deepStrictEqual(dismissed.captured.revealed, [], 'dismissing the script pick reveals nothing');
    });
});

suite('manage scripts delete flow', () => {

    type DeleteCapture = {
        warnings: string[];
        infos: string[];
        confirmed: string[];
        unlinked: string[];
        revoked: string[];
        rescans: number;
        picks: ManagerItem[][];
    };

    function makePanelDeleteDeps(options: {
        trusted?: boolean;
        confirm?: boolean;
        unlink?: (filePath: string) => 'deleted' | 'missing' | string;
    } = {}): { deps: PanelDeleteDeps; captured: DeleteCapture } {
        const captured: DeleteCapture = { warnings: [], infos: [], confirmed: [], unlinked: [], revoked: [], rescans: 0, picks: [] };
        const deps: PanelDeleteDeps = {
            trusted: options.trusted ?? true,
            confirm: async name => { captured.confirmed.push(name); return options.confirm ?? true; },
            deleteFile: filePath => {
                captured.unlinked.push(filePath);
                return options.unlink ? options.unlink(filePath) : deleteScriptFile(filePath);
            },
            revokeGrants: filePath => { captured.revoked.push(filePath); },
            warn: message => { captured.warnings.push(message); },
            info: message => { captured.infos.push(message); },
            rescan: async () => { captured.rescans++; },
        };
        return { deps, captured };
    }

    function makeManagerDeleteDeps(
        scripts: ScriptInfo[],
        picks: Array<ManagerItem | undefined>,
        options: { trusted?: boolean; confirm?: boolean } = {},
    ): { deps: DeleteScriptDeps; captured: DeleteCapture } {
        const { deps, captured } = makePanelDeleteDeps(options);
        let call = 0;
        return {
            deps: {
                ...deps,
                scanScripts: () => [...scripts],
                pick: async items => { captured.picks.push([...items]); return picks[call++]; },
            },
            captured,
        };
    }

    function writeScript(root: string, name: string, body = '// hi\n'): string {
        const filePath = scriptPath(root, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body, 'utf-8');
        return filePath;
    }

    test('deleteScriptFile unlinks a file; an already-gone path is the missing outcome', () => {
        const root = tempRoot();
        try {
            const target = writeScript(root, 'hello.js');
            assert.strictEqual(deleteScriptFile(target), 'deleted');
            assert.ok(!fs.existsSync(target), 'the file is gone');
            assert.strictEqual(deleteScriptFile(target), 'missing', 'ENOENT is reported as already gone');

            const dir = path.join(root, 'not-a-file');
            fs.mkdirSync(dir);
            const failure = deleteScriptFile(dir);
            assert.ok(failure !== 'deleted' && failure !== 'missing', 'other errors surface the raw message');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('an accepted confirm deletes the file, revokes its grants, and reports it', async () => {
        const root = tempRoot();
        try {
            const target = writeScript(root, 'hello.js');
            const { deps, captured } = makePanelDeleteDeps();
            assert.strictEqual(await runPanelDeleteScript(target, deps), true);
            assert.ok(!fs.existsSync(target), 'the file is gone');
            assert.strictEqual(captured.rescans, 1, 'the panel rescans after a deletion');
            assert.deepStrictEqual(captured.confirmed, ['hello.js']);
            assert.deepStrictEqual(captured.revoked, [target]);
            assert.deepStrictEqual(captured.warnings, []);
            assert.deepStrictEqual(captured.infos, [`HexScope: deleted hello.js from ${SCRIPTS_DIR_DISPLAY}.`]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('cancelling the confirm leaves the file, its grants, and the list untouched', async () => {
        const root = tempRoot();
        try {
            const target = writeScript(root, 'hello.js');
            const { deps, captured } = makePanelDeleteDeps({ confirm: false });
            assert.strictEqual(await runPanelDeleteScript(target, deps), false);
            assert.ok(fs.existsSync(target), 'the file stays');
            assert.strictEqual(captured.rescans, 0, 'a dismissed confirm rescans nothing');
            assert.deepStrictEqual(captured.unlinked, []);
            assert.deepStrictEqual(captured.revoked, []);
            assert.deepStrictEqual(captured.warnings, []);
            assert.deepStrictEqual(captured.infos, []);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('an untrusted workspace refuses before the confirm and the unlink', async () => {
        const { deps, captured } = makePanelDeleteDeps({ trusted: false });
        assert.strictEqual(await runPanelDeleteScript('D:\\ws\\hello.js', deps), false);
        assert.deepStrictEqual(captured.warnings, [UNTRUSTED_DELETE_MESSAGE]);
        assert.deepStrictEqual(captured.confirmed, []);
        assert.deepStrictEqual(captured.unlinked, []);
        assert.deepStrictEqual(captured.revoked, []);
        assert.strictEqual(captured.rescans, 0);
    });

    test('an already-gone file is tolerated and still gets its grants revoked', async () => {
        const root = tempRoot();
        try {
            const target = scriptPath(root, 'gone.js');
            const { deps, captured } = makePanelDeleteDeps();
            assert.strictEqual(await runPanelDeleteScript(target, deps), true);
            assert.deepStrictEqual(captured.revoked, [target]);
            assert.deepStrictEqual(captured.infos, [`HexScope: gone.js was already gone; any stored permissions were revoked.`]);
            assert.deepStrictEqual(captured.warnings, []);
            assert.strictEqual(captured.rescans, 1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('another unlink failure warns and keeps the grants', async () => {
        const { deps, captured } = makePanelDeleteDeps({ unlink: () => 'EPERM: operation not permitted' });
        assert.strictEqual(await runPanelDeleteScript('D:\\ws\\hello.js', deps), false);
        assert.deepStrictEqual(captured.warnings, ['HexScope: could not delete hello.js: EPERM: operation not permitted']);
        assert.deepStrictEqual(captured.revoked, []);
        assert.deepStrictEqual(captured.infos, []);
        assert.strictEqual(captured.rescans, 0);
    });

    test('the manager row picks a script from the same list and deletes it after the confirm', async () => {
        const root = tempRoot();
        try {
            const target = writeScript(root, 'hello.js');
            const script: ScriptInfo = { ...ACTION, name: 'hello.js', filePath: target };
            const { deps, captured } = makeManagerDeleteDeps([script], [{
                id: `script:${target}`, label: 'hello.js', description: 'Open', scriptPath: target,
            }]);
            await runDeleteScript(deps);
            assert.ok(!fs.existsSync(target), 'the picked file is gone');
            assert.ok(captured.picks[0].length > 0 && captured.picks[0].every(item => item.scriptPath), 'the row pick lists only script rows');
            assert.deepStrictEqual(captured.confirmed, ['hello.js']);
            assert.deepStrictEqual(captured.revoked, [target]);
            assert.deepStrictEqual(captured.infos, [`HexScope: deleted hello.js from ${SCRIPTS_DIR_DISPLAY}.`]);

            const dismissed = makeManagerDeleteDeps([script], [undefined]);
            await runDeleteScript(dismissed.deps);
            assert.deepStrictEqual(dismissed.captured.unlinked, [], 'dismissing the script pick deletes nothing');
            assert.deepStrictEqual(dismissed.captured.confirmed, []);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('the manager row refuses an untrusted workspace before the picker', async () => {
        const { deps, captured } = makeManagerDeleteDeps([ACTION], [undefined], { trusted: false });
        await runDeleteScript(deps);
        assert.deepStrictEqual(captured.warnings, [UNTRUSTED_DELETE_MESSAGE]);
        assert.deepStrictEqual(captured.picks, [], 'no script picker in an untrusted workspace');
        assert.deepStrictEqual(captured.confirmed, []);
    });

    test('the confirm copy names the file and the undo limit', () => {
        assert.strictEqual(
            deleteConfirmMessage('hello.js'),
            `hello.js will be deleted from ${SCRIPTS_DIR_DISPLAY}. This cannot be undone.`,
        );
    });
});

suite('manage permissions flow', () => {

    const GRANTS = [
        { scriptPath: 'D:/ws/.hexscope/scripts/hello.js', capability: 'write' as const, scope: 'workspace' as const },
        { scriptPath: '*', capability: '*' as const, scope: 'session' as const },
    ];

    function makePermissionDeps(item: PermissionItem | undefined): {
        deps: ManagePermissionsDeps;
        revoked: string[];
        infos: string[];
        picked: PermissionItem[][];
    } {
        const revoked: string[] = [];
        const infos: string[] = [];
        const picked: PermissionItem[][] = [];
        const deps: ManagePermissionsDeps = {
            listGrants: () => [...GRANTS],
            pick: async items => { picked.push([...items]); return item; },
            revoke: grant => { revoked.push(`${grant.scope}:${grant.scriptPath}:${grant.capability}`); },
            info: message => { infos.push(message); },
        };
        return { deps, revoked, infos, picked };
    }

    test('an empty grant list reports a hint instead of opening a dead picker', async () => {
        const { deps, revoked, infos, picked } = makePermissionDeps(undefined);
        deps.listGrants = () => [];
        await runManagePermissions(deps);
        assert.deepStrictEqual(infos, ['HexScope: no stored script permissions.']);
        assert.deepStrictEqual(picked, []);
        assert.deepStrictEqual(revoked, []);
    });

    test('every stored grant is listed with its scope and capability', async () => {
        const { deps, picked } = makePermissionDeps(undefined);
        await runManagePermissions(deps);
        assert.strictEqual(picked.length, 1);
        assert.deepStrictEqual(picked[0].map(item => item.label), ['hello.js \u00b7 write', 'All scripts \u00b7 all non-exec']);
        assert.deepStrictEqual(picked[0].map(item => item.description), ['Workspace', 'This session']);
        assert.strictEqual(picked[0][0].detail, GRANTS[0].scriptPath);
        assert.match(picked[0][1].detail, /until VS Code restarts/);
    });

    test('picking a grant revokes it; dismissing revokes nothing', async () => {
        const picked = makePermissionDeps(undefined);
        const item = { label: 'hello.js \u00b7 write', description: 'Workspace', detail: GRANTS[0].scriptPath, grant: GRANTS[0] };
        picked.deps.pick = async items => { picked.picked.push([...items]); return item; };
        await runManagePermissions(picked.deps);
        assert.deepStrictEqual(picked.revoked, [`workspace:${GRANTS[0].scriptPath}:write`]);
        assert.deepStrictEqual(picked.infos, ['HexScope: revoked hello.js \u00b7 write.']);

        const dismissed = makePermissionDeps(undefined);
        await runManagePermissions(dismissed.deps);
        assert.deepStrictEqual(dismissed.revoked, []);
        assert.deepStrictEqual(dismissed.infos, []);
    });
});

suite('manage scripts commands', () => {

    test('package.json contributes Manage Scripts and New Script', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
            contributes: { commands: Array<{ command: string; title: string; category: string }> };
        };
        const expected: ReadonlyArray<[string, string]> = [
            [MANAGE_SCRIPTS_COMMAND, 'Manage Scripts'],
            [CREATE_SCRIPT_COMMAND, 'New Script'],
        ];
        for (const [command, title] of expected) {
            const entry = pkg.contributes.commands.find(item => item.command === command);
            assert.ok(entry, `${command} is contributed`);
            assert.strictEqual(entry.title, title);
            assert.strictEqual(entry.category, 'HexScope');
        }
    });

    test('both commands are registered with VS Code', async () => {
        const ext = vscode.extensions.all.find(entry => entry.id.includes('vscode-hex-scope'));
        assert.ok(ext, 'HexScope extension is present');
        if (ext && !ext.isActive) { await ext.activate(); }
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(MANAGE_SCRIPTS_COMMAND), 'hexScope.manageScripts is registered');
        assert.ok(commands.includes(CREATE_SCRIPT_COMMAND), 'hexScope.createScript is registered');
    });
});

suite('manage scripts TypeScript to JavaScript version', () => {

    type JsCapture = { warnings: string[]; infos: string[]; opened: string[] };

    function makeJsDeps(options: { trusted?: boolean } = {}): { deps: JsVersionDeps; captured: JsCapture } {
        const captured: JsCapture = { warnings: [], infos: [], opened: [] };
        const deps: JsVersionDeps = {
            trusted: options.trusted ?? true,
            warn: message => { captured.warnings.push(message); },
            info: message => { captured.infos.push(message); },
            openFile: async filePath => { captured.opened.push(filePath); },
        };
        return { deps, captured };
    }

    function writeTs(root: string, body: string): string {
        const dir = path.join(root, SCRIPTS_DIR_DISPLAY);
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, 'crc-check.ts');
        fs.writeFileSync(filePath, body, 'utf-8');
        return filePath;
    }

    test('copies the source to a .js sibling with a manual-conversion header and opens it', async () => {
        const root = tempRoot();
        try {
            const source = 'export function run(api) {\n    api.output("hi");\n}\n';
            const filePath = writeTs(root, source);
            const { deps, captured } = makeJsDeps();
            const created = await createJsVersion(filePath, deps);

            const target = filePath.replace(/\.ts$/, '.js');
            assert.strictEqual(created, target);
            const body = fs.readFileSync(target, 'utf-8');
            assert.match(body, /Created from crc-check\.ts by HexScope/);
            assert.match(body, /conversion is manual/);
            assert.ok(body.endsWith(source), 'the source is copied untouched after the header');
            assert.deepStrictEqual(captured.opened, [target], 'the new .js file opens like other creations');
            assert.match(captured.infos[0], /created crc-check\.js from crc-check\.ts/);
            assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), source, 'the source is never rewritten');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('never overwrites an existing .js sibling', async () => {
        const root = tempRoot();
        try {
            const filePath = writeTs(root, 'export function run(api) {}\n');
            const target = filePath.replace(/\.ts$/, '.js');
            fs.writeFileSync(target, '// hand-written\n', 'utf-8');
            const { deps, captured } = makeJsDeps();
            const created = await createJsVersion(filePath, deps);
            assert.strictEqual(created, null);
            assert.strictEqual(fs.readFileSync(target, 'utf-8'), '// hand-written\n', 'existing target untouched');
            assert.ok(captured.warnings[0]?.includes('already exists'), 'the refusal names the existing file');
            assert.deepStrictEqual(captured.opened, []);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('refuses an untrusted workspace before touching disk', async () => {
        const root = tempRoot();
        try {
            const filePath = writeTs(root, 'export const run = () => {};\n');
            const { deps, captured } = makeJsDeps({ trusted: false });
            assert.strictEqual(await createJsVersion(filePath, deps), null);
            assert.deepStrictEqual(captured.warnings, [UNTRUSTED_CREATE_MESSAGE]);
            assert.ok(!fs.existsSync(filePath.replace(/\.ts$/, '.js')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('a missing source refuses with the missing-target message', async () => {
        const root = tempRoot();
        try {
            const missing = path.join(root, SCRIPTS_DIR_DISPLAY, 'gone.ts');
            const { deps, captured } = makeJsDeps();
            assert.strictEqual(await createJsVersion(missing, deps), null);
            assert.deepStrictEqual(captured.warnings, [JS_VERSION_MISSING_TARGET]);
            assert.ok(!fs.existsSync(missing.replace(/\.ts$/, '.js')));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('non-.ts inputs are refused without a write', async () => {
        assert.strictEqual(jsVersionPath('D:\\ws\\.hexscope\\scripts\\hey.js'), null);
        assert.strictEqual(jsVersionPath('hey.ts'), 'hey.js');
        assert.strictEqual(jsVersionPath('HEY.TS'), 'HEY.js');
        const { deps, captured } = makeJsDeps();
        assert.strictEqual(await createJsVersion('D:\\ws\\.hexscope\\scripts\\hey.js', deps), null);
        assert.deepStrictEqual(captured.warnings, []);
        assert.deepStrictEqual(captured.opened, []);
    });

    test('jsVersionBody prefixes the header before the untouched source', () => {
        const body = jsVersionBody('x.ts', 'const a = 1;\n');
        assert.match(body, /^\/\/ Created from x\.ts by HexScope\./);
        assert.ok(body.endsWith('const a = 1;\n'));
    });
});
