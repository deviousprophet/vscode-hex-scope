// E2E: context menu keyboard navigation + printable-byte gating.
import * as assert from 'assert';
import { Key } from 'selenium-webdriver';
import { type WebView } from 'vscode-extension-tester';
import {
    closeFixture,
    evalInWebview,
    find,
    openHexFixture,
    sendKeys,
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

    // Skipped: webview-frame focus does not reliably stick for keystrokes under ChromeDriver;
    // the menu keyboard nav is covered by the unit suite.
    it.skip('opens with menu semantics and focuses the first item; arrow keys move focus', async () => {
        await openMenuOn('#mem-rows .data-cell[data-addr="08000000"]');
        const firstCmd = await evalInWebview(wv, "return document.activeElement?.getAttribute('data-cmd') || '';") as string;
        assert.ok(firstCmd, `a menu item is focused on open (${firstCmd})`);
        // Real keys through the driver's active element (same path the grid-keyboard specs use).
        await sendKeys(wv, Key.ARROW_DOWN);
        const after = await evalInWebview(wv, `
            const a = document.activeElement;
            return { cmd: a ? (a.getAttribute('data-cmd') || '') : '', sub: a ? (a.getAttribute('data-sub') || '') : '', isRow: !!a && a.classList.contains('ctx-row') };
        `) as { cmd: string; sub: string; isRow: boolean };
        assert.ok(after.isRow, 'ArrowDown keeps focus inside the menu');
        assert.ok(after.cmd !== firstCmd, `ArrowDown moves focus to another row (${firstCmd} -> ${after.cmd})`);
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
