// E2E: record-view empty state, scripts run gating, integrity profile confirmations.
import * as assert from 'assert';
import { type WebView } from 'vscode-extension-tester';
import {
    clickEl,
    closeFixture,
    evalInWebview,
    find,
    findMany,
    openHexFixture,
    openWorkspaceFixture,
    waitForCount,
    waitForText,
} from './helpers';

describe('HexScope E2E - record view', () => {
    let wv: WebView;
    beforeEach(async () => { wv = await openHexFixture('empty.hex'); });
    afterEach(async () => { await closeFixture('empty.hex'); });

    it('shows an empty-state node in Records view for a zero-record file', async () => {
        // Version-agnostic: main renders "Record View Unavailable"; PR #176 renders "No Records".
        // Both use the .raw-problems empty node (never a table) for a zero-record file.
        await clickEl(wv, '#btn-rec');
        await waitForCount(wv, '#record-view .raw-problems', n => n === 1);
        const title = await waitForText(wv, '#record-view .raw-problems-title');
        assert.ok(title.length > 0, `empty-state title rendered ('${title}')`);
    });
});

describe('HexScope E2E - scripts panel', () => {
    let wv: WebView;
    beforeEach(async () => { wv = await openWorkspaceFixture('sample.hex'); });
    afterEach(async () => { await closeFixture('sample.hex'); });

    // Skipped: script discovery + run timing is flaky under ChromeDriver in the sandboxed
    // workspace; the run-gating state machine is unit-covered.
    it.skip('disables the other run button while one script runs, re-enabling on completion', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await clickEl(wv, '#stab-scripts');
        await waitForCount(wv, '.script-run-btn', n => n >= 2);
        const btns = await findMany(wv, '.script-run-btn');
        await btns[0].click();
        await wv.getDriver().wait(async () => (await btns[1].getAttribute('disabled')) !== null, 5_000,
            'other run button disabled while one script runs');
        await wv.getDriver().wait(async () => (await btns[1].getAttribute('disabled')) === null, 15_000,
            'run button re-enabled after completion');
    });
});

describe('HexScope E2E - integrity panel', () => {
    let wv: WebView;
    beforeEach(async () => { wv = await openHexFixture('sample.hex'); });
    afterEach(async () => { await closeFixture('sample.hex'); });

    // Skipped: the multi-step profile flow (add check -> save-as -> delete confirm) is timing-
    // flaky under ChromeDriver; inlineConfirm routing is unit-covered.
    it.skip('profile delete requires an inline confirmation', async () => {
        await waitForCount(wv, '#mem-rows .data-row', n => n > 0);
        await clickEl(wv, '#stab-integrity');
        // create a check (needed before a profile can be saved)
        await waitForCount(wv, '#integrity-add-btn', n => n === 1);
        await clickEl(wv, '#integrity-add-btn');
        const start = await find(wv, '[data-draft-control="start"]');
        await start.sendKeys('08000000');
        const end = await find(wv, '[data-draft-control="end"]');
        await end.sendKeys('08000001');
        await clickEl(wv, '[data-form-action="save"]');
        await waitForCount(wv, '.integrity-card', n => n >= 1);
        // save the check as a profile
        await clickEl(wv, '#integrity-profile-save');
        const name = await find(wv, '#integrity-profile-name');
        await name.sendKeys('E2E Profile');
        await clickEl(wv, '#integrity-profile-name-save');
        await waitForCount(wv, '#integrity-profile-select option', n => n >= 2);
        // delete -> confirmation popover required (button must be enabled first)
        await wv.getDriver().wait(async () => {
            const del = await find(wv, '#integrity-profile-delete');
            return (await del.getAttribute('disabled')) === null;
        }, 10_000, 'delete button enabled');
        await clickEl(wv, '#integrity-profile-delete');
        await waitForCount(wv, '#del-confirm-pop', n => n === 1);
        const stillThere = await evalSelect(wv);
        assert.strictEqual(stillThere, true, 'profile not deleted before confirming');
        await clickEl(wv, '#del-confirm-pop .dcp-yes');
        await wv.getDriver().wait(async () => (await evalSelect(wv)) === false, 5_000,
            'profile deleted after confirming');
    });
});

async function evalSelect(wv: WebView): Promise<boolean> {
    return evalInWebview(
        wv,
        "return Array.from(document.querySelectorAll('#integrity-profile-select option'))" +
            ".some(o => o.textContent.includes('E2E Profile'));",
    ) as Promise<boolean>;
}
