import * as assert from 'assert';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    ADD_EXAMPLE_SCRIPTS_COMMAND,
    NO_WORKSPACE_MESSAGE,
    OPEN_SCRIPTING_GUIDE,
    OPEN_SCRIPTS_FOLDER,
    UNTRUSTED_MESSAGE,
    runAddExampleScripts,
    type AddExamplesDeps,
} from '../../addExampleScripts';
import { EXAMPLE_INSTALL_FILES } from '../../core/scripting/examples';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLES_ROOT = path.join(REPO_ROOT, 'examples');
const INSTALLED_TARGETS = EXAMPLE_INSTALL_FILES.map(file => file.target);

type Captured = {
    warnings: string[];
    infos: Array<{ message: string; actions: readonly string[] }>;
    folders: string[];
    guides: number;
};

function tempRoot(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'hexscope-add-examples-'));
}

function makeDeps(
    targetRoot: string | null,
    options: { trusted?: boolean; action?: string; catalogRoot?: string } = {},
): { deps: AddExamplesDeps; captured: Captured } {
    const captured: Captured = { warnings: [], infos: [], folders: [], guides: 0 };
    const deps: AddExamplesDeps = {
        trusted: options.trusted ?? true,
        catalogRoot: options.catalogRoot ?? EXAMPLES_ROOT,
        targetRoot,
        warn: message => { captured.warnings.push(message); },
        info: async (message, actions) => {
            captured.infos.push({ message, actions });
            return options.action;
        },
        openFolder: async dir => { captured.folders.push(dir); },
        openGuide: async () => { captured.guides++; },
    };
    return { deps, captured };
}

function installedFile(root: string, target: string): string {
    return path.join(root, ...target.split('/'));
}

function catalogFile(source: string): string {
    return path.join(EXAMPLES_ROOT, ...source.split('/'));
}

function relativeCatalogFiles(): string[] {
    return fs.readdirSync(EXAMPLES_ROOT, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => fs.statSync(path.join(EXAMPLES_ROOT, ...entry.split('/'))).isFile())
        .sort();
}

suite('add example scripts', () => {

test('a fresh install writes the five scripts plus the type definition', async () => {
    const root = tempRoot();
    try {
        const { deps, captured } = makeDeps(root);
        const result = await runAddExampleScripts(deps);

        assert.deepStrictEqual(result, { added: INSTALLED_TARGETS, skipped: [] });
        for (const file of EXAMPLE_INSTALL_FILES) {
            const target = installedFile(root, file.target);
            assert.ok(fs.existsSync(target), `${file.target} was written`);
            assert.strictEqual(fs.readFileSync(target, 'utf-8'), fs.readFileSync(catalogFile(file.source), 'utf-8'));
        }
        assert.ok(fs.existsSync(path.join(root, '.hexscope', 'scripts', 'types', 'hexscope.d.ts')));
        assert.deepStrictEqual(captured.warnings, []);
        assert.deepStrictEqual(captured.infos, [{
            message: 'Added 6 example files, skipped 0 existing files.',
            actions: [OPEN_SCRIPTS_FOLDER, OPEN_SCRIPTING_GUIDE],
        }]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a second install skips every file and changes nothing', async () => {
    const root = tempRoot();
    try {
        await runAddExampleScripts(makeDeps(root).deps);
        const before = INSTALLED_TARGETS.map(target => ({
            target,
            content: fs.readFileSync(installedFile(root, target), 'utf-8'),
            mtime: fs.statSync(installedFile(root, target)).mtimeMs,
        }));

        const { deps, captured } = makeDeps(root);
        const result = await runAddExampleScripts(deps);
        assert.deepStrictEqual(result, { added: [], skipped: INSTALLED_TARGETS });
        assert.strictEqual(captured.infos[0].message, 'Added 0 example files, skipped 6 existing files.');
        for (const snapshot of before) {
            const target = installedFile(root, snapshot.target);
            assert.strictEqual(fs.readFileSync(target, 'utf-8'), snapshot.content);
            assert.strictEqual(fs.statSync(target).mtimeMs, snapshot.mtime, `${snapshot.target} was not rewritten`);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('existing files are preserved while the missing ones are added', async () => {
    const root = tempRoot();
    try {
        const existing = installedFile(root, '.hexscope/scripts/verify-crc.js');
        fs.mkdirSync(path.dirname(existing), { recursive: true });
        fs.writeFileSync(existing, '// my own script\n', 'utf-8');

        const result = await runAddExampleScripts(makeDeps(root).deps);
        assert.deepStrictEqual(result?.skipped, ['.hexscope/scripts/verify-crc.js']);
        assert.strictEqual(result?.added.length, 5);
        assert.strictEqual(fs.readFileSync(existing, 'utf-8'), '// my own script\n', 'never overwrites');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('removing an installed example leaves the catalog and the other files intact', async () => {
    const root = tempRoot();
    try {
        await runAddExampleScripts(makeDeps(root).deps);
        const removed = '.hexscope/scripts/verify-crc.js';
        fs.rmSync(installedFile(root, removed));
        assert.ok(fs.existsSync(catalogFile('scripts/verify-crc.js')), 'the bundled catalog is untouched');
        for (const target of INSTALLED_TARGETS.filter(entry => entry !== removed)) {
            assert.ok(fs.existsSync(installedFile(root, target)), `${target} is unaffected`);
        }
        const again = await runAddExampleScripts(makeDeps(root).deps);
        assert.deepStrictEqual(again?.added, [removed], 'a later install restores only the missing file');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('an untrusted workspace is refused before touching the disk', async () => {
    const root = tempRoot();
    try {
        const { deps, captured } = makeDeps(root, { trusted: false });
        assert.strictEqual(await runAddExampleScripts(deps), null);
        assert.deepStrictEqual(captured.warnings, [UNTRUSTED_MESSAGE]);
        assert.deepStrictEqual(captured.infos, []);
        assert.ok(!fs.existsSync(path.join(root, '.hexscope')), 'nothing was created');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a missing workspace root is reported instead of guessed', async () => {
    const { deps, captured } = makeDeps(null);
    assert.strictEqual(await runAddExampleScripts(deps), null);
    assert.deepStrictEqual(captured.warnings, [NO_WORKSPACE_MESSAGE]);
});

test('the result message actions open the scripts folder or the guide', async () => {
    const cases: Array<{ action: string | undefined; folder: boolean; guide: boolean }> = [
        { action: OPEN_SCRIPTS_FOLDER, folder: true, guide: false },
        { action: OPEN_SCRIPTING_GUIDE, folder: false, guide: true },
        { action: undefined, folder: false, guide: false },
    ];
    for (const scenario of cases) {
        const root = tempRoot();
        try {
            const { deps, captured } = makeDeps(root, { action: scenario.action });
            await runAddExampleScripts(deps);
            assert.deepStrictEqual(captured.folders, scenario.folder ? [path.join(root, '.hexscope', 'scripts')] : []);
            assert.strictEqual(captured.guides, scenario.guide ? 1 : 0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

test('a broken catalog is reported, never silently skipped', async () => {
    const emptyCatalog = tempRoot();
    const target = tempRoot();
    try {
        const { deps, captured } = makeDeps(target, { catalogRoot: emptyCatalog });
        assert.strictEqual(await runAddExampleScripts(deps), null);
        assert.strictEqual(captured.warnings.length, 1);
        assert.match(captured.warnings[0], /could not add the example scripts: Example catalog file is missing/);
        assert.ok(!fs.existsSync(path.join(target, '.hexscope')), 'nothing was written from a broken catalog');
    } finally {
        fs.rmSync(emptyCatalog, { recursive: true, force: true });
        fs.rmSync(target, { recursive: true, force: true });
    }
});

});

suite('add example scripts packaging', () => {

/** Minimal vsce/npm-ignore matcher: last matching rule wins, `!` re-includes. */
function globToRegExp(glob: string): RegExp {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const pattern = escaped
        .replace(/\*\*\//g, '\u0001')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0001/g, '(?:.*/)?')
        .replace(/\u0000/g, '.*');
    return new RegExp(`^${pattern}$`);
}

function isPackaged(rules: readonly string[], relPath: string): boolean {
    const matched = rules.filter(rule => globToRegExp(rule.replace(/^!/, '')).test(relPath));
    const last = matched[matched.length - 1];
    return last === undefined || last.startsWith('!');
}

test('every catalog file survives the VSIX ignore rules', () => {
    const rules = fs.readFileSync(path.join(REPO_ROOT, '.vscodeignore'), 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
    for (const file of relativeCatalogFiles()) {
        assert.ok(isPackaged(rules, `examples/${file}`), `examples/${file} must be packaged in the VSIX`);
    }
});

test('the ignore rules still drop the rest of the TypeScript sources', () => {
    const rules = fs.readFileSync(path.join(REPO_ROOT, '.vscodeignore'), 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
    assert.strictEqual(isPackaged(rules, 'src/core/scripting/examples.ts'), false);
    assert.strictEqual(isPackaged(rules, 'tsconfig.json'), false);
});

});

suite('add example scripts command', () => {

test('package.json contributes the command and gates examples in pretest', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
        contributes: { commands: Array<{ command: string; title: string; category: string }> };
        scripts: Record<string, string>;
    };
    const command = pkg.contributes.commands.find(entry => entry.command === ADD_EXAMPLE_SCRIPTS_COMMAND);
    assert.ok(command, 'the command is contributed');
    assert.strictEqual(command?.title, 'Add Example Scripts');
    assert.strictEqual(command?.category, 'HexScope');
    assert.strictEqual(pkg.scripts['check-examples'], 'tsc -p examples/tsconfig.json --noEmit');
    assert.match(pkg.scripts.pretest, /check-examples/);
});

test('the command is registered with VS Code', async () => {
    const ext = vscode.extensions.all.find(entry => entry.id.includes('vscode-hex-scope'));
    assert.ok(ext, 'HexScope extension is present');
    if (ext && !ext.isActive) { await ext.activate(); }
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(ADD_EXAMPLE_SCRIPTS_COMMAND), 'hexScope.addExampleScripts is registered');
});

// The test host launches with trust enabled (.vscode-test.mjs uses
// --disable-workspace-trust), so the refusal path is covered deterministically by
// the injected `runAddExampleScripts` test above rather than end to end here.

});
