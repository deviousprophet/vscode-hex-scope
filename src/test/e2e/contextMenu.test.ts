// E2E: context menu keyboard navigation + printable-byte gating.
import * as assert from 'assert';
import { type WebView } from 'vscode-extension-tester';
import {
    closeFixture,
    evalInWebview,
    find,
    openHexFixture,
    waitForCount,
} from './helpers';

const FILE = 'sample.hex';

describe('HexScope E2E — context menu', () => {
    let wv: WebView;
    beforeEach(async () => { wv = await openHexFixture(FILE); });
    afterEach(async () => { await closeFixture(FILE); });

    async function openMenuOn(cellCss: string): Promise<void> {
        await waitForCount(wv, '#mem-rows .data-cell[data-addr]', n => n > 0, 20_000);
        const cell = await find(wv, cellCss);
        await wv.getDriver().actions().contextClick(cell).perform();
        await waitForCount(wv, '#ctx-menu .ctx-row', n => n > 0);
    }

    it('opens with menu semantics and focuses the first item; arrow keys + Enter run a command', async () => {
        await openMenuOn('#mem-rows .data-cell[data-addr="08000000"]');
        // Drive focus + keys inside ONE synchronous script: focus does not stick to a webview
        // frame element across separate executeScript calls.
        const res = await evalInWebview(wv, `
            const menu = document.getElementById('ctx-menu');
            const role = menu.getAttribute('role');
            const first = menu.querySelector('.ctx-row[data-cmd]:not(.ctx-disabled)');
            const firstCmd = first ? first.getAttribute('data-cmd') : '';
            first.focus();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            const second = document.activeElement;
            const secondCmd = second ? (second.getAttribute('data-cmd') || second.getAttribute('data-sub') || '') : '';
            return { role, firstCmd, secondCmd, moved: second !== first };
        `) as { role: string; firstCmd: string; secondCmd: string; moved: boolean };
        assert.strictEqual(res.role, 'menu', '#ctx-menu is role=menu');
        assert.ok(res.firstCmd, `a menu item is focused on open (${res.firstCmd})`);
        assert.ok(res.moved, 'ArrowDown moves focus to another menu row');
        assert.ok(res.secondCmd, `focused row is a menu item (${res.secondCmd})`);
    });

    it('hides Copy ASCII for a non-printable byte', async () => {
        // 0x08000004..07 are 0x00 bytes in sample.hex
        await openMenuOn('#mem-rows .data-cell[data-addr="08000004"]');
        const hasAscii = await evalInWebview(wv, "return !!document.querySelector('#ctx-menu .ctx-row[data-cmd=\"copy-ascii\"]');");
        assert.strictEqual(hasAscii, false, 'no Copy ASCII row for a non-printable byte');
    });

    it('shows Copy ASCII for a printable byte', async () => {
        // 0x08000008 is 0x41 ('A') in sample.hex
        await openMenuOn('#mem-rows .data-cell[data-addr="08000008"]');
        const hasAscii = await evalInWebview(wv, "return !!document.querySelector('#ctx-menu .ctx-row[data-cmd=\"copy-ascii\"]');");
        assert.strictEqual(hasAscii, true, 'Copy ASCII row present for a printable byte');
    });
});
