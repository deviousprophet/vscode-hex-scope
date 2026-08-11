// ExTester E2E helpers: open a fixture in the HexScope custom editor webview and
// drive its DOM. Every spec opens its own fixture (isolated, resilient to flakes).
// The extension under test is packaged + installed by `extest setup-and-run`.

import * as assert from 'assert';
import * as path from 'path';
import {
    By,
    EditorView,
    VSBrowser,
    WebView,
    Workbench,
    type WebElement,
} from 'vscode-extension-tester';

const FIXTURES = path.resolve(process.cwd(), 'src/test/e2e/fixtures');
export const WORKSPACE = path.join(FIXTURES, 'workspace');

/** Open the E2E workspace folder (needed for the scripts-panel fixture), then a file inside it. */
export async function openWorkspaceFixture(file: string): Promise<WebView> {
    const browser = VSBrowser.instance;
    await browser.openResources(WORKSPACE);
    await browser.waitForWorkbench();
    return openHexFixture(path.join('..', 'fixtures', 'workspace', file));
}

/** Open a fixture file, then open it in the HexScope custom editor webview (active tab). */
export async function openHexFixture(name: string): Promise<WebView> {
    const browser = VSBrowser.instance;
    const abs = path.isAbsolute(name) ? name : path.join(FIXTURES, name);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            return await openFixtureOnce(browser, abs, name);
        } catch (err) {
            lastErr = err;
            await logOpenDiagnostics(err, attempt);
            await new EditorView().closeAllEditors();
        }
    }
    throw lastErr;
}

async function logOpenDiagnostics(err: unknown, attempt: number): Promise<void> {
    console.log(`[e2e] open attempt ${attempt + 1} failed: ${(err as Error).message}`);
    try {
        console.log(`[e2e] editor titles: ${JSON.stringify(await new EditorView().getOpenEditorTitles())}`);
    } catch {
        // diagnostics are best-effort
    }
}

async function openFixtureOnce(browser: VSBrowser, abs: string, name: string): Promise<WebView> {
    await browser.openResources(abs);
    await browser.waitForWorkbench();
    // The command below needs an active editor; wait until the file tab actually exists
    // (cold VS Code start under xvfb can lag behind openResources).
    await waitForEditorTab(name);
    await new Workbench().executeCommand('hexScope.openInHexScope');
    await browser.waitForWorkbench();
    const webview = new WebView();
    await webview.switchToFrame();
    return webview;
}

async function waitForEditorTab(name: string): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const titles = await new EditorView().getOpenEditorTitles();
        if (titles.some(t => t.includes(name))) { return; }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`no editor tab opened for ${name}`);
}

/** Switch back out of the webview frame and close all editor tabs. */
export async function closeFixture(_name: string): Promise<void> {
    const webview = new WebView();
    try {
        await webview.switchBack();
    } catch {
        // frame may already be detached
    }
    await new EditorView().closeAllEditors();
}

export async function find(webview: WebView, css: string): Promise<WebElement> {
    return webview.findWebElement(By.css(css));
}

/** Deterministic click on an element inside the webview (no overlay/scroll surprises). */
export async function clickEl(webview: WebView, css: string): Promise<void> {
    await webview.getDriver().executeScript(`document.querySelector(${JSON.stringify(css)}).click();`);
}

export async function findMany(webview: WebView, css: string): Promise<WebElement[]> {
    return webview.findWebElements(By.css(css));
}

/** Wait until an element's text is non-empty (with a generous timeout for webview loads). */
export async function waitForText(webview: WebView, css: string, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
        last = await readTextOrEmpty(webview, css);
        if (last) { return last; }
        await new Promise(r => setTimeout(r, 250));
    }
    assert.fail(`Timed out waiting for non-empty text at '${css}' (last '${last}')`);
}

async function readTextOrEmpty(webview: WebView, css: string): Promise<string> {
    try {
        const el = await find(webview, css);
        return await el.getText();
    } catch {
        return '';
    }
}

/** Wait until an element count satisfies the predicate. */
export async function waitForCount(
    webview: WebView,
    css: string,
    predicate: (n: number) => boolean,
    timeoutMs = 20_000,
): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    while (Date.now() < deadline) {
        try {
            last = (await findMany(webview, css)).length;
            if (predicate(last)) { return last; }
        } catch {
            // ignore
        }
        await new Promise(r => setTimeout(r, 250));
    }
    assert.fail(`Timed out waiting for count predicate at '${css}' (last ${last})`);
}

/** Send key presses to the webview's focused element (deterministic inside the frame). */
export async function sendKeys(webview: WebView, ...keys: string[]): Promise<void> {
    await webview.getDriver().switchTo().activeElement().sendKeys(...keys);
}

/** Focus the hex grid (tabindex=0) so grid-keyboard handlers are active. */
export async function focusGrid(webview: WebView): Promise<void> {
    await webview.getDriver().executeScript("document.getElementById('memory-view').focus();");
}

/** Execute a script inside the webview frame and return the result. */
export async function evalInWebview(webview: WebView, script: string): Promise<unknown> {
    return webview.getDriver().executeScript(script);
}

/** Address of the currently selected (`.sel`) hex cell, or null. */
export async function selectedAddress(webview: WebView): Promise<string | null> {
    return evalInWebview(
        webview,
        "const el = document.querySelector('#mem-rows .data-cell.sel'); return el ? el.getAttribute('data-addr') : null;",
    ) as Promise<string | null>;
}
