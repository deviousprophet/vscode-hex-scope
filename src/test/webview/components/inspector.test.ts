import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../css-import-hook';

import { Inspector } from '../../../webview/components/Inspector/Inspector';
import type { SegmentLabel, SerializedSegment } from '../../../core/types';

let currentDom: JSDOM | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
};

function installDom(): { dom: JSDOM; inspector: Inspector; cb: { jumps: number[]; labels: SegmentLabel[][]; copies: Array<[string, string]> } } {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as Globalish;
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    (globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame =
        () => 0;

    const bytes = new Map<number, number>([
        [0x1000, 0x12],
        [0x1001, 0x34],
    ]);
    const cb = { jumps: [] as number[], labels: [] as SegmentLabel[][], copies: [] as Array<[string, string]> };
    const inspector = new Inspector({
        readByte: addr => bytes.get(addr),
        onJumpTo: address => cb.jumps.push(address),
        onLabelsChange: labels => cb.labels.push(labels),
        onCopy: (text, label) => cb.copies.push([text, label]),
    });
    inspector.mount(document.getElementById('host')!);
    return { dom, inspector, cb };
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
    }
}

const segments: SerializedSegment[] = [
    { startAddress: 0x2000, data: [1, 2, 3, 4] },
    { startAddress: 0x1000, data: [5, 6] },
];

const labels: SegmentLabel[] = [
    { id: 'l1', name: 'Start', startAddress: 0x1000, length: 4, color: '#4fc3f7' },
];

suite('Inspector mount + sections', () => {
    let dom: JSDOM;
    let inspector: Inspector;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('renders the four section shells', () => {
        assert.ok(document.getElementById('s-insp'));
        assert.ok(document.getElementById('s-bits'));
        assert.ok(document.getElementById('s-segments'));
        assert.ok(document.getElementById('s-labels'));
        assert.strictEqual(document.getElementById('insp-vals')!.textContent?.trim(), 'Click a byte to inspect');
        assert.strictEqual(document.querySelector('#s-segments .sb-empty')?.textContent, 'No segments');
        assert.strictEqual(document.querySelector('#s-labels .sb-empty')?.textContent, 'No labels defined');
    });
});

suite('Inspector selection + endian', () => {
    let dom: JSDOM;
    let inspector: Inspector;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('single-byte selection paints hex/bin chips and bit view', () => {
        inspector.setSelection(0x1000, 0x1000);
        assert.ok(document.querySelector('#insp-vals .insp-hex-chip')?.textContent, '0x12');
        assert.ok(document.querySelector('#insp-vals .insp-bin-row'));
        assert.ok(document.querySelector('#s-bits .bit-v.on'));
    });

    test('multi-byte selection renders raw dump and multi-byte cards', () => {
        inspector.setSelection(0x1000, 0x1001);
        assert.ok(document.querySelector('#insp-vals .insp-raw-dump')?.textContent?.includes('12 34'));
        assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x3412'), 'LE uint16');
    });

    test('setEndian re-decodes the multi-byte interpreter', () => {
        inspector.setSelection(0x1000, 0x1001);
        assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x3412'));
        inspector.setEndian('be');
        assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x1234'), 'BE uint16');
    });
});

suite('Inspector segments', () => {
    let dom: JSDOM;
    let inspector: Inspector;
    let cb: { jumps: number[]; labels: SegmentLabel[][]; copies: Array<[string, string]> };

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('setSegments renders sorted rows + badge and reports jumps', () => {
        inspector.setSegments(segments);
        const items = document.querySelectorAll<HTMLElement>('.segment-item');
        assert.strictEqual(items.length, 2);
        assert.strictEqual(document.querySelector('.sb-badge')!.textContent, '2');
        assert.ok(items[0].querySelector('.segment-rng')!.textContent?.includes('0x00001000'));
        items[0].click();
        assert.deepStrictEqual(cb.jumps, [0x1000]);
    });

    test('setSegments preserves collapsed state', () => {
        inspector.setSegments([]);
        const section = document.getElementById('s-segments')!;
        section.querySelector<HTMLElement>('.sb-hdr')!.click();
        assert.ok(section.classList.contains('collapsed'));
        inspector.setSegments(segments);
        assert.ok(section.classList.contains('collapsed'), 'collapse survives re-set');
    });
});

suite('Inspector labels', () => {
    let dom: JSDOM;
    let inspector: Inspector;
    let cb: { jumps: number[]; labels: SegmentLabel[][]; copies: Array<[string, string]> };

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('setLabels renders rows + badge; row click jumps', () => {
        inspector.setLabels(labels);
        const row = document.querySelector<HTMLElement>('.label-item')!;
        assert.strictEqual(row.querySelector('.label-nm')!.textContent, 'Start');
        assert.strictEqual(document.querySelector('.sb-badge')!.textContent, '1');
        row.click();
        assert.deepStrictEqual(cb.jumps, [0x1000]);
    });

    test('delete reports onLabelsChange', async () => {
        inspector.setLabels(labels);
        document.querySelector<HTMLElement>('.act-btn-del')!.click();
        document.querySelector<HTMLElement>('#del-confirm-pop .dcp-yes')!.click();
        // Let inlineConfirm's deferred outside-click listener register before teardown.
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(cb.labels.length, 1);
        assert.deepStrictEqual(cb.labels[0], []);
    });

    test('add form saves a new label via onLabelsChange', () => {
        inspector.setLabels([]);
        document.getElementById('btn-add-lbl')!.click();
        (document.getElementById('lf-name') as HTMLInputElement).value = 'My Segment';
        (document.getElementById('lf-start') as HTMLInputElement).value = '0x1000';
        (document.getElementById('lf-range') as HTMLInputElement).value = '4';
        document.getElementById('lf-save')!.click();

        assert.strictEqual(cb.labels.length, 1);
        assert.strictEqual(cb.labels[0][0].name, 'My Segment');
        assert.strictEqual(cb.labels[0][0].startAddress, 0x1000);
        assert.strictEqual(cb.labels[0][0].length, 4);
    });

    test('add form validates and shows the warning inline', () => {
        inspector.setLabels([]);
        document.getElementById('btn-add-lbl')!.click();
        (document.getElementById('lf-name') as HTMLInputElement).value = 'My Segment';
        (document.getElementById('lf-start') as HTMLInputElement).value = 'zzz';
        (document.getElementById('lf-range') as HTMLInputElement).value = '4';
        document.getElementById('lf-save')!.click();
        assert.strictEqual(document.getElementById('lf-warn')!.textContent, 'Invalid start address.');
        assert.strictEqual(cb.labels.length, 0);
    });
});
