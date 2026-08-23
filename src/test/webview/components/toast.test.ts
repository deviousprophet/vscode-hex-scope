import { strict as assert } from 'node:assert';
import { JSDOM } from 'jsdom';
import { suite, test, setup, teardown } from 'mocha';
import { showToast } from '../../../webview/components/toast';

type Globalish = { window: Window; document: Document; getComputedStyle: typeof getComputedStyle };

suite('webview toast', () => {
    let dom: JSDOM;

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://hexscope.test/' });
        const g = globalThis as unknown as Globalish;
        g.window = dom.window as unknown as Window;
        g.document = dom.window.document as unknown as Document;
        g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    });

    teardown(() => {
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
    });

    test('renders the exact message, role=status, top-center fallback without coords', () => {
        showToast('Copied ✓');
        const toast = document.querySelector<HTMLElement>('.sb-toast')!;
        assert.ok(toast, 'toast element exists');
        assert.strictEqual(toast.textContent, 'Copied ✓', 'message is the passed text');
        assert.strictEqual(toast.getAttribute('role'), 'status');
        assert.strictEqual(toast.getAttribute('aria-live'), 'polite');
        assert.ok(toast.classList.contains('sb-toast-visible'));
        assert.ok(toast.classList.contains('sb-toast--top-center'), 'no coords → top-center fallback');
    });

    test('positions near the click point when coords are given', () => {
        showToast('Copied ✓', { x: 100, y: 100 });
        const toast = document.querySelector<HTMLElement>('.sb-toast')!;
        assert.ok(toast.classList.contains('sb-toast--near'), 'near-click placement');
        assert.ok(!toast.classList.contains('sb-toast--top-center'));
        assert.strictEqual(toast.style.left, '100px');
        assert.strictEqual(toast.style.top, '100px');
    });

    test('clamps the toast inside the webview viewport', () => {
        showToast('Copied ✓', { x: 10000, y: 10000 });
        const toast = document.querySelector<HTMLElement>('.sb-toast')!;
        const maxX = dom.window.innerWidth - 120 - 8;
        const maxY = dom.window.innerHeight - 24 - 8;
        assert.strictEqual(toast.style.left, `${maxX}px`, 'clamped to the right edge');
        assert.strictEqual(toast.style.top, `${maxY}px`, 'clamped to the bottom edge');
    });

    test('rapid calls replace the toast (single element, latest text)', () => {
        showToast('first');
        showToast('Copied ✓');
        showToast('last');
        const toasts = document.querySelectorAll<HTMLElement>('.sb-toast');
        assert.strictEqual(toasts.length, 1, 'never stacks toasts');
        assert.strictEqual(toasts[0].textContent, 'last', 'latest message wins');
    });

    test('auto-hides after the lifecycle', async () => {
        showToast('Copied ✓');
        const toast = document.querySelector<HTMLElement>('.sb-toast')!;
        assert.ok(!toast.hidden);
        await new Promise(resolve => setTimeout(resolve, 1500));
        assert.ok(toast.hidden, 'toast fades away after ~1.4s');
    });

    test('auto-hide timer does not throw after the window closes (teardown race)', async () => {
        showToast('Copied ✓');
        dom.window.close();
        await new Promise(resolve => setTimeout(resolve, 1500));
        assert.ok(true);
    });
});