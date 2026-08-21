import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../../../cssImportHook';

import { InspectorPanel } from '../../../../../webview/components/sidebar/inspectorPanel/inspectorPanel';
import type { SegmentLabel, SerializedSegment } from '../../../../../core/types';

let currentDom: JSDOM | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
};

function installDom(): { dom: JSDOM; inspector: InspectorPanel; cb: { jumps: number[]; labels: SegmentLabel[][]; names: Array<Record<string, string> | undefined>; copies: Array<[string, string]> } } {
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
        [0x1002, 0x56],
        [0x1003, 0x78],
        [0x1004, 0x9A],
        [0x1005, 0xBC],
        [0x1006, 0xDE],
        [0x1007, 0xF0],
        [0x1008, 0x12],
    ]);
    const cb = {
        jumps: [] as number[],
        labels: [] as SegmentLabel[][],
        names: [] as Array<Record<string, string> | undefined>,
        copies: [] as Array<[string, string]>,
    };
    const inspector = new InspectorPanel({
        readByte: addr => bytes.get(addr),
        onJumpTo: address => cb.jumps.push(address),
        onLabelsChange: (labels, segmentNames) => {
            cb.labels.push(labels);
            cb.names.push(segmentNames);
        },
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
    let inspector: InspectorPanel;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('renders two sections; bits+segments folded into Inspector/Labels', () => {
        assert.ok(document.getElementById('s-insp'));
        assert.ok(document.getElementById('s-labels'));
        assert.strictEqual(document.getElementById('s-bits'), null, 'no separate Bit View section');
        assert.strictEqual(document.getElementById('s-segments'), null, 'no separate Segments section');
        assert.strictEqual(document.getElementById('insp-vals')!.textContent?.trim(), 'Click a byte to inspect');
        assert.ok(document.querySelector('#insp-bits'), 'bits block lives inside Inspector');
        assert.strictEqual(document.querySelector('#s-labels .sb-empty')?.textContent, 'No labels defined');
    });
});

suite('Inspector selection + endian', () => {
    let dom: JSDOM;
    let inspector: InspectorPanel;
    let cb: { jumps: number[]; labels: SegmentLabel[][]; names: Array<Record<string, string> | undefined>; copies: Array<[string, string]> };

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('single-byte selection paints hex/bin chips and inline bit view', () => {
        inspector.setSelection(0x1000, 0x1000);
        assert.ok(document.querySelector('#insp-vals .insp-hex-chip')?.textContent, '0x12');
        assert.ok(document.querySelector('#insp-vals .insp-bin-row'));
        assert.ok(document.querySelector('#insp-bits .bit-v.on'));
    });

    test('multi-byte selection renders byte line and multi-byte cards', () => {
        inspector.setSelection(0x1000, 0x1001);
        assert.ok(document.querySelector('#insp-vals .insp-byte-line')?.textContent?.includes('12 34'));
        assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x3412'), 'LE uint16');
    });

    test('byte line copy returns exactly rendered bytes', () => {
        inspector.setSelection(0x1000, 0x1001);
        const line = document.querySelector<HTMLElement>('.insp-byte-line')!;
        assert.strictEqual(line.dataset.copy, '12 34');
        assert.ok(!line.dataset.copy!.includes('…'));
        line.click();
        assert.deepStrictEqual(cb.copies.at(-1), ['12 34', '2 bytes']);
    });

    test('byte line truncation shows ellipsis but copies the FULL selection', () => {
        inspector.setSelection(0x1000, 0x1008); // 9 bytes → first 8 shown
        const line = document.querySelector<HTMLElement>('.insp-byte-line')!;
        const text = line.textContent!;
        assert.ok(text.includes('…'), 'ellipsis marks further bytes');
        assert.strictEqual(line.dataset.copyCount, '9', 'copy count carried for the host notification');
        assert.match(line.title, /9 bytes/, 'tooltip names the byte count');
        // Tooltip promises N bytes → copy delivers all N, not just the visible 8.
        assert.strictEqual(line.dataset.copy!.split(' ').length, 9, 'copy covers the full selection');
        assert.ok(!line.dataset.copy!.includes('…'), 'never copies silent ellipsis');
    });

    test('bits auto-expands on selection; user collapse sticks across later selections', () => {
        inspector.setSelection(0x1000, 0x1000);
        const block = document.getElementById('insp-bits')!;
        assert.ok(!block.classList.contains('collapsed'), 'fresh selection expands bits');
        block.querySelector<HTMLElement>('[data-collapse]')!.click();
        assert.ok(block.classList.contains('collapsed'));
        inspector.setSelection(0x1001, 0x1001);
        assert.ok(block.classList.contains('collapsed'), 'sticky across selections');
        assert.strictEqual(block.querySelector('[data-collapse]')!.getAttribute('aria-expanded'), 'false');
    });

    test('remount resets bits sticky collapse', () => {
        inspector.setSelection(0x1000, 0x1000);
        document.getElementById('insp-bits')!.querySelector<HTMLElement>('[data-collapse]')!.click();
        inspector.mount(document.getElementById('host')!);
        inspector.setSelection(0x1000, 0x1000);
        assert.ok(!document.getElementById('insp-bits')!.classList.contains('collapsed'), 'remount resets to expanded');
    });

    test('setEndian re-decodes the multi-byte interpreter', () => {
        inspector.setSelection(0x1000, 0x1001);
        assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x3412'));
        inspector.setEndian('be');
        assert.ok(document.querySelector('#insp-multi .mi-hex')?.textContent?.includes('0x1234'), 'BE uint16');
    });
});

suite('Inspector segments merge into Labels', () => {
    let dom: JSDOM;
    let inspector: InspectorPanel;
    let cb: { jumps: number[]; labels: SegmentLabel[][]; names: Array<Record<string, string> | undefined>; copies: Array<[string, string]> };

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('setSegments renders address-sorted permanent rows + badge and jumps', () => {
        inspector.setSegments(segments);
        const items = document.querySelectorAll<HTMLElement>('.label-perma');
        assert.strictEqual(items.length, 2);
        const badge = document.querySelector('#s-labels .sb-badge')!;
        assert.strictEqual(badge.textContent, '2');
        assert.ok(!(badge as HTMLElement).hidden);
        assert.strictEqual(items[0].querySelector('.label-perma-name')!.textContent, 'Segment 1');
        assert.ok(items[0].querySelector('.label-rng')!.textContent?.includes('0x00001000'));
        assert.strictEqual(items[0].querySelectorAll('.act-btn-edit, .act-btn-del, .label-vis').length, 0,
            'permanent rows have no delete/visibility controls');
        assert.strictEqual(items[0].querySelectorAll('.label-seg-edit').length, 1,
            'permanent rows offer the ✎ rename affordance');
        items[0].click();
        assert.deepStrictEqual(cb.jumps, [0x1000]);
        assert.strictEqual(document.getElementById('s-segments'), null);
    });

    test('merged list is address-sorted with segments first on tie', () => {
        inspector.setSegments(segments);
        inspector.setLabels(labels);
        const rows = document.querySelectorAll<HTMLElement>('.label-item');
        assert.strictEqual(rows.length, 3);
        assert.strictEqual(rows[0].querySelector('.label-perma-name')!.textContent, 'Segment 1');
        assert.ok(rows[0].classList.contains('label-perma'));
        assert.strictEqual(rows[1].querySelector('.label-nm')!.textContent, 'Start');
        assert.strictEqual(rows[2].querySelector('.label-perma-name')!.textContent, 'Segment 2');
        const badge = document.querySelector('#s-labels .sb-badge')!;
        assert.strictEqual(badge.textContent, '3', 'badge counts total rows');
    });

    test('labels default collapsed stays in the pane stack and expands from its header', () => {
        const section = document.getElementById('s-labels')!;
        const head = section.querySelector<HTMLElement>('.sb-section-head')!;
        assert.ok(section.classList.contains('collapsed'));
        assert.strictEqual(section.parentElement?.classList.contains('sb-pane-view'), true, 'sections live in the pane view');
        head.click();
        assert.ok(!section.classList.contains('collapsed'));
        assert.strictEqual(head.getAttribute('aria-expanded'), 'true');
    });
});

suite('Inspector labels', () => {
    let dom: JSDOM;
    let inspector: InspectorPanel;
    let cb: { jumps: number[]; labels: SegmentLabel[][]; names: Array<Record<string, string> | undefined>; copies: Array<[string, string]> };

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
        const badge = document.querySelector('#s-labels .sb-badge')!;
        assert.strictEqual(badge.textContent, '1');
        assert.ok(!(badge as HTMLElement).hidden);
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

    test('visibility toggle reports onLabelsChange', () => {
        inspector.setLabels(labels);
        document.querySelector<HTMLElement>('.label-vis')!.click();
        assert.strictEqual(cb.labels[0][0].hidden, true);
        inspector.setLabels(cb.labels[0]);
        document.querySelector<HTMLElement>('.label-vis')!.click();
        assert.strictEqual(cb.labels[1][0].hidden, false);
    });

    test('user label rows have no reorder controls', () => {
        const three = [
            { id: 'a', name: 'A', startAddress: 0x1000, length: 4, color: '#4fc3f7' },
            { id: 'b', name: 'B', startAddress: 0x2000, length: 4, color: '#81c784' },
            { id: 'c', name: 'C', startAddress: 0x3000, length: 4, color: '#ffb74d' },
        ];
        inspector.setLabels(three);
        assert.strictEqual(document.querySelectorAll('.label-up').length, 0);
        assert.strictEqual(document.querySelectorAll('.label-dn').length, 0);
        // Order is address-sorted in the merged list, not manual.
        const names = [...document.querySelectorAll<HTMLElement>('.label-nm')].map(n => n.textContent);
        assert.deepStrictEqual(names, ['A', 'B', 'C']);
    });

    test('edit form saves updates via onLabelsChange', () => {
        inspector.setLabels(labels);
        document.querySelector<HTMLElement>('.act-btn-edit')!.click();
        (document.getElementById('lf-name') as HTMLInputElement).value = 'Renamed';
        document.getElementById('lf-save')!.click();
        assert.strictEqual(cb.labels[0][0].name, 'Renamed');
        assert.strictEqual(cb.labels[0][0].id, 'l1');
    });

    test('confirm-on-warning requires a second save click', () => {
        inspector.setLabels(labels);
        document.getElementById('btn-add-lbl')!.click();
        (document.getElementById('lf-name') as HTMLInputElement).value = 'Overlap';
        (document.getElementById('lf-start') as HTMLInputElement).value = '0x1000';
        (document.getElementById('lf-range') as HTMLInputElement).value = '4';
        document.getElementById('lf-save')!.click();
        assert.strictEqual(cb.labels.length, 0, 'no change on first save with warning');
        assert.ok(document.getElementById('lf-warn')!.textContent?.includes('Overlaps with'));
        document.getElementById('lf-save')!.click();
        assert.strictEqual(cb.labels.length, 1, 'second save confirms');
        assert.strictEqual(cb.labels[0].at(-1)!.name, 'Overlap');
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

suite('Pinned segment rename', () => {
    let dom: JSDOM;
    let inspector: InspectorPanel;
    let cb: { jumps: number[]; labels: SegmentLabel[][]; names: Array<Record<string, string> | undefined>; copies: Array<[string, string]> };

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('✎ opens the shared form prefilled; start/range/color read-only', () => {
        inspector.setSegments(segments);
        document.querySelector<HTMLElement>('.label-seg-edit')!.click();
        assert.strictEqual(document.querySelector('.sb-label-form-title')!.textContent, 'Rename Segment');
        assert.strictEqual((document.getElementById('lf-name') as HTMLInputElement).value, 'Segment 1');
        assert.strictEqual((document.getElementById('lf-start') as HTMLInputElement).disabled, true);
        assert.strictEqual((document.getElementById('lf-start') as HTMLInputElement).value, '0x00001000');
        assert.strictEqual((document.getElementById('lf-range') as HTMLInputElement).disabled, true);
        assert.strictEqual((document.getElementById('lf-range') as HTMLInputElement).value, '2');
        assert.ok(document.querySelector('.lbl-form .lf-ro'), 'color swatches rendered read-only');
    });

    test('rename save persists segmentNames override keyed by start address', () => {
        inspector.setSegments(segments);
        document.querySelector<HTMLElement>('.label-seg-edit')!.click();
        (document.getElementById('lf-name') as HTMLInputElement).value = 'Boot';
        document.getElementById('lf-save')!.click();
        assert.strictEqual(cb.labels.length, 1);
        assert.deepStrictEqual(cb.names.at(-1), { '4096': 'Boot' }, '0x1000 → decimal-string key');
    });

    test('reload: pushed override shows custom name + original parsed name as tooltip', () => {
        inspector.setSegments(segments);
        inspector.setLabels([], { '4096': 'Boot' });
        const row = document.querySelector<HTMLElement>('.label-perma')!;
        assert.strictEqual(row.querySelector('.label-perma-name')!.textContent, 'Boot');
        assert.strictEqual(row.querySelector('.label-perma-name')!.getAttribute('title'), 'Segment 1');
        assert.ok(row.querySelector('.label-perma-glyph'), 'pinned glyph stays');
        // Unrenamed rows carry no tooltip.
        const other = document.querySelectorAll<HTMLElement>('.label-perma')[1];
        assert.strictEqual(other.querySelector('.label-perma-name')!.textContent, 'Segment 2');
        assert.strictEqual(other.querySelector('.label-perma-name')!.getAttribute('title'), null);
    });

    test('renaming back to the parsed name clears the override', () => {
        inspector.setSegments(segments);
        inspector.setLabels([], { '4096': 'Boot' });
        document.querySelector<HTMLElement>('.label-seg-edit')!.click();
        assert.strictEqual((document.getElementById('lf-name') as HTMLInputElement).value, 'Boot', 'override prefills');
        (document.getElementById('lf-name') as HTMLInputElement).value = 'Segment 1';
        document.getElementById('lf-save')!.click();
        assert.deepStrictEqual(cb.names.at(-1), {}, 'override removed');
    });

    test('rename requires a non-empty name', () => {
        inspector.setSegments(segments);
        document.querySelector<HTMLElement>('.label-seg-edit')!.click();
        (document.getElementById('lf-name') as HTMLInputElement).value = '   ';
        document.getElementById('lf-save')!.click();
        assert.strictEqual(document.getElementById('lf-warn')!.textContent, 'Name is required.');
        assert.strictEqual(cb.labels.length, 0);
    });

    test('✎ click does not jump; row click still jumps', () => {
        inspector.setSegments(segments);
        document.querySelector<HTMLElement>('.label-seg-edit')!.click();
        assert.deepStrictEqual(cb.jumps, [], 'edit affordance never jumps');
        assert.ok(document.getElementById('lf-name'), 'form opened instead');
        document.getElementById('lf-cancel')!.click();
        document.querySelector<HTMLElement>('.label-perma')!.click();
        assert.deepStrictEqual(cb.jumps, [0x1000]);
    });
});

suite('Label row range display', () => {
    let dom: JSDOM;
    let inspector: InspectorPanel;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('user label rows show start – end · size like segment rows', () => {
        inspector.setLabels(labels); // 0x1000 len 4
        assert.strictEqual(
            document.querySelector<HTMLElement>('.label-item:not(.label-perma) .label-rng')!.textContent,
            '0x00001000–0x00001003 · 4 B',
        );
    });

    test('pinned segment rows keep start – end · size', () => {
        inspector.setSegments(segments);
        assert.strictEqual(
            document.querySelector<HTMLElement>('.label-perma .label-rng')!.textContent,
            '0x00001000–0x00001001 · 2 B',
        );
    });
});

suite('Label form selection fill', () => {
    let dom: JSDOM;
    let inspector: InspectorPanel;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        inspector = installed.inspector;
        currentDom = dom;
    });

    teardown(cleanupDom);

    function openAddForm(): void {
        inspector.setLabels([]);
        document.getElementById('btn-add-lbl')!.click();
    }

    function focusField(id: string): void {
        document.getElementById(id)!.dispatchEvent(new dom.window.Event('focus'));
    }

    function rangeEl(): HTMLInputElement {
        return document.getElementById('lf-range') as HTMLInputElement;
    }

    function startEl(): HTMLInputElement {
        return document.getElementById('lf-start') as HTMLInputElement;
    }

    test('default (start-focused): click fills Start + length Range', () => {
        openAddForm();
        inspector.setSelection(0x1000, 0x1003);
        inspector.syncLabelForm();
        assert.strictEqual(startEl().value, '0x00001000');
        assert.strictEqual(rangeEl().value, '4');
    });

    test('range focused: click auto-switches to End addr mode and fills it', () => {
        openAddForm();
        focusField('lf-range');
        inspector.setSelection(0x1004, 0x1004);
        inspector.syncLabelForm();
        assert.strictEqual(rangeEl().value, '0x00001004');
        assert.strictEqual(
            document.querySelector<HTMLElement>('.compact-tabs button.active')!.getAttribute('data-mode'),
            'end',
            'mode auto-switched',
        );
    });

    test('range focused: drag fills End addr with the selection end', () => {
        openAddForm();
        focusField('lf-range');
        inspector.setSelection(0x1000, 0x1002);
        inspector.syncLabelForm();
        assert.strictEqual(rangeEl().value, '0x00001002');
    });

    test('end mode + start focused: drag updates Start and end-address Range', () => {
        openAddForm();
        focusField('lf-range');
        inspector.setSelection(0x1004, 0x1004);
        inspector.syncLabelForm(); // switches to end mode
        focusField('lf-start');
        inspector.setSelection(0x1000, 0x1002);
        inspector.syncLabelForm();
        assert.strictEqual(startEl().value, '0x00001000');
        assert.strictEqual(rangeEl().value, '0x00001002', 'end mode keeps filling end addresses');
    });

    test('typing is only ever replaced by a selection change, never a keystroke', () => {
        openAddForm();
        rangeEl().value = '999';
        rangeEl().dispatchEvent(new dom.window.Event('input'));
        assert.strictEqual(rangeEl().value, '999', 'manual input untouched by typing events');
        inspector.setSelection(0x1000, 0x1003);
        inspector.syncLabelForm();
        assert.strictEqual(rangeEl().value, '4', 'selection change rewrites per fill rules');
    });

    test('rename form ignores selection changes entirely', () => {
        inspector.setSegments(segments);
        document.querySelector<HTMLElement>('.label-seg-edit')!.click();
        inspector.setSelection(0x1000, 0x1003);
        inspector.syncLabelForm();
        assert.strictEqual(startEl().value, '0x00001000', 'read-only fields stay frozen');
        assert.strictEqual(rangeEl().value, '2');
    });
});
