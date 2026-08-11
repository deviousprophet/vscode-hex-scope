// E2E: memory view render, search + divergence, edit/undo, paste overflow, grid keyboard.
import * as assert from 'assert';
import { Key } from 'selenium-webdriver';
import { type WebView } from 'vscode-extension-tester';
import {
    clickEl,
    closeFixture,
    evalInWebview,
    find,
    focusGrid,
    openHexFixture,
    selectedAddress,
    sendKeys,
    waitForCount,
    waitForText,
} from './helpers';

const FILE = 'sample.hex';

describe('HexScope E2E - memory view, search, edit', () => {
    let wv: WebView;
    beforeEach(async () => { wv = await openHexFixture(FILE); });
    afterEach(async () => { await closeFixture(FILE); });

    it('renders the memory grid with a header and data rows', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        const header = await find(wv, '#mem-header');
        assert.ok((await header.getText()).length > 0, 'header rendered');
        const match = await evalInWebview(wv, "return document.querySelectorAll('#mem-rows .data-cell[data-addr]').length > 0;");
        assert.strictEqual(match, true, 'address cells rendered');
    });

    it('runs a bytes search and highlights matches', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await (await find(wv, '#search-input')).sendKeys('DE AD');
        await sendKeys(wv, Key.ENTER);
        await waitForText(wv, '#match-count');
        await waitForCount(wv, '#mem-rows .data-cell.match', n => n > 0);
    });

    it('clears stale matches when the query or mode diverges', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await (await find(wv, '#search-input')).sendKeys('DE AD');
        await sendKeys(wv, Key.ENTER);
        await waitForCount(wv, '#mem-rows .data-cell.match', n => n > 0);
        // Empty the input (frame-scoped) -> divergence invalidation clears stale matches.
        await evalInWebview(wv, "const i = document.getElementById('search-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));");
        await waitForCount(wv, '#mem-rows .data-cell.match', n => n === 0);
        const count = await (await find(wv, '#match-count')).getText();
        assert.strictEqual(count, '', 'count cleared with an empty query');
    });

    // Skipped: real keystrokes to the webview frame don't reliably reach the capture-phase edit
    // handler under ChromeDriver (only work when an explicit focusable element is focused, which
    // a selected cell is not). The edit/undo flow is covered by the unit suite.
    it.skip('edit mode: typing a byte dirties, Ctrl+Z undoes', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await clickEl(wv, '#btn-edit-mode');
        // Select the first byte with a frame-scoped mousedown, then type real keys (grid-arrows path works).
        await evalInWebview(wv, "document.querySelector('#mem-rows .data-cell[data-addr]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));");
        const selCount = await evalInWebview(wv, "return document.querySelectorAll('#mem-rows .data-cell.sel').length;") as number;
        assert.ok(selCount > 0, 'cell selected before typing');
        await sendKeys(wv, 'A');
        await sendKeys(wv, 'A');
        await waitForText(wv, '#edit-dirty-count');
        const dirty = await (await find(wv, '#edit-dirty-count')).getText();
        assert.match(dirty, /unsaved byte/, `dirty count after edit ('${dirty}')`);
        await sendKeys(wv, Key.chord(Key.CONTROL, 'z'));
        await waitForText(wv, '#edit-dirty-count'); // now empty after undo
        assert.strictEqual(await (await find(wv, '#edit-dirty-count')).getText(), '', 'dirty cleared after undo');
    });

    // Clipboard paste is not reliably grantable under ChromeDriver in VS Code webviews, so the
    // paste-overflow flow is covered by unit tests (pasteOverflowNotice + Toolbar.setStatus).
    it.skip('paste past the last mapped byte shows a status notice', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await clickEl(wv, '#btn-edit-mode');
        await evalInWebview(wv, "navigator.clipboard.writeText('AA BB CC')");
        const last = await find(wv, '#mem-rows .data-cell[data-addr="0800000F"]');
        await last.click();
        await evalInWebview(wv, "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }));");
        const status = await waitForText(wv, '#edit-status');
        assert.match(status, /Pasted 1 of 3 bytes/, `paste notice ('${status}')`);
    });

    // Skipped: grid keyboard selection relies on webview-frame focus + real keystrokes, which
    // is unreliable under ChromeDriver; walkMappedAddress + the focus gate are unit-covered.
    it.skip('grid arrow keys move selection (focus-gated) and Shift extends then shrinks', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await focusGrid(wv);
        await sendKeys(wv, Key.ARROW_RIGHT);
        await waitForCount(wv, '#mem-rows .data-cell.sel', n => n === 1);
        const first = await selectedAddress(wv);
        assert.strictEqual(first, '08000000', 'first arrow lands on the first mapped byte');
        await sendKeys(wv, Key.ARROW_RIGHT);
        assert.strictEqual(await selectedAddress(wv), '08000001', 'second arrow moves one byte');
        await sendKeys(wv, Key.SHIFT, Key.ARROW_RIGHT);
        await waitForCount(wv, '#mem-rows .data-cell.sel', n => n === 2);
        await sendKeys(wv, Key.SHIFT, Key.ARROW_LEFT);
        await waitForCount(wv, '#mem-rows .data-cell.sel', n => n === 1);
    });

    it('arrows do NOT move the selection when the grid is not focused', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        // focus something outside the grid, then arrow keys must be inert
        await evalInWebview(wv, "document.getElementById('btn-rec').focus();");
        await sendKeys(wv, Key.ARROW_RIGHT);
        await sendKeys(wv, Key.ARROW_RIGHT);
        const selected = await selectedAddress(wv);
        assert.strictEqual(selected, null, 'no grid selection moves without grid focus');
    });
});
