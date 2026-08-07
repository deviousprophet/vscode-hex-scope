import * as assert from 'assert';
import { JSDOM } from 'jsdom';
import '../css-import-hook';

import { StructPanel } from '../../../webview/components/Struct/StructPanel';
import type { StructDef, StructPin } from '../../../core/types';
import { getByte } from '../../../webview/memory/memoryData';
import { setBytesInSegment } from '../../shared/struct-test-helpers';

let currentDom: JSDOM | null = null;

type Globalish = {
    window: Window;
    document: Document;
    getComputedStyle: typeof getComputedStyle;
    navigator: Navigator;
};

type Cb = {
    structs: StructDef[][];
    pins: StructPin[][];
    states: Array<{ structs: StructDef[]; pins: StructPin[] }>;
    ranges: Array<{ start: number; count: number }>;
};

function installDom(): { dom: JSDOM; panel: StructPanel; cb: Cb } {
    const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://hexscope.test/' });
    const g = globalThis as unknown as Globalish;
    g.window = dom.window as unknown as Window;
    g.document = dom.window.document as unknown as Document;
    g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window) as typeof getComputedStyle;
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
        writable: true,
    });
    (globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame =
        () => 0;

    const cb: Cb = { structs: [], pins: [], states: [], ranges: [] };
    const panel = new StructPanel({
        readByte: getByte,
        onStructsChange: structs => cb.structs.push(structs),
        onPinsChange: pins => cb.pins.push(pins),
        onStateChange: (structs, pins) => cb.states.push({ structs, pins }),
        onSelectRange: (start, count) => cb.ranges.push({ start, count }),
    });
    panel.setTabActive(true);
    panel.mount(document.getElementById('host')!);
    return { dom, panel, cb };
}

function cleanupDom(): void {
    if (currentDom) {
        currentDom.window.close();
        currentDom = null;
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle;
        delete (globalThis as unknown as { navigator?: Navigator }).navigator;
    }
}

function elementText(root: Element | null, selector: string): string {
    return root?.querySelector(selector)?.textContent ?? '';
}

function simpleDef(id: string, name: string, fields: StructDef['fields']): StructDef {
    return { id, name, fields };
}

const scalarDef: StructDef = simpleDef('scalar', 'Scalar', [
    { name: 'count', type: 'uint16', count: 1 },
]);
const childDef: StructDef = simpleDef('child', 'ChildNode', [
    { name: 'tag', type: 'uint8', count: 1 },
]);
const parentDef: StructDef = {
    id: 'parent',
    name: 'Parent',
    packed: true,
    fields: [{ name: 'hdr', type: 'struct', refStructId: 'child', isPointer: true, count: 1 }],
};

function confirmDelete(dom: JSDOM): void {
    const yes = document.getElementById('del-confirm-pop')?.querySelector<HTMLElement>('.dcp-yes');
    assert.ok(yes, 'inline delete confirmation should appear');
    click(dom, yes);
}

function setupScalar(dom: JSDOM, cb: Cb): StructPanel {
    setBytesInSegment(0, [0x34, 0x12]);
    const panel = new StructPanel({
        readByte: getByte,
        onStructsChange: structs => cb.structs.push(structs),
        onPinsChange: pins => cb.pins.push(pins),
        onStateChange: (structs, pins) => cb.states.push({ structs, pins }),
        onSelectRange: (start, count) => cb.ranges.push({ start, count }),
    });
    panel.setTabActive(true);
    panel.setData([scalarDef], [{ id: 'pin1', structId: 'scalar', addr: 0, name: 'inst' }]);
    panel.mount(document.getElementById('host')!);
    return panel;
}

function click(dom: JSDOM, el: Element | null): void {
    assert.ok(el, 'target element should exist');
    el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

suite('StructPanel mount + tracks', () => {
    let dom: JSDOM;
    let panel: StructPanel;
    let cb: Cb;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        panel = installed.panel;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('renders both tracks with empty states', () => {
        assert.ok(document.getElementById('si-track'));
        assert.ok(document.querySelector('.si-main-panel'));
        assert.ok(document.querySelector('.si-types-panel'));
        assert.match(document.querySelector('.si-main-panel')!.textContent!, /No instances yet/);
        assert.strictEqual(document.querySelector('.si-types-panel .sb-empty')?.textContent, 'No types defined yet.');
    });

    test('mount is idempotent: re-mount into the same root re-renders without errors', () => {
        panel.setData([scalarDef], [{ id: 'pin2', structId: 'scalar', addr: 0, name: 'inst' }]);
        panel.mount(document.getElementById('host')!);
        assert.ok(document.querySelector('.si-card'));
        assert.strictEqual(document.querySelectorAll('.si-card').length, 1);
    });
});

suite('StructPanel pins + decoded rows', () => {
    let dom: JSDOM;
    let panel: StructPanel;
    let cb: Cb;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        panel = installed.panel;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('setData renders instance cards with decoded rows; expansion persists across re-render', () => {
        setBytesInSegment(0, [0x34, 0x12]);
        panel.setData([scalarDef], [{ id: 'pin1', structId: 'scalar', addr: 0, name: 'inst' }]);
        assert.ok(document.querySelector('.si-card'));
        assert.strictEqual(document.querySelector('.si-cname')?.textContent, 'inst');
        assert.ok(document.querySelector('.si-ctype')?.textContent?.includes('Scalar'));

        // Expand the card to render decoded rows.
        click(dom, document.querySelector('.si-expand-btn'));
        const fieldName = document.querySelector('.si-field .si-f-name')?.textContent;
        assert.strictEqual(fieldName, 'count');
        assert.match(elementText(document.querySelector('.si-field')!, '.si-f-val')!, /0x1234/);
        assert.ok(document.getElementById('si-track')?.classList.contains('si-showing-types') === false);

        // Re-render: expansion state survives.
        panel.render();
        assert.ok(document.querySelector('.si-card')?.classList.contains('si-expanded'), 'card expansion survives re-render');
        assert.strictEqual(document.querySelector('.si-field .si-f-name')?.textContent, 'count');
    });

    test('setEndian re-decodes scalar values', () => {
        setBytesInSegment(0, [0x34, 0x12]);
        panel.setData([scalarDef], [{ id: 'pin1', structId: 'scalar', addr: 0, name: 'inst' }]);
        click(dom, document.querySelector('.si-expand-btn'));
        assert.match(elementText(document.querySelector('.si-field')!, '.si-f-val')!, /0x1234/);
        panel.setEndian('be');
        assert.match(elementText(document.querySelector('.si-field')!, '.si-f-val')!, /0x3412/);
    });

    test('row click reports onSelectRange', () => {
        setBytesInSegment(0, [0x34, 0x12]);
        panel.setData([scalarDef], [{ id: 'pin1', structId: 'scalar', addr: 0, name: 'inst' }]);
        click(dom, document.querySelector('.si-expand-btn'));
        const row = document.querySelector<HTMLElement>('.si-field');
        assert.ok(row, 'decoded row should render');
        click(dom, row);
        assert.deepStrictEqual(cb.ranges, [{ start: 0, count: 2 }]);
        assert.ok(row!.classList.contains('si-selected'));
    });

    test('pointer follow reports onSelectRange; create reports onSelectRange + onPinsChange', () => {
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        setBytesInSegment(0, bytes);
        panel.setData([childDef, parentDef], [{ id: 'pin_parent', structId: 'parent', addr: 0, name: 'parentInst' }]);
        click(dom, document.querySelector('.si-expand-btn'));

        // Value click follows the pointer to the target.
        const ptrVal = document.querySelector<HTMLElement>('.si-ptr-hdr .si-f-ptr');
        assert.ok(ptrVal, 'pointer value should render');
        click(dom, ptrVal);
        assert.deepStrictEqual(cb.ranges.at(-1), { start: 0x20, count: 1 });

        // Context menu create action adds a target pin.
        const header = document.querySelector<HTMLElement>('.si-ptr-hdr');
        assert.ok(header, 'pointer header should render');
        click(dom, header!.querySelector('.si-arr-exp-btn'));
        const childHdr = document.querySelector<HTMLElement>('.si-ptr-child-hdr[data-pointer-allow-create="true"]');
        assert.ok(childHdr, 'create-enabled child header should render');
        childHdr!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const create = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="create-struct-ptr"]');
        assert.ok(create, 'create struct instance menu item should render');
        click(dom, create);
        const created = cb.pins.at(-1);
        assert.ok(created, 'create should report onPinsChange');
        assert.strictEqual(created![created!.length - 1].structId, 'child');
        assert.strictEqual(created![created!.length - 1].addr, 0x20);
        assert.ok(cb.ranges.some(r => r.start === 0x20), 'create should select the target range');
    });
});

suite('StructPanel types editor', () => {
    let dom: JSDOM;
    let panel: StructPanel;
    let cb: Cb;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        panel = installed.panel;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('new type editor saves via onStructsChange and renders C preview', () => {
        click(dom, document.getElementById('si-types-btn'));
        click(dom, document.getElementById('sm-new-btn'));
        assert.ok(document.getElementById('se-name'));
        assert.ok(document.getElementById('se-preview'));

        (document.getElementById('se-name') as HTMLInputElement).value = 'MyNewType';
        const preview = document.querySelector<HTMLElement>('#se-preview pre.si-c-preview');
        assert.ok(preview && preview.textContent!.length > 0, 'C preview should render');

        click(dom, document.getElementById('se-save'));
        assert.strictEqual(cb.structs.length, 1);
        const saved = cb.structs[0];
        assert.strictEqual(saved[0].name, 'MyNewType');
        assert.strictEqual(saved[0].fields.length, 1);
    });

    test('delete struct cascades dependent pins via onStateChange', () => {
        panel.setData([childDef, parentDef], [
            { id: 'pin1', structId: 'parent', addr: 0, name: 'inst' },
        ]);
        click(dom, document.getElementById('si-types-btn'));
        const delBtn = document.querySelector<HTMLElement>('.sd-row .act-btn-del[data-struct-id="parent"]');
        assert.ok(delBtn, 'type row delete button should render');
        click(dom, delBtn);
        confirmDelete(dom);
        assert.strictEqual(cb.states.length, 1);
        const state = cb.states[0];
        assert.deepStrictEqual(state.structs.map(d => d.id), ['child']);
        assert.deepStrictEqual(state.pins, []);
    });
});

suite('StructPanel pins add/edit/delete + selection sync', () => {
    let dom: JSDOM;
    let panel: StructPanel;
    let cb: Cb;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        panel = installed.panel;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('add form confirms a new pin via onPinsChange', () => {
        panel.setData([scalarDef], []);
        click(dom, document.getElementById('si-add-btn'));
        const nameInp = document.getElementById('sa-name') as HTMLInputElement | null;
        const addrInp = document.getElementById('sa-addr') as HTMLInputElement | null;
        assert.ok(nameInp && addrInp, 'add form inputs should render');
        nameInp!.value = 'newInst';
        addrInp!.value = '00001000';
        click(dom, document.getElementById('sa-confirm'));
        assert.strictEqual(cb.pins.length, 1);
        const added = cb.pins[0][0];
        assert.strictEqual(added.structId, 'scalar');
        assert.strictEqual(added.addr, 0x1000);
        assert.strictEqual(added.name, 'newInst');
    });

    test('setSelection fills the open add-form address', () => {
        panel.setData([scalarDef], []);
        click(dom, document.getElementById('si-add-btn'));
        panel.setSelection(0x2000);
        assert.strictEqual((document.getElementById('sa-addr') as HTMLInputElement).value, '00002000');
    });

    test('edit form save reports onPinsChange', () => {
        panel.setData([scalarDef], [{ id: 'pin1', structId: 'scalar', addr: 0, name: 'inst' }]);
        click(dom, document.querySelector('.si-card .act-btn-edit'));
        assert.ok(document.querySelector('.si-pin-edit-form'));
        (document.querySelector('.si-pe-name') as HTMLInputElement).value = 'renamed';
        (document.querySelector('.si-pe-addr') as HTMLInputElement).value = '00001111';
        click(dom, document.querySelector('.si-pe-save'));
        assert.strictEqual(cb.pins.length, 1);
        assert.strictEqual(cb.pins[0][0].name, 'renamed');
        assert.strictEqual(cb.pins[0][0].addr, 0x1111);
    });

    test('delete pin reports onPinsChange', () => {
        panel.setData([scalarDef], [{ id: 'pin1', structId: 'scalar', addr: 0, name: 'inst' }]);
        click(dom, document.querySelector('.si-card .act-btn-del'));
        confirmDelete(dom);
        assert.strictEqual(cb.pins.length, 1);
        assert.deepStrictEqual(cb.pins[0], []);
    });
});

suite('StructPanel bit layout', () => {
    let dom: JSDOM;
    let panel: StructPanel;
    let cb: Cb;

    setup(() => {
        const installed = installDom();
        dom = installed.dom;
        panel = installed.panel;
        cb = installed.cb;
        currentDom = dom;
    });

    teardown(cleanupDom);

    test('LSB/MSB toggle re-renders bit rows; setBitFieldAllocation pushes from host', () => {
        const def = simpleDef('bits', 'Bits', [
            {
                name: 'control',
                type: 'uint8',
                count: 1,
                bitFields: [
                    { name: 'a', bitWidth: 3 },
                    { name: 'b', bitWidth: 5 },
                ],
            },
        ]);
        setBytesInSegment(0, [0xB1]);
        panel.setData([def], [{ id: 'pin1', structId: 'bits', addr: 0, name: 'inst' }]);
        click(dom, document.querySelector('.si-expand-btn'));

        click(dom, document.querySelector('.si-bitunit-hdr .si-arr-exp-btn'));
        const msbValues = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(msbValues, ['101', '1 0001'], 'msb default allocation');

        click(dom, document.getElementById('sa-btn-bit-lsb'));
        const lsbValues = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(lsbValues, ['001', '1 0110'], 'lsb allocation after toggle');
        assert.ok(document.getElementById('sa-btn-bit-lsb')!.classList.contains('active'));

        // Host push of a new allocation re-renders.
        panel.setBitFieldAllocation('msb');
        assert.ok(document.getElementById('sa-btn-bit-msb')!.classList.contains('active'));
        const restored = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(restored, ['101', '1 0001']);
    });
});
