// Menu + keybinding wiring tests for the diff commands (PRD R1/D20).
// Node-safe: reads package.json statically, no vscode host required.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface MenuItem { command?: string; submenu?: string; when?: string }
interface Keybinding { command: string; key: string; when?: string }
interface CommandDef { command: string; title: string }
type Contributes = {
    submenus?: Array<{ id: string }>;
    menus?: Record<string, MenuItem[]>;
    keybindings?: Keybinding[];
};

function readPackageJson(): Record<string, any> {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, any>;
}

function isNavKey(key: string): boolean {
    return /^(arrow)?(down|up)$/.test(key);
}

function isBareAltNav(k: Keybinding, staging: ReadonlySet<string>): boolean {
    if (!staging.has(k.command)) { return false; }
    const parts = k.key.toLowerCase().split('+').map(p => p.trim());
    const modifiers = parts.slice(0, -1);
    const key = parts[parts.length - 1];
    return modifiers.length === 1 && modifiers[0] === 'alt' && isNavKey(key);
}

function explorerContextSubmenus(contributes: Contributes): MenuItem[] {
    return contributes.menus?.['explorer/context'] ?? [];
}

function submenuWhenFor(contributes: Contributes): string {
    const item = explorerContextSubmenus(contributes).find(i => i.submenu === 'hexScope.actions');
    return item?.when ?? '';
}

function multiSelectHidden(items: ReadonlyMap<string | undefined, string>): boolean {
    return items.get('hexScope.selectAsFirst')?.includes('!listMultiSelection') ?? false;
}

function stagedCompareAllowed(items: ReadonlyMap<string | undefined, string>): boolean {
    const stagedWhen = items.get('hexScope.compareToStaged') ?? '';
    return stagedWhen.includes('hasStagedFirst') && stagedWhen.includes('!listMultiSelection');
}

suite('package.json diff wiring', () => {
    const pkg = readPackageJson();
    const contributes = pkg.contributes as Contributes;

    test('hexScope.actions submenu is declared', () => {
        const submenu = (contributes.submenus ?? []).find(s => s.id === 'hexScope.actions');
        assert.ok(submenu, 'hexScope.actions submenu must be declared in contributes.submenus');
    });

    test('Compare Selected is inside the HexScope submenu, gated to exactly 2 selected', () => {
        const submenuItems = (contributes.menus?.['hexScope.actions'] ?? []);
        const compare = submenuItems.find(i => i.command === 'hexScope.compareSelected');
        assert.ok(compare, 'hexScope.compareSelected must live in the hexScope.actions submenu');
        assert.ok(
            compare!.when?.includes('listDoubleSelection'),
            'Compare Two Files must require exactly 2 selected (listDoubleSelection)'
        );
    });

    test('context menu switches: Compare only on 2 selected, staging only on single select', () => {
        const items = new Map(
            (contributes.menus?.['hexScope.actions'] ?? []).map(i => [i.command, i.when ?? ''])
        );
        assert.ok(
            submenuWhenFor(contributes).includes('resourceLangId'),
            'the HexScope submenu must show for hex/srec files'
        );
        assert.ok(
            multiSelectHidden(items),
            'Set as 1st file must be hidden on multi-select (!listMultiSelection)'
        );
        assert.ok(
            stagedCompareAllowed(items),
            'Compare with the 1st file requires staged state and single select'
        );
    });

    test('diff command titles match the agreed wording', () => {
        const titles = new Map(
            (pkg.contributes as { commands: CommandDef[] }).commands.map(c => [c.command, c.title])
        );
        assert.strictEqual(titles.get('hexScope.compareSelected'), 'Compare Two Files');
        assert.strictEqual(titles.get('hexScope.selectAsFirst'), 'Set as 1st file to compare');
        assert.strictEqual(titles.get('hexScope.compareToStaged'), 'Compare with the 1st file');
    });

    test('bare Alt+Down/Up is reserved for diff navigation', () => {
        const keybindings = contributes.keybindings ?? [];
        const staging = new Set(['hexScope.selectAsFirst', 'hexScope.compareToStaged']);
        // Parse the chord: modifiers + the key. Bare "alt+down" (no ctrl/shift/meta)
        // would collide with diff-view navigation; ctrl+alt is fine.
        const conflicts = keybindings.filter(k => isBareAltNav(k, staging));
        assert.deepStrictEqual(
            conflicts,
            [],
            `bare Alt+Down/Up must be reserved for diff navigation; found ${JSON.stringify(conflicts)}`
        );
    });
});
