// Menu + keybinding wiring tests for the diff commands (PRD R1/D20).
// Node-safe: reads package.json statically, no vscode host required.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface MenuItem { command?: string; submenu?: string; when?: string }
interface Keybinding { command: string; key: string; when?: string }

function readPackageJson(): Record<string, any> {
    const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, any>;
}

suite('package.json diff wiring', () => {
    const pkg = readPackageJson();
    const contributes = pkg.contributes as {
        submenus?: Array<{ id: string }>;
        menus?: Record<string, MenuItem[]>;
        keybindings?: Keybinding[];
    };

    test('hexScope.actions submenu is declared', () => {
        const submenu = (contributes.submenus ?? []).find(s => s.id === 'hexScope.actions');
        assert.ok(submenu, 'hexScope.actions submenu must be declared in contributes.submenus');
    });

    test('Compare Selected is reachable from the explorer context menu', () => {
        const submenuItems = (contributes.menus?.['hexScope.actions'] ?? []);
        const hasCompare = submenuItems.some(i => i.command === 'hexScope.compareSelected');
        assert.ok(
            hasCompare,
            'hexScope.compareSelected must be in the hexScope.actions submenu (shown via explorer/context)'
        );
    });

    test('bare Alt+Down/Up is reserved for diff navigation', () => {
        const keybindings = contributes.keybindings ?? [];
        const staging = new Set(['hexScope.selectAsFirst', 'hexScope.compareToStaged']);
        // Parse the chord: modifiers + the key. Bare "alt+down" (no ctrl/shift/meta)
        // would collide with diff-view navigation; ctrl+alt is fine.
        const conflicts = keybindings.filter(k => {
            if (!staging.has(k.command)) { return false; }
            const parts = k.key.toLowerCase().split('+').map(p => p.trim());
            const modifiers = parts.slice(0, -1);
            const key = parts[parts.length - 1];
            return modifiers.length === 1 && modifiers[0] === 'alt' && /^(arrow)?(down|up)$/.test(key);
        });
        assert.deepStrictEqual(
            conflicts,
            [],
            `bare Alt+Down/Up must be reserved for diff navigation; found ${JSON.stringify(conflicts)}`
        );
    });
});
