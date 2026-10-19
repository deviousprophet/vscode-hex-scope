import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

import type { OverlayPanel } from '../../../../../webview/components/sidebar/overlayPanel/overlayPanel';
import { S } from '../../../../../webview/state';
import { getByte } from '../../../../../webview/memory/memoryData';
import type { TypeDef, TypeInstance } from '../../../../../core/types';
import { typeDefToC } from '../../../../../core/overlay/overlayCodec';
import { setBytesInSegment } from '../../../overlayStateHelpers';

function resetOverlayState(): void {
    S.types = [];
    S.typeInstances = [];
    S.parseResult = null;
    S.segmentIndex = [];
    S.endian = 'le';
    S.bitFieldAllocation = 'msb';
    S.sidebarTab = 'overlay';
}

function elementText(element: Element | null): string {
    return element?.textContent ?? '';
}

/** Inject the real panel stylesheet so computed layout reflects the authored grid rules. */
function injectOverlayPanelCss(): void {
    const css = fs.readFileSync(
        path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'webview', 'components', 'sidebar', 'overlayPanel', 'overlayPanel.css'),
        'utf8',
    );
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
}

/** Computed `grid-template-columns` of a header/row block — proves they resolve the same columns. */
function computedGridTemplate(dom: JSDOM, element: Element | null): string {
    assert.ok(element, 'element should exist');
    return dom.window.getComputedStyle(element!).getPropertyValue('grid-template-columns');
}

function click(dom: JSDOM, el: Element | null): void {
    assert.ok(el, 'target element should exist');
    el!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function setChecked(dom: JSDOM, el: HTMLInputElement | null, checked: boolean): void {
    assert.ok(el, 'checkbox should exist');
    el!.checked = checked;
    el!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function confirmDelete(dom: JSDOM): void {
    const yes = document.getElementById('del-confirm-pop')?.querySelector<HTMLElement>('.dcp-yes');
    assert.ok(yes, 'inline delete confirmation should appear');
    click(dom, yes);
}

function simpleDef(id: string, name: string, fields: TypeDef['fields']): TypeDef {
    return { id, name, fields };
}

const scalarDef: TypeDef = simpleDef('scalar', 'Scalar', [
    { name: 'count', type: 'uint16', count: 1 },
]);
const childDef: TypeDef = simpleDef('child', 'ChildNode', [
    { name: 'tag', type: 'uint8', count: 1 },
]);
const parentDef: TypeDef = {
    id: 'parent',
    name: 'Parent',
    packed: true,
    fields: [{ name: 'hdr', type: 'struct', refTypeId: 'child', isPointer: true, count: 1 }],
};

function getTopFieldHeaders(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-f-name'))
        .map(el => el.textContent ?? '');
}

function openValueMenuLabels(target: HTMLElement, dom: JSDOM): string[] {
    target.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
    return Array.from(document.querySelectorAll<HTMLElement>('.oi-field-menu .menu-item[data-cmd^="disp-"] .menu-label'))
        .map(el => el.textContent ?? '');
}

suite('OverlayPanel deep-render harness', () => {
    let dom: JSDOM;

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body><div id="s-overlay"></div></body></html>');

        const fakeVsCodeApi = {
            postMessage: () => {},
            getState: () => ({}),
            setState: (_state: unknown) => {},
        };

        Object.defineProperty(globalThis, 'window', {
            value: dom.window,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'document', {
            value: dom.window.document,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'navigator', {
            value: dom.window.navigator,
            configurable: true,
            writable: true,
        });
        Object.defineProperty(globalThis, 'acquireVsCodeApi', {
            value: () => fakeVsCodeApi,
            configurable: true,
            writable: true,
        });
        (globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame =
            () => 0;

        resetOverlayState();
    });

    teardown(() => {
        resetOverlayState();
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { navigator?: Navigator }).navigator;
        delete (globalThis as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
        delete (globalThis as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame;
    });

    async function createMountedPanel(): Promise<OverlayPanel> {
        const { OverlayPanel } = await import('../../../../../webview/components/sidebar/overlayPanel/overlayPanel.js');
        const panel = new OverlayPanel({
            readByte: getByte,
            onStateChange: (types, pins) => { S.types = types; S.typeInstances = pins; },
            onTypesChange: types => { S.types = types; },
            onPinsChange: pins => { S.typeInstances = pins; },
            onSelectRange: (start, count) => { S.selStart = start; S.selEnd = start + count - 1; },
        });
        panel.setData(S.types, S.typeInstances);
        panel.setEndian(S.endian);
        panel.setBitFieldAllocation(S.bitFieldAllocation);
        panel.setTabActive(true);
        panel.mount(document.getElementById('s-overlay')!);
        return panel;
    }

    /** Open the single `＋ Add` entry point's kind picker. */
    function openKindPicker(): void {
        click(dom, document.getElementById('om-add-btn'));
        assert.ok(document.getElementById('om-kind-picker'), 'kind picker should render after ＋ Add');
    }

    /** Open a kind's creation form through the picker tile. */
    function openKindEditor(kind: 'struct' | 'bitfield' | 'enum'): void {
        openKindPicker();
        click(dom, document.querySelector<HTMLElement>(`.om-kind-tile[data-kind="${kind}"]`));
    }

    async function renderPinsAndExpandCard(): Promise<OverlayPanel> {
        const panel = await createMountedPanel();
        const expandCard = document.querySelector<HTMLElement>('.oi-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        return panel;
    }

    function captureClipboardWrites(): string[] {
        const writes: string[] = [];
        Object.defineProperty(dom.window.navigator, 'clipboard', {
            value: { writeText: (text: string) => { writes.push(text); return Promise.resolve(); } },
            configurable: true,
        });
        Object.defineProperty(globalThis.navigator, 'clipboard', {
            value: dom.window.navigator.clipboard,
            configurable: true,
        });
        return writes;
    }

    function setupTypePointerFixture(ids: { header: string; parent: string; pin: string }): TypeDef {
        const header: TypeDef = {
            id: ids.header,
            name: 'HeaderCreate',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: TypeDef = {
            id: ids.parent,
            name: 'ParentCreate',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refTypeId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.types = [header, parent];
        S.typeInstances = [{ id: ids.pin, typeId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);
        return header;
    }

    function setupUnmappedPointerFixture(): void {
        const def: TypeDef = {
            id: 'ptr_unmapped',
            name: 'PtrUnmapped',
            packed: true,
            fields: [
                { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            ],
        };
        S.types = [def];
        S.typeInstances = [{ id: 'pin_ptr_unmapped', typeId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00, 0x00, 0x00, 0x20]);
    }

    function setupNullPointerFixture(): void {
        const def: TypeDef = {
            id: 'ptr_null',
            name: 'PtrNull',
            packed: true,
            fields: [
                { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            ],
        };
        S.types = [def];
        S.typeInstances = [{ id: 'pin_ptr_null', typeId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00, 0x00, 0x00, 0x00]);
    }

    function setupVoidPointerFixture(type: 'void' | 'pointer' = 'void'): void {
        const def: TypeDef = {
            id: `ptr_${type}`,
            name: 'PtrVoid',
            packed: true,
            fields: [
                { name: 'raw', type, isPointer: true, count: 1 },
            ],
        };
        const bytes = new Array(0x30).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.types = [def];
        S.typeInstances = [{ id: `pin_ptr_${type}`, typeId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);
    }

    function assertUnmappedPointerRow(): void {
        const row = document.querySelector<HTMLElement>('.oi-ptr-hdr.oi-ptr-field');
        assert.ok(row, 'typed pointer row should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-f-name')?.textContent ?? '', 'next', 'typed pointer name should not repeat target type');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-f-type')?.textContent, 'u16*', 'typed pointer type cell should show target pointer type');
        assertUnmappedPointerValue(row!);
        assert.ok(row!.classList.contains('oi-field'), 'unmapped pointer should use scalar field row layout');
        assert.ok(!row!.classList.contains('oi-arr-grp-hdr'), 'unmapped pointer should not use composite header layout');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-arr-exp-btn'), null, 'unmapped pointer should not render an expand button');
        assert.strictEqual(document.querySelector<HTMLElement>('.oi-ptr-child-hdr'), null, 'unmapped pointer should not render a child preview row');
    }

    function assertUnmappedPointerValue(row: HTMLElement): void {
        const value = row.querySelector<HTMLElement>('.oi-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.strictEqual(value, '(unmapped) 0x20000000', 'unmapped status should not imply followable pointer navigation');
    }

    function assertNullPointerRow(): void {
        const row = document.querySelector<HTMLElement>('.oi-ptr-hdr.oi-ptr-field');
        assert.ok(row, 'null pointer row should render');
        const value = row!.querySelector<HTMLElement>('.oi-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.strictEqual(value, '(null) 0x00000000', 'null status should be explicit without pointer navigation arrow');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-arr-exp-btn'), null, 'null pointer should not render an expand button');
    }

    function assertVoidPointerLeafRow(): HTMLElement {
        const row = document.querySelector<HTMLElement>('.oi-ptr-hdr.oi-ptr-field');
        assert.ok(row, 'void pointer row should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-f-type')?.textContent, 'void*', 'void pointer type cell should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-f-name')?.textContent, 'raw', 'void pointer name should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.oi-arr-exp-btn'), null, 'void pointer should not render an expand button');
        assert.strictEqual(document.querySelector<HTMLElement>('.oi-ptr-child-hdr'), null, 'void pointer should not render a child preview row');
        const value = row!.querySelector<HTMLElement>('.oi-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.strictEqual(value, '→ 0x00000020', 'mapped void pointer should keep followable value display');
        return row!;
    }

    function assertUnmappedPointerMenu(dom: JSDOM): void {
        const row = document.querySelector<HTMLElement>('.oi-ptr-hdr.oi-ptr-field');
        assert.ok(row, 'typed pointer row should render before opening menu');
        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const disabledFollow = document.querySelector<HTMLElement>('.oi-field-menu .menu-item.menu-disabled');
        assert.ok(disabledFollow?.textContent?.includes('Jump to Address'), 'jump item should be visible but disabled');
        assert.ok(disabledFollow?.textContent?.includes('unmapped'), 'disabled jump should explain unmapped target');
    }

    function setupScalarPointerPreviewFixture(): void {
        const def: TypeDef = {
            id: 'ptr_scalar_preview',
            name: 'PtrScalarPreview',
            packed: true,
            fields: [
                { name: 'value', type: 'uint32', isPointer: true, count: 1 },
            ],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0x30;
        bytes[0x21] = 0x33;
        bytes[0x22] = 0x43;
        bytes[0x23] = 0x38;
        S.types = [def];
        S.typeInstances = [{ id: 'pin_ptr_scalar_preview', typeId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);
    }

    function assertScalarPointerTargetPreview(row: HTMLElement): void {
        const body = requiredPointerBody(row);
        const child = body.querySelector<HTMLElement>(':scope > .oi-field');
        assert.ok(child, 'scalar pointer target preview should render');
        assert.strictEqual(body.querySelector<HTMLElement>('.oi-ptr-child-hdr'), null, 'scalar target should not render an object child header');
        assertScalarPointerTargetField(child!);
    }

    function assertScalarPointerTargetField(child: HTMLElement): void {
        assert.strictEqual(child.querySelector<HTMLElement>('.oi-f-off'), null, 'scalar pointer target should hide noisy +000 offset');
        assert.ok(child.querySelector<HTMLElement>('.oi-node-pad'), 'scalar pointer target should keep row alignment');
        assert.strictEqual(requiredPointerTargetText(child, '.oi-f-type'), 'u32');
        assert.strictEqual(requiredPointerTargetText(child, '.oi-f-name'), '*');
        assert.strictEqual(requiredPointerTargetText(child, '.oi-f-val'), '0x38433330');
    }

    function requiredPointerTargetText(row: HTMLElement, selector: string): string {
        const el = row.querySelector<HTMLElement>(selector);
        assert.ok(el, `${selector} should render`);
        return el!.textContent ?? '';
    }

    function requiredPointerBody(row: HTMLElement): HTMLElement {
        const group = row.closest<HTMLElement>('.oi-arr-grp');
        assert.ok(group, 'pointer group should render');
        const body = group!.querySelector<HTMLElement>(':scope > .oi-arr-grp-body');
        assert.ok(body, 'pointer body should render after expand');
        return body!;
    }

    function setupOffsetVisiblePointerFixture(): void {
        const header: TypeDef = {
            id: 'header_offset_visible',
            name: 'HeaderOffsetVisible',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent = offsetVisiblePointerParent(header.id);
        const bytes = new Array(0x40).fill(0);
        bytes[1] = 0x20;
        bytes[0x20] = 0xAB;
        S.types = [header, parent];
        S.typeInstances = [{ id: 'pin_parent_offset_visible', typeId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);
    }

    function offsetVisiblePointerParent(headerId: string): TypeDef {
        return {
            id: 'parent_offset_visible',
            name: 'ParentOffsetVisible',
            packed: true,
            fields: [
                { name: 'prefix', type: 'uint8', count: 1 },
                { name: 'hdr', type: 'struct', refTypeId: headerId, isPointer: true, count: 1 },
            ],
        };
    }

    function assertPointerOffsetVisibleAfterExpand(dom: JSDOM): void {
        const headerRow = requiredPointerHeader('type pointer header should render');
        assert.strictEqual(pointerHeaderOffset(headerRow), '+001', 'collapsed pointer header should show storage offset');
        expandPointerHeader(headerRow, dom);
        assert.strictEqual(pointerHeaderOffset(requiredPointerHeader('expanded pointer header should render')), '+001', 'expanded pointer header should keep its offset visible');
    }

    function requiredPointerHeader(message: string): HTMLElement {
        const headerRow = document.querySelector<HTMLElement>('.oi-ptr-hdr');
        assert.ok(headerRow, message);
        return headerRow!;
    }

    function pointerHeaderOffset(headerRow: HTMLElement): string {
        const offset = headerRow.querySelector<HTMLElement>('.oi-f-off');
        assert.ok(offset, 'pointer header offset should render');
        return offset!.textContent ?? '';
    }

    function expandPointerHeader(headerRow: HTMLElement, dom: JSDOM): void {
        const expand = headerRow.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(expand, 'type pointer expand button should render');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }

    function triggerCreateTypeInstance(dom: JSDOM, message: string): void {
        const parentHeader = document.querySelector<HTMLElement>('.oi-ptr-hdr');
        assert.ok(parentHeader, message);
        const expand = parentHeader!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(expand, 'type pointer header should have expand button');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const childHeader = document.querySelector<HTMLElement>('.oi-ptr-child-hdr[data-pointer-allow-create="true"]');
        assert.ok(childHeader, 'type pointer child header should render create-enabled menu source');
        childHeader!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const create = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="create-type-ptr"]');
        assert.ok(create, 'create instance command should be enabled');
        create!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }

    function pinsForTarget(typeId: string, addr: number): TypeInstance[] {
        const matches: TypeInstance[] = [];
        for (const pin of S.typeInstances) {
            if (pin.typeId === typeId && pin.addr === addr) { matches.push(pin); }
        }
        return matches;
    }

    function assertPointerCreateMetadata(pin: TypeInstance): void {
        assert.strictEqual(pin.name, 'parentInst.hdr @00000020');
        const source = pin.pointerSources?.[0];
        assert.ok(source, 'created pin should store pointer source metadata');
        assert.strictEqual(source!.sourcePinId, 'pin_parent_create');
        assert.strictEqual(source!.sourceFieldPath, 'hdr');
        assert.strictEqual(source!.pointerStorageAddress, 0);
        assert.strictEqual(elementText(document.querySelector('.oi-csource')), 'from parentInst.hdr @0x00000000');
    }

    function assertSinglePointerTarget(typeId: string): TypeInstance {
        const targetPins = pinsForTarget(typeId, 0x20);
        assert.strictEqual(targetPins.length, 1, 'create should add target instance once');
        return targetPins[0];
    }

    test('uses declared type and element count for nested type array header', async () => {
        const child: TypeDef = {
            id: 'child',
            name: 'ChildNode',
            fields: [
                { name: 'a', type: 'uint8', count: 1 },
                { name: 'b', type: 'uint16', count: 1 },
            ],
        };
        const parent: TypeDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'nodes', type: 'struct', refTypeId: 'child', count: 3 },
            ],
        };
        const pin: TypeInstance = {
            id: 'pin_2',
            typeId: 'parent',
            addr: 0,
            name: 'parentInst',
        };

        S.types = [child, parent];
        S.typeInstances = [pin];

        await renderPinsAndExpandCard();

        const header = document.querySelector<HTMLElement>('.oi-arr-addr');
        assert.ok(header, 'array header summary should be rendered');

        const text = header!.textContent ?? '';
        const title = header!.getAttribute('title') ?? '';

        assert.ok(text.includes('[3]'), `expected element count [3] in header text, got: ${text}`);
        assert.ok(title.includes('[3]'), `expected element count [3] in header title, got: ${title}`);
        assert.ok(text.includes('ChildNode'), `expected type name ChildNode in header text, got: ${text}`);
        assert.ok(title.includes('ChildNode'), `expected type name ChildNode in header title, got: ${title}`);
        assert.ok(!text.includes('[6]'), `header should not use flattened child row count, got: ${text}`);
    });

    test('renders nested type arrays as element groups with leaf-only labels', async () => {
        const child: TypeDef = {
            id: 'child',
            name: 'ChildNode',
            fields: [
                { name: 'field0', type: 'uint8', count: 1 },
                { name: 'field1', type: 'uint8', count: 1 },
                { name: 'field2', type: 'uint8', count: 2 },
            ],
        };
        const parent: TypeDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'nodes', type: 'struct', refTypeId: 'child', count: 2 },
            ],
        };
        const pin: TypeInstance = {
            id: 'pin_1',
            typeId: 'parent',
            addr: 0,
            name: 'parentInst',
        };

        S.types = [child, parent];
        S.typeInstances = [pin];

        await renderPinsAndExpandCard();

        const expandArray = document.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(expandArray, 'array group expand button should be rendered');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const topArrayHeaders = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr .oi-f-name'))
            .map(el => el.textContent ?? '');
        const nodesHeaderCount = topArrayHeaders.filter(name => name === 'nodes').length;
        assert.strictEqual(nodesHeaderCount, 1, 'parent type-array group should not be split by nested arrays');

        const firstElementBody = document.querySelector<HTMLElement>('.oi-arr-el-body');
        assert.ok(firstElementBody, 'nested element body should be rendered');
        assert.strictEqual(firstElementBody!.style.display, 'none', 'nested element body should be collapsed by default');

        const expandElement = document.querySelector<HTMLElement>('.oi-arr-el-exp-btn');
        assert.ok(expandElement, 'nested element expand button should be rendered');
        expandElement!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const elementHeaderName = document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-f-name');
        assert.ok(elementHeaderName, 'element header name should be rendered');
        assert.strictEqual(elementHeaderName!.textContent ?? '', '[0]', 'element header should only show index');
        const elementHeaderMeta = document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-arr-addr');
        assert.ok(elementHeaderMeta, 'element header should show type summary');
        assert.strictEqual(elementHeaderMeta!.textContent ?? '', 'ChildNode', 'element header should show type');

        const firstLeafName = document.querySelector<HTMLElement>('.oi-arr-el-body .oi-field .oi-f-name');
        assert.ok(firstLeafName, 'leaf row name should be rendered after expanding an element');
        const label = firstLeafName!.textContent ?? '';
        assert.strictEqual(label, 'field0', `expected leaf-only label field0, got: ${label}`);
        assert.ok(!label.includes('['), `label should not include array index prefix, got: ${label}`);
        assert.ok(!label.includes('nodes.'), `label should not include parent path, got: ${label}`);

        const nestedHeaders = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-el-body .oi-arr-grp-hdr'));
        const nestedField2Header = nestedHeaders.find(h =>
            h.querySelector<HTMLElement>('.oi-f-name')?.textContent === 'field2'
        );
        assert.ok(nestedField2Header, 'nested scalar-array node field2 should be rendered');

        const nestedExpandBtn = nestedField2Header!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(nestedExpandBtn, 'nested scalar-array node should have expand button');
        nestedExpandBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedLeafNames = Array.from(
            nestedField2Header!
                .closest<HTMLElement>('.oi-arr-grp')!
                .querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field .oi-f-name')
        ).map(el => el.textContent ?? '');
        assert.ok(nestedLeafNames.includes('[0]'), 'nested scalar-array child should use index-only label [0]');
        assert.ok(nestedLeafNames.includes('[1]'), 'nested scalar-array child should use index-only label [1]');
        assert.ok(!nestedLeafNames.some(name => name.includes('nodes[')), 'nested leaf labels should not include parent array path');
    });

    test('uses local node label for scalar-type nested scalar array', async () => {
        const child: TypeDef = {
            id: 'child',
            name: 'MyType',
            fields: [
                { name: 'field0', type: 'uint32', count: 1 },
                { name: 'field1', type: 'uint8', count: 1 },
                { name: 'field2', type: 'uint8', count: 2 },
            ],
        };
        const parent: TypeDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'field3', type: 'struct', refTypeId: 'child', count: 1 },
            ],
        };
        const pin: TypeInstance = {
            id: 'pin_scalar_type',
            typeId: 'parent',
            addr: 0,
            name: 'parentInst',
        };

        S.types = [child, parent];
        S.typeInstances = [pin];

        await renderPinsAndExpandCard();

        const topHeaders = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(topHeaders.includes('field3'), 'scalar type node should be labeled with local field name');
        assert.ok(topHeaders.includes('field2'), 'nested scalar-array node should be labeled with local field name');
        assert.ok(!topHeaders.includes('field3.field2'), 'nested scalar-array node should not include parent path');

        const topLevelHeaders = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(topLevelHeaders, ['field3'], 'nested scalar-array node should not be rendered at top level');

        const parentGroup = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp');
        assert.ok(parentGroup, 'scalar type group should exist');
        const parentExpandBtn = parentGroup!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(parentExpandBtn, 'scalar type group should be expandable');
        parentExpandBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedHeader = parentGroup!.querySelector<HTMLElement>('.oi-arr-grp-body .oi-arr-grp-hdr .oi-f-name');
        assert.ok(nestedHeader, 'nested scalar-array header should render inside scalar type body');
        assert.strictEqual(nestedHeader!.textContent ?? '', 'field2', 'nested scalar-array header should keep local name');
    });

    test('keeps child composite nodes collapsed by default after opening parent', async () => {
        const child: TypeDef = {
            id: 'child_collapse',
            name: 'ChildCollapse',
            fields: [
                { name: 'field0', type: 'uint32', count: 1 },
                { name: 'field1', type: 'uint8', count: 2 },
            ],
        };
        const parent: TypeDef = {
            id: 'parent_collapse',
            name: 'ParentCollapse',
            fields: [
                { name: 'field3', type: 'struct', refTypeId: 'child_collapse', count: 1 },
            ],
        };

        S.types = [child, parent];
        S.typeInstances = [{ id: 'pin_collapse', typeId: 'parent_collapse', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topGroup = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp');
        assert.ok(topGroup, 'top composite group should render');
        const topBody = topGroup!.querySelector<HTMLElement>('.oi-arr-grp-body');
        assert.ok(topBody, 'top group body should render');
        assert.strictEqual(topBody!.style.display, 'none', 'top group should be collapsed by default');

        const topExpand = topGroup!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(topExpand, 'top group expand button should render');
        topExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedGroup = topGroup!.querySelector<HTMLElement>('.oi-arr-grp-body .oi-arr-grp');
        assert.ok(nestedGroup, 'nested scalar-array group should render inside parent body');
        const nestedBody = nestedGroup!.querySelector<HTMLElement>('.oi-arr-grp-body');
        assert.ok(nestedBody, 'nested group body should render');
        assert.strictEqual(nestedBody!.style.display, 'none', 'nested composite should remain collapsed by default');
    });

    test('renders scalar type node even when it has only one leaf child', async () => {
        const child: TypeDef = {
            id: 'single_leaf_child',
            name: 'SingleLeafChild',
            fields: [
                { name: 'only', type: 'uint16', count: 1 },
            ],
        };
        const parent: TypeDef = {
            id: 'single_leaf_parent',
            name: 'SingleLeafParent',
            fields: [
                { name: 'wrap', type: 'struct', refTypeId: 'single_leaf_child', count: 1 },
            ],
        };

        S.types = [child, parent];
        S.typeInstances = [{ id: 'pin_single_leaf', typeId: 'single_leaf_parent', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topHeaders = getTopFieldHeaders();
        assert.deepStrictEqual(topHeaders, ['wrap'], 'type field should render as a composite node header even with one leaf child');

        const leafAtTop = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(!leafAtTop.includes('only'), 'child leaf should not render at top level');
    });

    test('supports rendering nested types at max depth with local labels', async () => {
        const level3: TypeDef = {
            id: 'depth_l3',
            name: 'DepthL3',
            fields: [
                { name: 'bytes', type: 'uint8', count: 2 },
            ],
        };
        const level2: TypeDef = {
            id: 'depth_l2',
            name: 'DepthL2',
            fields: [
                { name: 'inner', type: 'struct', refTypeId: 'depth_l3', count: 1 },
            ],
        };
        const level1: TypeDef = {
            id: 'depth_l1',
            name: 'DepthL1',
            fields: [
                { name: 'outer', type: 'struct', refTypeId: 'depth_l2', count: 1 },
            ],
        };

        S.types = [level3, level2, level1];
        S.typeInstances = [{ id: 'pin_depth', typeId: 'depth_l1', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-f-name');
        assert.ok(topHeader, 'top nested type header should render');
        assert.strictEqual(topHeader!.textContent ?? '', 'outer', 'top nested type should use local label');

        const topExpand = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-arr-exp-btn');
        assert.ok(topExpand, 'top nested type expand button should render');
        topExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const innerHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-body .oi-arr-grp-hdr .oi-f-name');
        assert.ok(innerHeader, 'second-level type header should render at max depth boundary');
        assert.strictEqual(innerHeader!.textContent ?? '', 'inner', 'second-level type should use local label');

        const innerExpand = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-body .oi-arr-grp-hdr .oi-arr-exp-btn');
        assert.ok(innerExpand, 'second-level type expand button should render');
        innerExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const bytesHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-body .oi-arr-grp-body .oi-arr-grp-hdr .oi-f-name');
        assert.ok(bytesHeader, 'scalar array at max depth should render as a composite node');
        assert.strictEqual(bytesHeader!.textContent ?? '', 'bytes', 'max-depth scalar array should use local label');
    });

    test('moves array offset from collapsed header to expanded child rows', async () => {
        const def: TypeDef = {
            id: 'array_offset',
            name: 'ArrayOffset',
            fields: [
                { name: 'prefix', type: 'uint8', count: 1 },
                { name: 'values', type: 'uint16', count: 2 },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_array_offset', typeId: 'array_offset', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0x11, 0x22, 0x33, 0x44]);

        await renderPinsAndExpandCard();

        const arrayHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr');
        assert.ok(arrayHeader, 'array header should render');
        assert.strictEqual(arrayHeader!.querySelector<HTMLElement>('.oi-f-off')?.textContent ?? '', '+002', 'collapsed array header should show first element offset');

        const expandArray = arrayHeader!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(expandArray, 'array expand button should render');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandedHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr');
        assert.ok(expandedHeader, 'expanded array header should render');
        assert.strictEqual(expandedHeader!.querySelector<HTMLElement>('.oi-f-off'), null, 'expanded array header should not duplicate child offsets');

        const childOffsets = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-body > .oi-field .oi-f-off'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childOffsets, ['+002', '+004'], 'expanded array children should keep their own offsets');
    });

    test('moves nested type offset from collapsed header to expanded child rows', async () => {
        const child: TypeDef = {
            id: 'nested_offset_child',
            name: 'NestedOffsetChild',
            fields: [
                { name: 'a', type: 'uint8', count: 1 },
                { name: 'b', type: 'uint16', count: 1 },
            ],
        };
        const parent: TypeDef = {
            id: 'nested_offset_parent',
            name: 'NestedOffsetParent',
            fields: [
                { name: 'prefix', type: 'uint8', count: 1 },
                { name: 'node', type: 'struct', refTypeId: 'nested_offset_child', count: 1 },
            ],
        };

        S.types = [child, parent];
        S.typeInstances = [{ id: 'pin_nested_offset', typeId: 'nested_offset_parent', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0x11, 0x22, 0x33]);

        await renderPinsAndExpandCard();

        const typeHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr');
        assert.ok(typeHeader, 'nested type header should render');
        assert.strictEqual(typeHeader!.querySelector<HTMLElement>('.oi-f-off')?.textContent ?? '', '+002', 'collapsed nested type header should show first child offset');

        const expandInstance = typeHeader!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(expandInstance, 'nested type expand button should render');
        expandInstance!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandedHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr');
        assert.ok(expandedHeader, 'expanded nested type header should render');
        assert.strictEqual(expandedHeader!.querySelector<HTMLElement>('.oi-f-off'), null, 'expanded nested type header should not duplicate child offsets');

        const childOffsets = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-body > .oi-field .oi-f-off'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childOffsets, ['+002', '+004'], 'expanded nested type children should keep their own offsets');
    });

    test('renders ascii string field as scalar leaf without collapse node', async () => {
        const def: TypeDef = {
            id: 'str_leaf',
            name: 'StrLeaf',
            fields: [
                { name: 'name', type: 'ascii', count: 8 },
            ],
        };
        const pin: TypeInstance = {
            id: 'pin_str_leaf',
            typeId: 'str_leaf',
            addr: 0,
            name: 'inst',
        };

        S.types = [def];
        S.typeInstances = [pin];

        await renderPinsAndExpandCard();

        const arrNodeNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(!arrNodeNames.includes('name'), 'ascii field should not render as collapsible array node');

        const leafNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(leafNames.includes('name'), 'ascii field should render as leaf field');
    });

    test('ascii field preserves runs of 0x20 spaces in the decoded value', async () => {
        const def = simpleDef('ascii_sp', 'AsciiSp', [
            { name: 'text', type: 'ascii', count: 5 },
        ]);
        S.types = [def];
        S.typeInstances = [{ id: 'pin_ascii_sp', typeId: 'ascii_sp', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x41, 0x20, 0x20, 0x42, 0x20]);
        await renderPinsAndExpandCard();

        const val = document.querySelector<HTMLElement>('.oi-field .oi-f-val[data-val-type="ascii"]');
        assert.ok(val, 'ascii value cell should render');
        assert.strictEqual(val!.textContent, "'A  B '", 'decoded value should keep both 0x20 spaces');

        const css = fs.readFileSync(
            path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'webview', 'components', 'sidebar', 'overlayPanel', 'overlayPanel.css'),
            'utf8',
        );
        const rule = css.match(/\.oi-f-val\[data-val-type="ascii"\]\s*\{([^}]*)\}/);
        assert.ok(rule, 'ascii value rule should exist in overlayPanel.css');
        assert.match(rule![1], /white-space:\s*pre/, 'ascii value rule should declare white-space: pre');
    });

    test('recurses nested type arrays without disambiguation suffix labels', async () => {
        const leaf: TypeDef = {
            id: 'leaf_suffix',
            name: 'LeafSuffix',
            fields: [
                { name: 'field0', type: 'uint8', count: 1 },
            ],
        };
        const mid: TypeDef = {
            id: 'mid_suffix',
            name: 'MidSuffix',
            fields: [
                { name: 'children', type: 'struct', refTypeId: 'leaf_suffix', count: 2 },
            ],
        };
        const top: TypeDef = {
            id: 'top_suffix',
            name: 'TopSuffix',
            fields: [
                { name: 'nodes', type: 'struct', refTypeId: 'mid_suffix', count: 2 },
            ],
        };
        const pin: TypeInstance = {
            id: 'pin_suffix',
            typeId: 'top_suffix',
            addr: 0,
            name: 'inst',
        };

        S.types = [leaf, mid, top];
        S.typeInstances = [pin];

        await renderPinsAndExpandCard();

        const openFirst = (selector: string) => {
            const btn = document.querySelector<HTMLElement>(selector);
            assert.ok(btn, `expand button should exist for ${selector}`);
            btn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        };

        openFirst('.oi-arr-grp-hdr .oi-arr-exp-btn');
        openFirst('.oi-arr-el-hdr .oi-arr-el-exp-btn');
        openFirst('.oi-arr-el-body .oi-arr-grp-hdr .oi-arr-exp-btn');
        openFirst('.oi-arr-el-body .oi-arr-el-hdr .oi-arr-el-exp-btn');

        const labels = Array.from(document.querySelectorAll<HTMLElement>('.oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(!labels.some(label => /#\d+$/.test(label)), 'nested labels should not use disambiguation suffixes');
    });

    test('groups bit fields by storage unit with child rows', async () => {
        const def: TypeDef = {
            id: 'bit_type',
            name: 'BitType',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 2,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
                {
                    name: 'field1',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'bit0', bitWidth: 1 },
                        { name: 'bit1', bitWidth: 1 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bits', typeId: 'bit_type', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topField0 = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp:nth-child(1) > .oi-arr-grp-hdr .oi-f-name');
        assert.ok(topField0, 'array bit-field group should render a top-level header');
        assert.strictEqual(elementText(topField0), 'field0', 'array bit-field group should display the declared field name');

        const topField1 = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp:nth-child(2) > .oi-arr-grp-hdr .oi-f-name');
        assert.ok(topField1, 'second bit-field group should render a top-level header');
        assert.strictEqual(elementText(topField1), 'field1', 'single bit-field group should display the declared field name');

        const unitType = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-hdr .oi-f-type');
        assert.ok(unitType, 'bit-field header should show scalar-like type');
        assert.strictEqual(elementText(unitType), 'u8', 'bit-field header should use base scalar type');

        const unitOffset = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-hdr .oi-f-off');
        assert.ok(unitOffset, 'bit-field header should show scalar-like offset');

        const unitValue = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-hdr .oi-f-val');
        assert.ok(unitValue, 'bit-field unit should show scalar-like value cell');
        assert.strictEqual(unitValue!.dataset.valType, 'bin', 'bit-field parent row should default to binary view');

        const unitExpand = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-hdr .oi-arr-exp-btn');
        assert.ok(unitExpand, 'bit-field unit should be expandable');
        unitExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-el-body .oi-field .oi-f-name'))
            .map(elementText);
        assert.ok(childNames.includes('mode'), 'bit-field child row should contain mode');
        assert.ok(childNames.includes('flags'), 'bit-field child row should contain flags');

        const firstElementHeader = document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-f-name');
        assert.ok(firstElementHeader, 'bit-field array element should render a scalar-like header');
        assert.strictEqual(elementText(firstElementHeader), '[0]', 'bit-field array element header should show its index');

        const firstElementValue = document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-f-val');
        assert.ok(firstElementValue, 'bit-field array element should show a scalar-like value cell');
        assert.strictEqual(firstElementValue!.dataset.valType, 'bin', 'bit-field array element should default to binary view');

        const elementExpand = document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-arr-el-exp-btn');
        assert.ok(elementExpand, 'bit-field array element should be expandable');
        elementExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const selectedBits = document.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr .oi-f-val .oi-bit.sel');
        assert.ok(selectedBits.length === 0, 'array element expansion should not select bits by itself');

        const childRows = document.querySelectorAll<HTMLElement>('.oi-arr-el-body .oi-field');
        assert.ok(childRows.length > 0, 'bit-field array element should expose child bit rows');
    });

    test('clicking non-array bit-field parent selects its storage unit size, not child sum', async () => {
        const def: TypeDef = {
            id: 'bit_parent_size',
            name: 'BitParentSize',
            fields: [
                {
                    name: 'bits',
                    type: 'uint16',
                    count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 4 },
                        { name: 'b', bitWidth: 6 },
                        { name: 'c', bitWidth: 6 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_parent_size', typeId: 'bit_parent_size', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAB, 0xCD]);

        await renderPinsAndExpandCard();

        const parentHdr = document.querySelector<HTMLElement>('.oi-bitunit-hdr');
        assert.ok(parentHdr, 'bit-field parent header should render');
        assert.strictEqual(
            parentHdr!.dataset.byteCnt,
            '2',
            'bit-field parent should span one uint16 storage unit, not the child sum',
        );

        parentHdr!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0, 'clicking bit-field parent should select its storage start');
        assert.strictEqual(S.selEnd, 1, 'clicking bit-field parent should select exactly 2 bytes (uint16), not 6');
    });

    test('uses shared byte order with a local bit-layout toggle', async () => {
        const def: TypeDef = {
            id: 'bit_alloc_toggle',
            name: 'BitAllocToggle',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 3 },
                        { name: 'b', bitWidth: 5 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_alloc_toggle', typeId: 'bit_alloc_toggle', addr: 0x600, name: 'inst' }];
        setBytesInSegment(0x600, [0xB1]);

        const panel = await createMountedPanel();
        const expandCard = document.querySelector<HTMLElement>('.oi-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        S.bitFieldAllocation = 'lsb';
        const toggleGroups = Array.from(document.querySelectorAll<HTMLElement>('.oi-toggle-group'))
            .map(el => el.getAttribute('title') ?? '');
        assert.ok(!toggleGroups.some(title => title.includes('Byte endianness')), 'Overlay must use shared sidebar byte order');
        assert.ok(toggleGroups.some(title => title.includes('Bit-field allocation')), 'bit-field allocation detail should be available on hover');
        assert.strictEqual(S.bitFieldAllocation, 'lsb', 'bit-field allocation should be LSB after explicit set');
        assert.ok(document.getElementById('oa-btn-bit-lsb'), 'LSB bit-field button should render');
        assert.ok(document.getElementById('oa-btn-bit-msb'), 'MSB bit-field button should render');
        assert.strictEqual(document.getElementById('oa-btn-bit-lsb')?.textContent, 'LSB');
        assert.strictEqual(document.getElementById('oa-btn-bit-msb')?.textContent, 'MSB');
        assert.ok(document.getElementById('oa-btn-bit-lsb')?.getAttribute('title')?.includes('least significant bit'), 'LSB button should explain allocation on hover');
        assert.ok(document.getElementById('oa-btn-bit-msb')?.getAttribute('title')?.includes('most significant bit'), 'MSB button should explain allocation on hover');

        const expandBits = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-arr-exp-btn');
        assert.ok(expandBits, 'bit-field parent should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValuesMsb = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start] .oi-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childValuesMsb, ['101', '1 0001'], 'MSB-first should allocate from high bits by default');

        document.getElementById('oa-btn-bit-lsb')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValuesLsb = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start] .oi-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childValuesLsb, ['001', '1 0110'], 'LSB-first should allocate from low bits independently of byte endianness');

        // Host push of a new allocation re-renders (contract parity: setBitFieldAllocation from host).
        panel.setBitFieldAllocation('msb');
        assert.ok(document.getElementById('oa-btn-bit-msb')!.classList.contains('active'));
        const restored = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start] .oi-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(restored, ['101', '1 0001'], 'host push should restore MSB-first allocation');
    });

    test('bit-layout allocation toggle reports persistent changes to the host', async () => {
        const def: TypeDef = {
            id: 'bit_alloc_report',
            name: 'BitAllocReport',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 3 },
                        { name: 'b', bitWidth: 5 },
                    ],
                },
            ],
        };
        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_alloc_report', typeId: 'bit_alloc_report', addr: 0x600, name: 'inst' }];
        S.bitFieldAllocation = 'msb';

        const { OverlayPanel } = await import('../../../../../webview/components/sidebar/overlayPanel/overlayPanel.js');
        const reported: string[] = [];
        const panel = new OverlayPanel({
            readByte: getByte,
            onStateChange: (types, pins) => { S.types = types; S.typeInstances = pins; },
            onBitAllocationChange: alloc => { reported.push(alloc); },
        });
        panel.setData(S.types, S.typeInstances);
        panel.setEndian(S.endian);
        panel.setBitFieldAllocation(S.bitFieldAllocation);
        panel.setTabActive(true);
        panel.mount(document.getElementById('s-overlay')!);

        const expandCard = document.querySelector<HTMLElement>('.oi-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandBits = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-arr-exp-btn');
        assert.ok(expandBits, 'bit-field parent should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        document.getElementById('oa-btn-bit-lsb')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        document.getElementById('oa-btn-bit-msb')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.deepStrictEqual(reported, ['lsb', 'msb'], 'toggle reports each explicit allocation for persistence');
    });

    test('Instances "Show hidden" toggle reports the new value and host push is authoritative', async () => {
        const def: TypeDef = {
            id: 'cfg', name: 'Cfg', fields: [
                { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                { name: 'tag', type: 'uint8', count: 1 },
            ],
        };
        S.types = [def];
        S.typeInstances = [{ id: 'pin_sh', typeId: 'cfg', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00, 0x11]);

        const { OverlayPanel } = await import('../../../../../webview/components/sidebar/overlayPanel/overlayPanel.js');
        const reported: boolean[] = [];
        const panel = new OverlayPanel({
            readByte: getByte,
            onShowHiddenFieldsChange: value => { reported.push(value); },
        });
        panel.setData(S.types, S.typeInstances);
        panel.setTabActive(true);
        panel.mount(document.getElementById('s-overlay')!);
        click(dom, document.querySelector<HTMLElement>('.oi-expand-btn'));

        const names = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > *'))
            .map(el => el.querySelector<HTMLElement>('.oi-f-name')?.textContent ?? '');
        assert.deepStrictEqual(names(), ['tag'], 'hidden field omitted by default');

        const btn = document.getElementById('oi-show-hidden-btn') as HTMLButtonElement;
        assert.ok(btn, 'show-hidden toggle renders in the Instances header');
        assert.strictEqual(btn.getAttribute('aria-pressed'), 'false', 'toggle button starts inactive');
        click(dom, btn);
        assert.strictEqual(btn.getAttribute('aria-pressed'), 'true', 'toggle button reports active state after the click');
        assert.deepStrictEqual(reported, [true], 'toggle reports the new value for persistence');
        assert.deepStrictEqual(names(), ['reserved', 'tag'], 'toggle reveals the hidden field immediately');

        panel.setShowHiddenFields(false);
        assert.deepStrictEqual(names(), ['tag'], 'host push (setShowHiddenFields) is authoritative on refresh');
    });

    test('toggling Show hidden refreshes only the instances and leaves an open editor draft intact', async () => {
        S.types = [scalarDef];
        S.typeInstances = [];
        await createMountedPanel();
        openKindEditor('struct');

        const nameInp = document.getElementById('oe-name') as HTMLInputElement;
        assert.ok(nameInp, 'editor opens');
        nameInp.value = 'EditedButUnsaved';

        setShowHidden(true);

        assert.strictEqual(
            (document.getElementById('oe-name') as HTMLInputElement).value,
            'EditedButUnsaved',
            'the Types editor body is not rebuilt by the instances-only refresh',
        );
    });

    test('toggling Show hidden updates the instances in place (focus + scroll preserved)', async () => {
        const def: TypeDef = {
            id: 'cfg', name: 'Cfg', fields: [
                { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                { name: 'tag', type: 'uint8', count: 1 },
            ],
        };
        S.types = [def];
        S.typeInstances = [{ id: 'pin_inplace', typeId: 'cfg', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00, 0x11]);
        await createMountedPanel();
        click(dom, document.querySelector<HTMLElement>('.oi-expand-btn'));

        const body = document.getElementById('oi-instances-body') as HTMLElement;
        const list = document.getElementById('oi-list') as HTMLElement;
        const btn = document.getElementById('oi-show-hidden-btn') as HTMLButtonElement;
        assert.ok(body && list && btn, 'instances body, list, and toggle render');
        body.scrollTop = 150;
        btn.focus();
        assert.strictEqual(document.activeElement, btn, 'toggle is focused before the click');

        click(dom, btn);

        assert.strictEqual(document.getElementById('oi-show-hidden-btn'), btn, 'toggle node is not rebuilt');
        assert.strictEqual(document.activeElement, btn, 'toggle keeps focus across the in-place refresh');
        assert.strictEqual(document.getElementById('oi-instances-body'), body, 'scroll container is not replaced');
        assert.strictEqual(document.getElementById('oi-list'), list, 'instances list node is reused (only its innerHTML refreshes)');
        assert.strictEqual(body.scrollTop, 150, 'body scroll position survives the refresh');
        assert.deepStrictEqual(
            Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > *'))
                .map(el => el.querySelector<HTMLElement>('.oi-f-name')?.textContent ?? ''),
            ['reserved', 'tag'],
            'hidden field is revealed by the in-place refresh',
        );
    });

    test('renders scalar values using shared byte order', async () => {
        const fields: TypeDef['fields'] = [
            { name: 'u16', type: 'uint16', count: 1 },
            { name: 'i16', type: 'int16', count: 1 },
            { name: 'u32', type: 'uint32', count: 1 },
            { name: 'i32', type: 'int32', count: 1 },
            { name: 'u64', type: 'uint64', count: 1 },
            { name: 'i64', type: 'int64', count: 1 },
            { name: 'f32', type: 'float32', count: 1 },
            { name: 'f64', type: 'float64', count: 1 },
            { name: 'ptr', type: 'pointer', count: 1 },
            { name: 'arr', type: 'uint16', count: 2 },
        ];
        const leBytes = [
            0x34, 0x12, 0xFE, 0xFF, 0x78, 0x56, 0x34, 0x12,
            0xFE, 0xFF, 0xFF, 0xFF, 0x08,0x07,0x06,0x05,0x04,0x03,0x02,0x01,
            0xFE,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0x00, 0x00, 0x80, 0x3F,
            0x00,0x00,0x00,0x00,0x00,0x00,0xF0,0x3F, 0x78, 0x56, 0x34, 0x12,
            0x34, 0x12, 0x78, 0x56,
        ];
        const beBytes = [
            0x12, 0x34, 0xFF, 0xFE, 0x12, 0x34, 0x56, 0x78,
            0xFF, 0xFF, 0xFF, 0xFE, 0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,
            0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFE, 0x3F, 0x80, 0x00, 0x00,
            0x3F,0xF0,0x00,0x00,0x00,0x00,0x00,0x00, 0x12, 0x34, 0x56, 0x78,
            0x12, 0x34, 0x56, 0x78,
        ];

        const renderValues = async (endian: 'le' | 'be', bytes: number[]) => {
            resetOverlayState();
            S.endian = endian;
            const def: TypeDef = {
                id: `scalar_${endian}`,
                name: `Scalar${endian.toUpperCase()}`,
                packed: true,
                fields,
            };
            S.types = [def];
            S.typeInstances = [{ id: `pin_${endian}`, typeId: def.id, addr: 0, name: 'inst' }];
            setBytesInSegment(0, bytes);
            await renderPinsAndExpandCard();
            return Array.from(document.querySelectorAll<HTMLElement>('.oi-field > .oi-f-body > .oi-f-val'))
                .map(el => el.textContent?.replace(/\s+/g, ' ').trim() ?? '');
        };

        const leValues = await renderValues('le', leBytes);
        assert.ok(leValues[0].includes('0x1234'), `u16 LE display: ${leValues[0]}`);
        assert.ok(leValues[1].includes('0xFFFE'), `i16 LE display: ${leValues[1]}`);
        assert.ok(leValues[2].includes('0x12345678'), `u32 LE display: ${leValues[2]}`);
        assert.ok(leValues[3].includes('0xFFFFFFFE'), `i32 LE display: ${leValues[3]}`);
        assert.ok(leValues[4].includes('0x0102030405060708'), `u64 LE display: ${leValues[4]}`);
        assert.ok(leValues[5].includes('0xFFFFFFFFFFFFFFFE'), `i64 LE display: ${leValues[5]}`);
        assert.ok(leValues[6].startsWith('1.000000e+0'), `f32 LE display: ${leValues[6]}`);
        assert.ok(leValues[7].startsWith('1.0000000000000000e+0'), `f64 LE display: ${leValues[7]}`);
        const ptrValueLe = document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.ok(ptrValueLe.includes('0x12345678'), `ptr LE display: ${ptrValueLe}`);
        let firstRow = document.querySelector<HTMLElement>('.oi-field');
        assert.ok(firstRow, 'first scalar row should render');
        firstRow!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        let binItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-bin"]');
        assert.ok(binItem, 'binary view menu item should render');
        binItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        let firstBinary = document.querySelector<HTMLElement>('.oi-field .oi-f-val[data-val-type="bin"]');
        assert.strictEqual(firstBinary?.textContent?.replace(/\s+/g, ' ').trim(), '0001 0010 0011 0100', 'LE binary should display the numeric value bits, not raw memory byte order');
        firstRow = document.querySelector<HTMLElement>('.oi-field');
        firstRow!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const hexItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-hex"]');
        assert.ok(hexItem, 'hex view menu item should render');
        hexItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const beValues = await renderValues('be', beBytes);
        assert.ok(beValues[0].includes('0x1234'), `u16 BE display: ${beValues[0]}`);
        assert.ok(beValues[1].includes('0xFFFE'), `i16 BE display: ${beValues[1]}`);
        assert.ok(beValues[2].includes('0x12345678'), `u32 BE display: ${beValues[2]}`);
        assert.ok(beValues[3].includes('0xFFFFFFFE'), `i32 BE display: ${beValues[3]}`);
        assert.ok(beValues[4].includes('0x0102030405060708'), `u64 BE display: ${beValues[4]}`);
        assert.ok(beValues[5].includes('0xFFFFFFFFFFFFFFFE'), `i64 BE display: ${beValues[5]}`);
        assert.ok(beValues[6].startsWith('1.000000e+0'), `f32 BE display: ${beValues[6]}`);
        assert.ok(beValues[7].startsWith('1.0000000000000000e+0'), `f64 BE display: ${beValues[7]}`);
        const ptrValueBe = document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.ok(ptrValueBe.includes('0x12345678'), `ptr BE display: ${ptrValueBe}`);
        firstRow = document.querySelector<HTMLElement>('.oi-field');
        assert.ok(firstRow, 'first scalar row should render after BE rerender');
        firstRow!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        binItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-bin"]');
        assert.ok(binItem, 'binary view menu item should render after BE rerender');
        binItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        firstBinary = document.querySelector<HTMLElement>('.oi-field .oi-f-val[data-val-type="bin"]');
        assert.strictEqual(firstBinary?.textContent?.replace(/\s+/g, ' ').trim(), '0001 0010 0011 0100', 'BE binary should display the same numeric value bits for the same decoded value');
        S.endian = 'le';
    });

    test('renders typed pointer value and disables follow for unmapped target', async () => {
        setupUnmappedPointerFixture();
        await renderPinsAndExpandCard();
        assertUnmappedPointerRow();
        assertUnmappedPointerMenu(dom);
    });

    test('renders null pointer value with explicit leading status', async () => {
        setupNullPointerFixture();
        await renderPinsAndExpandCard();
        assertNullPointerRow();
    });

    test('renders mapped void pointer as followable storage leaf', async () => {
        setupVoidPointerFixture();
        await renderPinsAndExpandCard();

        const row = assertVoidPointerLeafRow();
        row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const jump = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="jump-ptr"]');
        assert.ok(jump, 'jump pointer command should be enabled for mapped void pointer');
        assert.strictEqual(document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="create-type-ptr"]'), null, 'void pointer should not offer create instance');

        row.querySelector<HTMLElement>('.oi-f-ptr')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0x20);
        assert.strictEqual(S.selEnd, 0x20);
    });

    test('renders legacy pointer type as void pointer storage leaf', async () => {
        setupVoidPointerFixture('pointer');
        await renderPinsAndExpandCard();
        assertVoidPointerLeafRow();
    });

    test('following scalar pointer selects target byte span', async () => {
        const def: TypeDef = {
            id: 'ptr_scalar_follow',
            name: 'PtrScalarFollow',
            packed: true,
            fields: [
                { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            ],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0x34;
        bytes[0x21] = 0x12;
        S.types = [def];
        S.typeInstances = [{ id: 'pin_ptr_scalar_follow', typeId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const row = document.querySelector<HTMLElement>('.oi-ptr-hdr.oi-ptr-field');
        assert.ok(row, 'typed pointer row should render');
        row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0);
        assert.strictEqual(S.selEnd, 3);

        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const jump = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="jump-ptr"]');
        assert.ok(jump, 'jump pointer command should be enabled');
        jump!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        assert.strictEqual(S.selStart, 0x20);
        assert.strictEqual(S.selEnd, 0x21);
    });

    test('scalar pointer target preview renders typed dereference row', async () => {
        setupScalarPointerPreviewFixture();

        await renderPinsAndExpandCard();

        const row = document.querySelector<HTMLElement>('.oi-ptr-hdr.oi-ptr-field');
        assert.ok(row, 'scalar pointer row should render');
        row!.querySelector<HTMLElement>('.oi-arr-exp-btn')!
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assertScalarPointerTargetPreview(row!);
    });

    test('type pointer click jumps without creating destination pin', async () => {
        const header: TypeDef = {
            id: 'header_follow',
            name: 'HeaderFollow',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: TypeDef = {
            id: 'parent_follow',
            name: 'ParentFollow',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refTypeId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.types = [header, parent];
        S.typeInstances = [{ id: 'pin_parent_follow', typeId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const value = document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-f-ptr');
        assert.ok(value, 'type pointer value should render');
        value!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const targetPins = S.typeInstances.filter(pin => pin.typeId === header.id && pin.addr === 0x20);
        assert.strictEqual(targetPins.length, 0, 'jump should not create target instance');
        assert.strictEqual(S.selStart, 0x20);
        assert.strictEqual(S.selEnd, 0x20);
    });

    test('type pointer menu creates or reuses destination pin with source metadata', async () => {
        const header = setupTypePointerFixture({ header: 'header_create', parent: 'parent_create', pin: 'pin_parent_create' });

        await renderPinsAndExpandCard();

        triggerCreateTypeInstance(dom, 'type pointer header should render');

        const targetPin = assertSinglePointerTarget(header.id);
        assertPointerCreateMetadata(targetPin);

        triggerCreateTypeInstance(dom, 'type pointer header should render after create');
        assert.strictEqual(pinsForTarget(header.id, 0x20).length, 1, 'create should reuse existing target pin');
        assert.strictEqual(targetPin.pointerSources?.length, 1, 'duplicate source metadata should not be added');
    });

    test('expanding type pointer decodes target fields inline', async () => {
        const header: TypeDef = {
            id: 'header_inline',
            name: 'HeaderInline',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: TypeDef = {
            id: 'parent_inline',
            name: 'ParentInline',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refTypeId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.types = [header, parent];
        S.typeInstances = [{ id: 'pin_parent_inline', typeId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const expand = document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-arr-exp-btn');
        assert.ok(expand, 'type pointer should render expandable row');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const child = document.querySelector<HTMLElement>('.oi-ptr-hdr + .oi-arr-grp-body .oi-field');
        assert.ok(child, 'expanded pointer should render target child rows inline');
        assert.strictEqual(child!.dataset.byteStart, '32', 'inline child byte start should use target address');
        assert.strictEqual(child!.querySelector<HTMLElement>('.oi-f-off')?.textContent, '+000', 'inline child offset should be relative to target base');
        assert.strictEqual(child!.querySelector<HTMLElement>('.oi-f-name')?.textContent, 'tag');
    });

    test('expanded type pointer header keeps its offset visible', async () => {
        setupOffsetVisiblePointerFixture();
        await renderPinsAndExpandCard();
        assertPointerOffsetVisibleAfterExpand(dom);
    });

    test('renders type pointer arrays with parent and pointer element rows', async () => {
        const node: TypeDef = {
            id: 'ptr_array_node',
            name: 'Node',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: TypeDef = {
            id: 'ptr_array_parent',
            name: 'PtrArrayParent',
            packed: true,
            fields: [{ name: 'nodes', type: 'struct', refTypeId: node.id, isPointer: true, count: 2 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[4] = 0x30;
        bytes[0x20] = 0xAA;
        bytes[0x30] = 0xBB;
        S.types = [node, parent];
        S.typeInstances = [{ id: 'pin_ptr_array_parent', typeId: parent.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const parentHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr');
        assert.ok(parentHeader, 'pointer array parent header should render');
        assert.strictEqual(parentHeader!.querySelector<HTMLElement>('.oi-f-name')?.textContent, 'nodes');
        assert.strictEqual(parentHeader!.querySelector<HTMLElement>('.oi-arr-addr')?.textContent, 'Node*[2]');

        parentHeader!.querySelector<HTMLElement>('.oi-arr-exp-btn')!
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const pointerHeaders = Array.from(document.querySelectorAll<HTMLElement>('.oi-ptr-hdr'));
        assert.strictEqual(pointerHeaders.length, 2, 'expanded pointer array should render pointer element rows');
        assert.deepStrictEqual(pointerHeaders.map(h => h.querySelector<HTMLElement>('.oi-f-name')?.textContent), ['[0]', '[1]']);
        assert.deepStrictEqual(pointerHeaders.map(h => h.querySelector<HTMLElement>('.oi-f-type')?.textContent), ['Node*', 'Node*']);
        assert.deepStrictEqual(pointerHeaders.map(h => h.dataset.byteStart), ['0', '4']);

        pointerHeaders[0].querySelector<HTMLElement>('.oi-arr-exp-btn')!
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const childHeader = pointerHeaders[0]
            .closest<HTMLElement>('.oi-arr-grp')!
            .querySelector<HTMLElement>('.oi-ptr-child-hdr');
        assert.ok(childHeader, 'pointer element should render target preview header');
        assert.ok(childHeader!.querySelector<HTMLElement>('.oi-arr-addr')?.textContent?.includes('Node @ 0x00000020'));
        const child = pointerHeaders[0]
            .closest<HTMLElement>('.oi-arr-grp')!
            .querySelector<HTMLElement>('.oi-arr-grp-body .oi-field');
        assert.strictEqual(child?.querySelector<HTMLElement>('.oi-f-off')?.textContent, '+000');
    });

    test('compacts long type pointer type labels in the data type column', async () => {
        const longName = 'VeryLongTelemetryHeaderType';
        const header: TypeDef = {
            id: 'long_ptr_header',
            name: longName,
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: TypeDef = {
            id: 'long_ptr_parent',
            name: 'LongPtrParent',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refTypeId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x30).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.types = [header, parent];
        S.typeInstances = [{ id: 'pin_long_ptr_parent', typeId: parent.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const typeCell = document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-f-type');
        assert.ok(typeCell, 'type pointer type cell should render');
        assert.strictEqual(typeCell!.textContent, 'VeryL...rType*');
        assert.strictEqual(typeCell!.getAttribute('title'), `${longName}*`);
        assert.strictEqual(typeCell!.getAttribute('aria-label'), `${longName}*`);
    });

    test('nested inline type pointer uses inline source for jump and create', async () => {
        const leaf: TypeDef = {
            id: 'leaf_inline_ptr',
            name: 'LeafInlinePtr',
            fields: [{ name: 'flag', type: 'uint8', count: 1 }],
        };
        const inner: TypeDef = {
            id: 'inner_inline_ptr',
            name: 'InnerInlinePtr',
            packed: true,
            fields: [{ name: 'next', type: 'struct', refTypeId: leaf.id, isPointer: true, count: 1 }],
        };
        const parent: TypeDef = {
            id: 'parent_inline_ptr',
            name: 'ParentInlinePtr',
            packed: true,
            fields: [{ name: 'inner', type: 'struct', refTypeId: inner.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x60).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0x30;
        bytes[0x30] = 0x7F;
        S.types = [leaf, inner, parent];
        S.typeInstances = [{ id: 'pin_parent_inline_ptr', typeId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const expand = document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-arr-exp-btn');
        assert.ok(expand, 'parent type pointer should render expandable row');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const headers = Array.from(document.querySelectorAll<HTMLElement>('.oi-ptr-hdr'));
        assert.strictEqual(headers.length, 2, 'expanded pointer should render nested pointer header');
        const nested = headers[1];
        nested!.querySelector<HTMLElement>('.oi-f-ptr')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0x30);
        assert.strictEqual(S.selEnd, 0x30);

        const nestedChild = nested!
            .closest<HTMLElement>('.oi-arr-grp')!
            .querySelector<HTMLElement>('.oi-arr-grp-body .oi-ptr-child-hdr[data-pointer-allow-create="true"]');
        assert.ok(nestedChild, 'nested type pointer should expose create-enabled child row');
        nestedChild!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const create = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="create-type-ptr"]');
        assert.ok(create, 'nested type pointer should enable create');
        create!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const targetPins = pinsForTarget(leaf.id, 0x30);
        assert.strictEqual(targetPins.length, 1, 'nested create should add leaf target pin once');
        const source = targetPins[0].pointerSources?.[0];
        assert.ok(source, 'nested create should store source metadata');
        assert.strictEqual(source!.sourcePinId, 'pin_parent_inline_ptr');
        assert.strictEqual(source!.sourceTypeId, inner.id);
        assert.strictEqual(source!.sourceFieldPath, 'next');
        assert.strictEqual(source!.pointerStorageAddress, 0x20);
        assert.strictEqual(source!.targetAddress, 0x30);
    });

    test('defaults bit-field parent binary to full storage range', async () => {
        const def: TypeDef = {
            id: 'bit_binary_modes',
            name: 'BitBinaryModes',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'bit0', bitWidth: 1 },
                        { name: 'bit1', bitWidth: 1 },
                        { name: 'bit2', bitWidth: 1 },
                        { name: 'bit3', bitWidth: 1 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_binary_modes', typeId: 'bit_binary_modes', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x33]);

        await renderPinsAndExpandCard();

        const bitHeader = document.querySelector<HTMLElement>('.oi-bitunit-hdr');
        assert.ok(bitHeader, 'bit-field parent header should render');

        const parentValue = bitHeader!.querySelector<HTMLElement>('.oi-f-val');
        assert.ok(parentValue, 'bit-field parent should render a value');
        assert.strictEqual(parentValue!.dataset.valType, 'bin', 'bit-field parent should default to full binary');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00110011', 'full binary should show the complete u8 storage range');

        const labels = openValueMenuLabels(bitHeader!, dom);
        assert.ok(labels.includes('Binary'), 'View as should include full Binary');
        assert.ok(labels.includes('Binary (bit fields only)'), 'View as should include bit-fields-only binary');

        const slicedItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-bin-sliced"]');
        assert.ok(slicedItem, 'sliced binary menu item should render');
        slicedItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const slicedValue = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-f-val');
        assert.ok(slicedValue, 'bit-field parent should rerender after selecting sliced binary');
        assert.strictEqual(slicedValue!.dataset.valType, 'bin-sliced', 'sliced binary should use its own value type');
        assert.strictEqual(slicedValue!.textContent?.replace(/\s+/g, ''), '0011', 'sliced binary should show the declared bit range as one value');

        const parentExpand = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-arr-exp-btn');
        assert.ok(parentExpand, 'bit-field parent should be expandable');
        parentExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValues = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start] .oi-f-val'));
        assert.ok(childValues.length >= 2, 'bit-field child rows should render after expanding parent');
        assert.ok(childValues.every(el => el.dataset.valType === 'bin'), 'changing bit-field parent view should not change child row views');

        const firstChild = document.querySelector<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start]');
        assert.ok(firstChild, 'first bit-field child should render');
        firstChild!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));

        const childDecItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-dec"]');
        assert.ok(childDecItem, 'bit-field child decimal menu item should render');
        childDecItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const parentAfterChildChange = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-f-val');
        assert.ok(parentAfterChildChange, 'bit-field parent should still render after changing a child');
        assert.strictEqual(parentAfterChildChange!.dataset.valType, 'bin-sliced', 'changing a bit-field child should not change parent view');

        const childValuesAfterChange = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start] .oi-f-val'));
        assert.strictEqual(childValuesAfterChange[0]?.dataset.valType, 'dec', 'changing a bit-field child should affect that child');
        assert.strictEqual(childValuesAfterChange[1]?.dataset.valType, 'bin', 'changing a bit-field child should not affect sibling children');
    });

    test('omits sliced binary when bit fields fill parent storage', async () => {
        const def: TypeDef = {
            id: 'bit_full_range_menu',
            name: 'BitFullRangeMenu',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'lo', bitWidth: 4 },
                        { name: 'hi', bitWidth: 4 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_full_range_menu', typeId: 'bit_full_range_menu', addr: 0x200, name: 'inst' }];
        setBytesInSegment(0x200, [0x33]);

        await renderPinsAndExpandCard();

        const bitHeader = document.querySelector<HTMLElement>('.oi-bitunit-hdr');
        assert.ok(bitHeader, 'bit-field parent header should render');
        const labels = openValueMenuLabels(bitHeader!, dom);
        assert.ok(labels.includes('Binary'), 'View as should include full Binary');
        assert.ok(!labels.includes('Binary (bit fields only)'), 'View as should omit bit-fields-only binary when it matches full range');
    });

    test('copies bit-field parent and child values from the clicked row', async () => {
        const writes = captureClipboardWrites();

        const def: TypeDef = {
            id: 'bit_copy_rows',
            name: 'BitCopyRows',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 2 },
                        { name: 'b', bitWidth: 3 },
                        { name: 'c', bitWidth: 3 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_copy_rows', typeId: 'bit_copy_rows', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xB1]);

        await renderPinsAndExpandCard();

        const parent = document.querySelector<HTMLElement>('.oi-bitunit-hdr');
        assert.ok(parent, 'bit-field parent should render');
        parent!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const parentCopyHex = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="copy-hex"]');
        assert.ok(parentCopyHex, 'parent copy hex item should render');
        parentCopyHex!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(writes.pop(), '0xB1', 'parent copy should use the aggregate storage value');

        const expandParent = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-arr-exp-btn');
        assert.ok(expandParent, 'bit-field parent should be expandable');
        expandParent!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const children = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start]'));
        assert.strictEqual(children.length, 3, 'three bit-field children should render');
        children[1]!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const childCopyDec = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="copy-dec"]');
        assert.ok(childCopyDec, 'child copy decimal item should render');
        childCopyDec!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(writes.pop(), '6', 'child copy should use the clicked bit-field child value');
    });

    test('copies every overlay value format as a single line', async () => {
        const writes = captureClipboardWrites();
        const def: TypeDef = {
            id: 'single_line_copy',
            name: 'SingleLineCopy',
            fields: [
                { name: 'wide', type: 'uint64', count: 1 },
                { name: 'flt', type: 'float32', count: 1 },
                { name: 'text', type: 'ascii', count: 4 },
                {
                    name: 'flags',
                    type: 'uint32',
                    count: 1,
                    bitFields: [
                        { name: 'top', bitWidth: 5 },
                        { name: 'mid', bitWidth: 7 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_single_line_copy', typeId: 'single_line_copy', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF,
            0x00, 0x00, 0x80, 0x3F,
            0x41, 0x0A, 0x42, 0x43,
            0x12, 0x34, 0x56, 0x78,
        ]);

        await renderPinsAndExpandCard();

        const copyFromRow = (row: HTMLElement, cmd: string): string => {
            row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
            const item = document.querySelector<HTMLElement>(`.oi-field-menu .menu-item[data-cmd="${cmd}"]`);
            assert.ok(item, `${cmd} menu item should render`);
            item!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
            const copied = writes.pop();
            assert.ok(copied !== undefined, `${cmd} should write to clipboard`);
            assert.ok(!/[\r\n]/.test(copied!), `${cmd} should copy a single line`);
            return copied!;
        };

        const rows = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-field'));
        assert.ok(rows.length >= 3, 'scalar rows should render');
        assert.strictEqual(
            copyFromRow(rows[0]!, 'copy-bin'),
            '1110 1111 1100 1101 1010 1011 1000 1001 0110 0111 0100 0101 0010 0011 0000 0001',
            'wide binary copy should flatten wrapped binary groups',
        );
        assert.strictEqual(
            copyFromRow(rows[1]!, 'copy-ieee'),
            'sign: 0; exponent: 0x7F; mantissa: 0x000000; class: normal',
            'IEEE copy should remain a single-line summary',
        );
        assert.strictEqual(
            copyFromRow(rows[2]!, 'copy-ascii'),
            'A.BC',
            'ASCII copy should replace non-printable bytes instead of copying line breaks',
        );

        const bitParent = document.querySelector<HTMLElement>('.oi-bitunit-hdr');
        assert.ok(bitParent, 'bit-field parent should render');
        assert.strictEqual(
            copyFromRow(bitParent!, 'copy-bin'),
            '0111 1000 0101 0110 0011 0100 0001 0010',
            'bit-field parent full binary copy should be single-line',
        );
        assert.strictEqual(
            copyFromRow(bitParent!, 'copy-bin-sliced'),
            '0111 1000 0101',
            'bit-fields-only binary copy should be single-line',
        );
    });

    test('wraps wide bit-field parent binary like scalar binary values', async () => {
        const def: TypeDef = {
            id: 'wide_bit_parent_binary',
            name: 'WideBitParentBinary',
            fields: [
                {
                    name: 'flags',
                    type: 'uint32',
                    count: 1,
                    bitFields: [
                        { name: 'lo', bitWidth: 4 },
                        { name: 'hi', bitWidth: 4 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_wide_bit_parent_binary', typeId: 'wide_bit_parent_binary', addr: 0x500, name: 'inst' }];
        setBytesInSegment(0x500, [0x12, 0x34, 0x56, 0x78]);

        await renderPinsAndExpandCard();

        const parentValue = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-f-val[data-val-type="bin"]');
        assert.ok(parentValue, 'wide bit-field parent should render full binary by default');
        assert.strictEqual(parentValue!.querySelectorAll('br').length, 1, 'uint32 bit-field parent binary should wrap after 16 bits');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '01111000010101100011010000010010', 'wide bit-field parent binary should follow shared byte order');

        const expandBits = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-arr-exp-btn');
        assert.ok(expandBits, 'wide bit-field parent should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const firstChild = document.querySelector<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start]');
        assert.ok(firstChild, 'wide bit-field child row should render');
        firstChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const selectedBits = Array.from(document.querySelectorAll<HTMLElement>('.oi-bitunit-hdr .oi-f-val[data-val-type="bin"] .oi-bit.sel'));
        assert.strictEqual(selectedBits.length, 4, 'selecting a wide bit-field child should highlight its bits on the wrapped parent value');
        assert.deepStrictEqual(
            selectedBits.map(el => el.dataset.bitIdx).sort(),
            ['0', '1', '2', '3'],
            'wrapped parent binary highlight should preserve bit indexes across lines',
        );
    });

    test('groups bit-field child binary from lower bits first', async () => {
        const def: TypeDef = {
            id: 'bit_child_binary_grouping',
            name: 'BitChildBinaryGrouping',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'wide', bitWidth: 5 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_child_binary_grouping', typeId: 'bit_child_binary_grouping', addr: 0x300, name: 'inst' }];
        setBytesInSegment(0x300, [0x00]);

        await renderPinsAndExpandCard();

        const parentExpand = document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-arr-exp-btn');
        assert.ok(parentExpand, 'bit-field parent should be expandable');
        parentExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValue = document.querySelector<HTMLElement>('.oi-arr-grp-body .oi-field[data-bit-start] .oi-f-val');
        assert.ok(childValue, 'bit-field child value should render');
        assert.strictEqual(childValue!.textContent, '0 0000', 'bit-field child binary should keep the lower four bits packed together');
    });

    test('array header view changes direct bit-field elements only', async () => {
        const def: TypeDef = {
            id: 'bit_array_view_scope',
            name: 'BitArrayViewScope',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 2,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_array_view_scope', typeId: 'bit_array_view_scope', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x33, 0x55]);

        await renderPinsAndExpandCard();

        const arrayHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr');
        assert.ok(arrayHeader, 'bit-field array header should render');
        arrayHeader!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));

        const hexItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-hex"]');
        assert.ok(hexItem, 'array header hex menu item should render');
        hexItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandArray = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-arr-exp-btn');
        assert.ok(expandArray, 'bit-field array should be expandable');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const elementValues = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-el-hdr.oi-bitunit-hdr .oi-f-val'));
        assert.strictEqual(elementValues.length, 2, 'bit-field array should render two direct element aggregate values');
        assert.ok(elementValues.every(el => el.dataset.valType === 'hex'), 'array header view should change direct bit-field element parents');

        const expandFirstElement = document.querySelector<HTMLElement>('.oi-arr-el-hdr.oi-bitunit-hdr .oi-arr-el-exp-btn');
        assert.ok(expandFirstElement, 'bit-field array element should be expandable');
        expandFirstElement!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValues = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-el-body .oi-field[data-bit-start] .oi-f-val'));
        assert.ok(childValues.length > 0, 'bit-field array element should render child bit rows');
        assert.ok(childValues.every(el => el.dataset.valType === 'bin'), 'array header view should not change nested bit-field children');
    });

    test('highlights array bit-field parent bits and selected child row', async () => {
        const def: TypeDef = {
            id: 'bit_array_highlight',
            name: 'BitArrayHighlight',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 2,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_bit_array_highlight', typeId: 'bit_array_highlight', addr: 0x100, name: 'inst' }];
        setBytesInSegment(0x100, [0x33, 0x55]);

        await renderPinsAndExpandCard();

        const expandArray = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-arr-exp-btn');
        assert.ok(expandArray, 'bit-field array should be expandable');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandFirstElement = document.querySelector<HTMLElement>('.oi-arr-el-hdr.oi-bitunit-hdr .oi-arr-el-exp-btn');
        assert.ok(expandFirstElement, 'bit-field array element should be expandable');
        expandFirstElement!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const firstChild = document.querySelector<HTMLElement>('.oi-arr-el-body .oi-field[data-bit-start]');
        assert.ok(firstChild, 'bit-field child row should render');

        firstChild!.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
        const hoveredBits = document.querySelectorAll<HTMLElement>('.oi-arr-el-hdr.oi-bitunit-hdr .oi-f-val .oi-bit.hov');
        assert.ok(hoveredBits.length > 0, 'hovering array bit-field child should highlight bits in the element parent value');

        firstChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.ok(firstChild!.classList.contains('oi-selected'), 'selecting bit-field child should highlight the child row');

        const selectedBits = document.querySelectorAll<HTMLElement>('.oi-arr-el-hdr.oi-bitunit-hdr .oi-f-val .oi-bit.sel');
        assert.ok(selectedBits.length > 0, 'selecting array bit-field child should highlight bits in the element parent value');
    });

    test('renders nested bit-field arrays with declared field names', async () => {
        const child: TypeDef = {
            id: 'child_bits',
            name: 'ChildBits',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 2,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
                { name: 'payload', type: 'uint8', count: 2 },
            ],
        };
        const parent: TypeDef = {
            id: 'parent_bits',
            name: 'ParentBits',
            fields: [
                { name: 'nodes', type: 'struct', refTypeId: 'child_bits', count: 2 },
            ],
        };

        S.types = [child, parent];
        S.typeInstances = [{ id: 'pin_nested_bits', typeId: 'parent_bits', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const parentGroupExpand = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-exp-btn');
        assert.ok(parentGroupExpand, 'nested type array group should be expandable');
        parentGroupExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const elementExpand = document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-arr-el-exp-btn');
        assert.ok(elementExpand, 'nested type array element should be expandable');
        elementExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedBitGroup = document.querySelector<HTMLElement>('.oi-arr-el-body .oi-arr-grp-hdr .oi-f-name');
        assert.ok(nestedBitGroup, 'nested bit-field group should render a header');
        assert.strictEqual(nestedBitGroup!.textContent ?? '', 'field0', 'nested bit-field group should show the declared field name');

        const nestedBitExpand = document.querySelector<HTMLElement>('.oi-arr-el-body .oi-arr-grp .oi-arr-exp-btn');
        assert.ok(nestedBitExpand, 'nested bit-field group should be expandable');
        nestedBitExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedElementNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-el-body .oi-arr-el-hdr .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(nestedElementNames.includes('[0]'), 'nested bit-field array should show element index [0]');
        assert.ok(nestedElementNames.includes('[1]'), 'nested bit-field array should show element index [1]');

        const nestedChildNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-el-body .oi-arr-el-body .oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(nestedChildNames.includes('mode'), 'nested bit-field child row should contain mode');
        assert.ok(nestedChildNames.includes('flags'), 'nested bit-field child row should contain flags');
        assert.ok(!nestedChildNames.includes('BitField'), 'nested bit-field groups should not use synthetic labels');
    });

    test('renders nested single bit-field groups like top-level bit-field groups', async () => {
        S.types = nestedSingleBitFieldTypes();
        S.typeInstances = [{ id: 'pin_nested_single_bits', typeId: 'parent_single_bits', addr: 0x40, name: 'inst' }];
        setBytesInSegment(0x40, [0x0B]);

        await renderPinsAndExpandCard();

        const expandNode = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-hdr .oi-arr-exp-btn');
        assert.ok(expandNode, 'nested type node should be expandable');
        expandNode!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedBitHeader = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-body > .oi-arr-grp > .oi-bitunit-hdr');
        assertNestedSingleBitFieldHeader(nestedBitHeader);

        assertNestedSingleBitFieldValue(nestedBitHeader!);

        const expandBits = nestedBitHeader!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(expandBits, 'nested bit-field group should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        assertNestedSingleBitFieldChildren();
    });

    function assertNestedSingleBitFieldHeader(nestedBitHeader: HTMLElement | null): void {
        assert.ok(nestedBitHeader, 'nested single bit-field group should use the scalar-like bit-field header');
        const header = nestedBitHeader as HTMLElement;
        assert.strictEqual(requiredText(header, '.oi-f-name'), 'control', 'nested bit-field header should use declared field name');
        assert.strictEqual(requiredText(header, '.oi-f-off'), '+000', 'nested bit-field header should show its byte offset');
        assert.strictEqual(requiredText(header, '.oi-f-type'), 'u8', 'nested bit-field header should show the base scalar type');
    }

    function requiredText(root: HTMLElement, selector: string): string {
        return root.querySelector<HTMLElement>(selector)?.textContent ?? '';
    }

    function assertNestedSingleBitFieldValue(nestedBitHeader: HTMLElement): void {
        const parentValue = nestedBitHeader.querySelector<HTMLElement>('.oi-f-val');
        assert.ok(parentValue, 'nested bit-field parent should show an aggregate value');
        assert.strictEqual(parentValue!.dataset.valType, 'bin', 'nested bit-field parent should default to full binary');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00001011', 'nested bit-field parent should show full storage binary');
    }

    function assertNestedSingleBitFieldChildren(): void {
        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp > .oi-arr-grp-body .oi-field[data-bit-start] .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(childNames.includes('mode'), 'nested bit-field child row should contain mode');
        assert.ok(childNames.includes('enabled'), 'nested bit-field child row should contain enabled');
    }

    function nestedSingleBitFieldTypes(): TypeDef[] {
        const child: TypeDef = {
            id: 'child_single_bits',
            name: 'ChildSingleBits',
            fields: [
                {
                    name: 'control',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'enabled', bitWidth: 1 },
                    ],
                },
            ],
        };
        const parent: TypeDef = {
            id: 'parent_single_bits',
            name: 'ParentSingleBits',
            fields: [
                { name: 'node', type: 'struct', refTypeId: 'child_single_bits', count: 1 },
            ],
        };
        return [child, parent];
    }

    test('keeps scalar arrays separate from bit-field groups', async () => {
        const def: TypeDef = {
            id: 'mixed_bits',
            name: 'MixedBits',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 2,
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
                { name: 'data', type: 'uint8', count: 3 },
                {
                    name: 'field1',
                    type: 'uint8',
                    count: 1,
                    bitFields: [
                        { name: 'bit0', bitWidth: 1 },
                        { name: 'bit1', bitWidth: 1 },
                    ],
                },
            ],
        };

        S.types = [def];
        S.typeInstances = [{ id: 'pin_mixed_bits', typeId: 'mixed_bits', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topHeaders = getTopFieldHeaders();
        assert.deepStrictEqual(topHeaders, ['field0', 'data', 'field1'], 'mixed sibling groups should keep their declared order and names');

        const dataGroup = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp:nth-child(2)');
        assert.ok(dataGroup, 'scalar array group should render at the top level');
        const dataExpand = dataGroup!.querySelector<HTMLElement>('.oi-arr-exp-btn');
        assert.ok(dataExpand, 'scalar array group should be expandable');
        dataExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const scalarArrayNames = Array.from(dataGroup!.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(scalarArrayNames.includes('[0]'), 'scalar array should keep index-only child labels');
        assert.ok(scalarArrayNames.includes('[1]'), 'scalar array should keep index-only child labels');
        assert.ok(scalarArrayNames.includes('[2]'), 'scalar array should keep index-only child labels');
        assert.ok(!scalarArrayNames.includes('BitField'), 'scalar arrays should not be reclassified as bit-field groups');
    });

    // ── Contract-folded assertions (formerly the codec suite) ───────────────

    test('renders pane-view sections with empty states', async () => {
        await createMountedPanel();
        const view = document.querySelector('#s-overlay > .sb-pane-view')!;
        assert.ok(view, 'sections live in a .sb-pane-view split container');
        const sections = view.querySelectorAll('.sb-section');
        assert.strictEqual(sections.length, 2);
        assert.strictEqual(sections[0].id, 'oi-instances');
        assert.strictEqual(sections[1].id, 'oi-types');
        assert.strictEqual(view.querySelectorAll('.sb-pane-sash').length, 1, 'one sash between the two panes');
        const instancesHead = document.querySelector<HTMLElement>('#oi-instances .sb-section-head')!;
        const typesHead = document.querySelector<HTMLElement>('#oi-types .sb-section-head')!;
        assert.strictEqual(typesHead.getAttribute('role'), 'button');
        assert.strictEqual(typesHead.getAttribute('aria-expanded'), 'true');
        assert.ok(typesHead.querySelector('.sb-section-chevron'));
        assert.ok(!document.getElementById('oi-types')!.classList.contains('collapsed'), 'types section should default open');
        // All sections are collapsible now — instances is a full disclosure header too.
        assert.strictEqual(instancesHead.getAttribute('role'), 'button');
        assert.strictEqual(instancesHead.getAttribute('aria-expanded'), 'true');
        assert.ok(instancesHead.querySelector('.sb-section-chevron'));
        assert.match(document.getElementById('oi-instances')!.textContent!, /Define a type first/);
        assert.strictEqual(document.querySelector('#oi-types .sb-empty')?.textContent, 'No types defined yet.');
        assert.strictEqual(document.getElementById('oi-types-btn'), null, 'no hamburger manage-types control');
        assert.strictEqual(document.getElementById('oi-track'), null, 'no slide-track container');
    });

    test('mount is idempotent: re-mount into the same root re-renders without errors', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin2', typeId: 'scalar', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12]);
        const panel = await createMountedPanel();
        panel.mount(document.getElementById('s-overlay')!);
        assert.ok(document.querySelector('.sb-card'));
        assert.strictEqual(document.querySelectorAll('.sb-card').length, 1);
    });

    test('re-mount registers no additional document click listener (no handler stacking)', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin3', typeId: 'scalar', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12]);
        let docClickCount = 0;
        const origAdd = document.addEventListener.bind(document);
        document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
            if (type === 'click') { docClickCount++; }
            return origAdd(type, listener as EventListenerOrEventListenerObject, options);
        }) as typeof document.addEventListener;
        try {
            await createMountedPanel();
            const afterFirstMount = docClickCount;
            await createMountedPanel(); // full-shell re-mount into the same root
            assert.strictEqual(docClickCount, afterFirstMount, 're-mount must not stack document click listeners');
        } finally {
            document.addEventListener = origAdd;
        }
    });

    test('setData renders instance cards; expansion persists across re-render', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12]);
        const panel = await createMountedPanel();
        assert.strictEqual(document.querySelector('.oi-cname')?.textContent, 'inst');
        assert.ok(document.querySelector('.oi-ctype')?.textContent?.includes('Scalar'));

        click(dom, document.querySelector('.oi-expand-btn'));
        assert.strictEqual(document.querySelector('.oi-field .oi-f-name')?.textContent, 'count');
        assert.match(elementText(document.querySelector('.oi-field .oi-f-val')!), /0x1234/);
        assert.ok(!document.getElementById('oi-types')!.classList.contains('collapsed'), 'types should stay expanded by default');

        panel.render();
        assert.ok(document.querySelector('.sb-card')?.classList.contains('oi-expanded'), 'card expansion survives re-render');
        assert.strictEqual(document.querySelector('.oi-field .oi-f-name')?.textContent, 'count');
    });

    test('row click selects the decoded range and paints the row selected', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12]);
        await renderPinsAndExpandCard();
        const row = document.querySelector<HTMLElement>('.oi-field');
        assert.ok(row, 'decoded row should render');
        click(dom, row);
        assert.strictEqual(S.selStart, 0);
        assert.strictEqual(S.selEnd, 1);
        assert.ok(row!.classList.contains('oi-selected'));
    });

    test('setEndian re-decodes scalar values live', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12]);
        const panel = await createMountedPanel();
        click(dom, document.querySelector('.oi-expand-btn'));
        assert.match(elementText(document.querySelector('.oi-field .oi-f-val')!), /0x1234/);
        panel.setEndian('be');
        assert.match(elementText(document.querySelector('.oi-field .oi-f-val')!), /0x3412/);
    });

    test('＋ Add opens a three-tile kind picker; cancel creates nothing', async () => {
        await createMountedPanel();

        // The standalone bit-field / enum actions from the child tasks are gone.
        assert.strictEqual(document.getElementById('om-add-bitfield-btn'), null, 'no standalone bit-field action');
        assert.strictEqual(document.getElementById('om-add-enum-btn'), null, 'no standalone enum action');

        click(dom, document.getElementById('om-add-btn'));
        const picker = document.getElementById('om-kind-picker');
        assert.ok(picker, 'kind picker should render in the Types body');
        const tiles = Array.from(picker!.querySelectorAll<HTMLElement>('.om-kind-tile'));
        assert.deepStrictEqual(tiles.map(t => t.dataset.kind), ['struct', 'bitfield', 'enum'], 'three kind tiles');
        assert.strictEqual(document.getElementById('oe-name'), null, 'no editor opens before a tile is picked');
        assert.strictEqual(document.getElementById('om-list'), null, 'the type list is replaced by the picker');

        click(dom, document.getElementById('om-kind-cancel'));
        assert.strictEqual(document.getElementById('om-kind-picker'), null, 'cancel returns to the list');
        assert.ok(document.getElementById('om-list'), 'cancel shows the type list again');
        assert.strictEqual(S.types.length, 0, 'cancel creates nothing');
    });

    test('each kind tile opens that kind’s own form', async () => {
        await createMountedPanel();

        openKindPicker();
        click(dom, document.querySelector<HTMLElement>('.om-kind-tile[data-kind="struct"]'));
        assert.ok(document.querySelector('.oe-field-hdr'), 'Struct tile opens the field grid');
        assert.strictEqual(document.getElementById('oe-base-type'), null, 'type form has no bit-field base select');

        click(dom, document.getElementById('oe-cancel'));
        openKindEditor('bitfield');
        assert.ok(document.getElementById('oe-base-type'), 'Bit-field tile opens the base width select');
        assert.strictEqual(document.querySelector('.field-row'), null, 'bit-field form has no type field grid');

        click(dom, document.getElementById('oe-cancel'));
        openKindEditor('enum');
        assert.ok(document.getElementById('oe-enum-base-type'), 'Enum tile opens the enum base width select');
        assert.strictEqual(document.querySelector('.field-row'), null, 'enum form has no type field grid');
    });

    test('new type editor saves and renders C preview', async () => {
        await createMountedPanel();
        openKindEditor('struct');
        assert.ok(document.getElementById('oe-name'));
        assert.ok(document.getElementById('oe-preview'));

        (document.getElementById('oe-name') as HTMLInputElement).value = 'MyNewType';
        const preview = document.querySelector<HTMLElement>('#oe-preview pre.oi-c-preview');
        assert.ok(preview && preview.textContent!.length > 0, 'C preview should render');

        click(dom, document.getElementById('oe-save'));
        assert.strictEqual(S.types.length, 1);
        assert.strictEqual(S.types[0].name, 'MyNewType');
        assert.strictEqual(S.types[0].fields.length, 1);
    });

    test('delete type cascades dependent pins via state sync', async () => {
        S.types = [childDef, parentDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'parent', addr: 0, name: 'inst' }];
        await createMountedPanel();
        const delBtn = document.querySelector<HTMLElement>('.od-row .act-btn-del[data-type-id="parent"]');
        assert.ok(delBtn, 'type row delete button should render');
        click(dom, delBtn);
        confirmDelete(dom);
        // Flush the inline-confirm popover's deferred listener timer before teardown.
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(S.types.map(d => d.id), ['child']);
        assert.deepStrictEqual(S.typeInstances, []);
    });

    test('add form confirms a new pin', async () => {
        S.types = [scalarDef];
        S.typeInstances = [];
        await createMountedPanel();
        click(dom, document.getElementById('oi-add-btn'));
        const nameInp = document.getElementById('oa-name') as HTMLInputElement | null;
        const addrInp = document.getElementById('oa-addr') as HTMLInputElement | null;
        assert.ok(nameInp && addrInp, 'add form inputs should render');
        nameInp!.value = 'newInst';
        addrInp!.value = '00001000';
        click(dom, document.getElementById('oa-confirm'));
        assert.strictEqual(S.typeInstances.length, 1);
        assert.strictEqual(S.typeInstances[0].typeId, 'scalar');
        assert.strictEqual(S.typeInstances[0].addr, 0x1000);
        assert.strictEqual(S.typeInstances[0].name, 'newInst');
    });

    test('setSelection fills the open add-form address', async () => {
        S.types = [scalarDef];
        S.typeInstances = [];
        const panel = await createMountedPanel();
        click(dom, document.getElementById('oi-add-btn'));
        panel.setSelection(0x2000);
        assert.strictEqual((document.getElementById('oa-addr') as HTMLInputElement).value, '00002000');
    });

    test('edit form save updates the pin via inline add form', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        await createMountedPanel();
        click(dom, document.querySelector('.sb-card .act-btn-edit'));
        assert.ok(document.getElementById('oi-add-form'), 'inline edit form should open');
        assert.strictEqual((document.getElementById('oa-name') as HTMLInputElement).value, 'inst', 'name prefilled');
        assert.strictEqual((document.getElementById('oa-addr') as HTMLInputElement).value, '00000000', 'addr prefilled');
        (document.getElementById('oa-name') as HTMLInputElement).value = 'renamed';
        (document.getElementById('oa-addr') as HTMLInputElement).value = '00001111';
        click(dom, document.getElementById('oa-confirm'));
        assert.strictEqual(S.typeInstances[0].name, 'renamed');
        assert.strictEqual(S.typeInstances[0].addr, 0x1111);
        assert.strictEqual(document.getElementById('oi-add-form'), null, 'form should close after save');
    });

    test('instance card always-visible actions: view-type, edit cancel', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        await createMountedPanel();

        const card = document.querySelector<HTMLElement>('.sb-card');
        assert.ok(card, 'card should render');
        assert.ok(card!.querySelector('.act-btn-edit'), 'edit action always present');
        assert.ok(card!.querySelector('.act-btn-del'), 'delete action always present');
        assert.ok(card!.querySelector('.act-btn-view-type'), 'view-type action always present');
        assert.strictEqual(card!.querySelector('.oi-card-menu'), null, 'no ⋮ menu');
        assert.strictEqual(document.querySelector('.oi-type-btn'), null, 'no hover-only type button on card');

        // View type toggles the card preview.
        click(dom, card!.querySelector('.act-btn-view-type'));
        const preview = document.querySelector<HTMLElement>('.oi-type-preview');
        assert.ok(preview && preview!.style.display !== 'none', 'view-type should reveal the C preview');
        click(dom, card!.querySelector('.act-btn-view-type'));
        assert.ok(document.querySelector<HTMLElement>('.oi-type-preview')!.style.display === 'none', 'view-type should toggle the preview closed');

        // Edit opens the inline form; cancel closes without mutating.
        click(dom, card!.querySelector('.act-btn-edit'));
        assert.ok(document.getElementById('oi-add-form'), 'edit should open the inline form');
        click(dom, document.getElementById('oa-cancel'));
        assert.strictEqual(document.getElementById('oi-add-form'), null, 'cancel should close the form');
        assert.strictEqual(S.typeInstances[0].name, 'inst', 'cancel should not mutate the pin');
    });

    test('delete pin removes it via card action', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        await createMountedPanel();
        click(dom, document.querySelector('.sb-card .act-btn-del'));
        confirmDelete(dom);
        // Flush the inline-confirm popover's deferred listener timer before teardown.
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(S.typeInstances, []);
    });

    test('types section header handles click and keyboard collapse', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        await createMountedPanel();
        const head = document.querySelector<HTMLElement>('#oi-types .sb-section-head')!;
        click(dom, head);
        assert.ok(document.getElementById('oi-types')!.classList.contains('collapsed'));
        assert.strictEqual(head.getAttribute('aria-expanded'), 'false');
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        assert.ok(!document.getElementById('oi-types')!.classList.contains('collapsed'));
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        assert.ok(document.getElementById('oi-types')!.classList.contains('collapsed'));
        head.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.ok(!document.getElementById('oi-types')!.classList.contains('collapsed'));
        assert.ok(document.querySelector('.od-row'));
    });

    test('editor field rows expose pointer via visible toggle button and context menu', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        await createMountedPanel();
        openKindEditor('struct');
        let row = document.querySelector<HTMLElement>('.field-row');
        assert.ok(row, 'editor field row should render');
        const ptrBtn = row!.querySelector<HTMLElement>('.ofe-ptr-btn');
        assert.ok(ptrBtn, 'every field row renders the visible pointer toggle button');
        assert.ok(!ptrBtn!.classList.contains('active'), 'field pointer button starts inactive');
        assert.strictEqual((ptrBtn as HTMLButtonElement).disabled, false, 'scalar field pointer button is enabled');

        // Context menu path still works alongside the visible button.
        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const attach = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="field-ptr-on"]');
        assert.ok(attach, 'attach pointer item should render');
        click(dom, attach);

        // Re-query the row after each render (re-render replaces the editor rows).
        row = document.querySelector<HTMLElement>('.field-row');
        assert.ok(row, 'editor field row should re-render');
        assert.ok(row!.querySelector<HTMLElement>('.ofe-ptr-btn')!.classList.contains('active'), 'attaching via context menu activates the row button');
        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const clear = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="field-ptr-off"]');
        assert.ok(clear, 'clear pointer item should render once attached');
        click(dom, clear);

        // Attach again, then save and verify the draft is saved as a pointer field.
        row = document.querySelector<HTMLElement>('.field-row');
        assert.ok(!row!.querySelector<HTMLElement>('.ofe-ptr-btn')!.classList.contains('active'), 'clearing via context menu deactivates the row button');
        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        click(dom, document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="field-ptr-on"]'));
        (document.getElementById('oe-name') as HTMLInputElement).value = 'PtrType';
        click(dom, document.getElementById('oe-save'));
        const saved = S.types.find(d => d.name === 'PtrType');
        assert.ok(saved, 'saved type should exist');
        assert.strictEqual(saved!.fields[0].isPointer, true, 'saved field should be a pointer');
    });

    test('pointer row button toggles field pointer on click and persists on save', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        await createMountedPanel();
        openKindEditor('struct');
        (document.getElementById('oe-name') as HTMLInputElement).value = 'BtnPtr';

        let row = document.querySelector<HTMLElement>('.field-row');
        assert.ok(row, 'editor field row should render');
        // Click ON: button activates and the pointer flag lands in the saved type.
        click(dom, row!.querySelector<HTMLElement>('.ofe-ptr-btn'));
        row = document.querySelector<HTMLElement>('.field-row');
        assert.ok(row!.querySelector<HTMLElement>('.ofe-ptr-btn')!.classList.contains('active'), 'clicking * activates the pointer button');
        assert.strictEqual(row!.dataset.ptr, '1', 'clicking * marks the row as pointer');
        click(dom, document.getElementById('oe-save'));
        const savedOn = S.types.find(d => d.name === 'BtnPtr');
        assert.ok(savedOn, 'saved type should exist');
        assert.strictEqual(savedOn!.fields[0].isPointer, true, 'saved field should be a pointer after button click');

        // Re-open the editor: button renders active from persisted state.
        click(dom, document.querySelector<HTMLElement>('.act-btn-edit[data-type-id="' + savedOn!.id + '"]'));
        row = document.querySelector<HTMLElement>('.field-row');
        const btnOn = row!.querySelector<HTMLElement>('.ofe-ptr-btn');
        assert.ok(btnOn!.classList.contains('active'), 'persisted pointer field re-opens with active button');
        assert.strictEqual(row!.dataset.ptr, '1', 'persisted pointer field re-opens with row marked pointer');

        // Click OFF: button deactivates and the flag clears on save.
        click(dom, btnOn);
        row = document.querySelector<HTMLElement>('.field-row');
        assert.ok(!row!.querySelector<HTMLElement>('.ofe-ptr-btn')!.classList.contains('active'), 'clicking active * deactivates the pointer button');
        assert.strictEqual(row!.dataset.ptr, '', 'clicking active * clears the row pointer mark');
        (document.getElementById('oe-name') as HTMLInputElement).value = 'BtnPtr';
        click(dom, document.getElementById('oe-save'));
        const savedOff = S.types.find(d => d.name === 'BtnPtr');
        assert.ok(savedOff, 'saved type should still exist');
        assert.strictEqual(savedOff!.fields[0].isPointer, undefined, 'saved field should no longer be a pointer after second click');
    });

    test('pointer button is disabled for bit-field container fields and stays active for void fields', async () => {
        const voidBitDef: TypeDef = {
            id: 'vbd',
            name: 'VoidBit',
            fields: [
                { name: 'raw', type: 'void', count: 1 },
                { name: 'flags', type: 'bitfield', refTypeId: 'bits', count: 1 },
            ],
        };
        S.types = [reusableBitsDef(), voidBitDef];
        S.typeInstances = [];
        await createMountedPanel();
        click(dom, document.querySelector<HTMLElement>('.act-btn-edit[data-type-id="vbd"]'));

        const rows = Array.from(document.querySelectorAll<HTMLElement>('.field-row'));
        const rowByName = (name: string) => rows.find(r => (r.querySelector('.ofe-name-inp') as HTMLInputElement).value === name)!;
        // void-typed field renders pointer active (void is always a pointer).
        const voidBtn = rowByName('raw').querySelector<HTMLButtonElement>('.ofe-ptr-btn');
        assert.ok(voidBtn, 'void field row renders a pointer button');
        assert.ok(voidBtn!.classList.contains('active'), 'void-typed field renders pointer button active');
        assert.strictEqual(voidBtn!.disabled, false, 'void field pointer button is enabled');

        // Bit-field reference rows render the button disabled.
        const ctlBtn = rowByName('flags').querySelector<HTMLButtonElement>('.ofe-ptr-btn');
        assert.ok(ctlBtn, 'bit-field reference row renders a pointer button');
        assert.strictEqual(ctlBtn!.disabled, true, 'bit-field reference rows show the * button disabled');
        assert.ok(!ctlBtn!.classList.contains('active'), 'bit-field reference pointer button is not active');
    });

    test('editor grid shares 9 columns; only bit-field-reference rows author an Alloc select', async () => {
        const inner: TypeDef = {
            id: 'inner',
            name: 'Inner',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const outer: TypeDef = {
            id: 'outer',
            name: 'Outer',
            fields: [
                { name: 'plain', type: 'uint16', count: 1 },
                { name: 'p', type: 'void', isPointer: true, count: 1 },
                { name: 'nested', type: 'struct', refTypeId: 'inner', count: 1 },
                { name: 'flags', type: 'bitfield', refTypeId: 'bits', count: 1 },
            ],
        };
        S.types = [inner, reusableBitsDef(), outer];
        await createMountedPanel();
        click(dom, document.querySelector<HTMLElement>('.act-btn-edit[data-type-id="outer"]'));

        // Inject the real stylesheet so computed grid templates reflect the shared columns.
        injectOverlayPanelCss();

        const TEMPLATE = '96px 26px 1fr 58px 52px 28px 72px 30px 18px';

        // Header: Type Ptr Name Endian Alloc Hide [ ] move del.
        const header = document.querySelector<HTMLElement>('.oe-field-hdr');
        assert.ok(header, 'field header should render');
        assert.deepStrictEqual(
            Array.from(header!.querySelectorAll<HTMLElement>(':scope > span')).map(s => s.textContent),
            ['Type', 'Ptr', 'Name', 'Endian', 'Alloc', 'Hide', '[ ]', '', ''],
            'header columns Type Ptr Name Endian Alloc Hide [ ] move del',
        );
        assert.strictEqual(header!.querySelectorAll(':scope > span').length, 9, 'nine field columns');
        assert.strictEqual(
            dom.window.getComputedStyle(header!).getPropertyValue('grid-template-columns'),
            TEMPLATE,
            'field header uses the 9-column shared grid',
        );

        // Type-default row shares the same 9-column grid.
        const defaultRow = document.querySelector<HTMLElement>('.oe-type-default-row');
        assert.ok(defaultRow, 'type-default row should render');
        assert.strictEqual(
            dom.window.getComputedStyle(defaultRow!).getPropertyValue('grid-template-columns'),
            TEMPLATE,
            'type-default row shares the 9-column grid',
        );

        // No inline bit-field authoring; only the reusable bit-field-reference
        // row carries an Alloc select (the usage-scoped override). Every other
        // row keeps an alignment placeholder cell.
        assert.strictEqual(document.querySelector('.ofe-bit-btn'), null, 'no per-field bit toggle');
        assert.strictEqual(document.querySelectorAll('.ofe-alloc-sel').length, 1, 'only the bit-field-reference row authors an alloc select');
        assert.strictEqual(document.querySelectorAll('.ofe-alloc-placeholder').length, 3, 'every other row keeps an alignment placeholder');
        assert.strictEqual(document.getElementById('oe-alloc'), null, 'no type-level alloc select');

        // Every field row: 9-column grid, second cell is the pointer button, Hide checkbox in the Hide cell.
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.field-row'));
        assert.strictEqual(rows.length, 4, 'all four field rows render');
        const rowByName = (name: string) => rows.find(r => (r.querySelector('.ofe-name-inp') as HTMLInputElement).value === name)!;
        for (const row of rows) {
            assert.strictEqual(
                dom.window.getComputedStyle(row).getPropertyValue('grid-template-columns'),
                TEMPLATE,
                'field row uses the 9-column grid',
            );
            assert.strictEqual(row.children.length, 9, 'field row renders nine cells');
            const btn = row.querySelector<HTMLElement>('.ofe-ptr-btn');
            assert.ok(btn, 'every field row renders the pointer toggle button');
            assert.strictEqual(Array.from(row.children).indexOf(btn!), 1, 'pointer button occupies the second (Ptr) cell');
            const hide = row.querySelector<HTMLElement>('.ofe-hidden-chk');
            assert.ok(hide, 'every field row renders the Hide checkbox');
            assert.strictEqual(row.querySelector<HTMLElement>('.ofe-hidden-cell')!.querySelector('.ofe-hidden-chk'), hide, 'Hide checkbox occupies the Hide cell');
        }

        assert.ok(rowByName('flags').querySelector('.ofe-alloc-sel'), 'bit-field-reference row carries the alloc select');
        for (const name of ['plain', 'p', 'nested']) {
            assert.strictEqual(rowByName(name).querySelector('.ofe-alloc-sel'), null, `${name} row authors no alloc select`);
            assert.ok(rowByName(name).querySelector('.ofe-alloc-placeholder'), `${name} row keeps the alloc alignment placeholder`);
        }
    });

    test('Hide checkbox reflects a loaded hidden field and saves the flag (false dropped)', async () => {
        const def: TypeDef = {
            id: 'cfg', name: 'Cfg', fields: [
                { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                { name: 'tag', type: 'uint8', count: 1 },
            ],
        };
        S.types = [def];
        S.typeInstances = [];
        await createMountedPanel();
        click(dom, document.querySelector<HTMLElement>('.act-btn-edit[data-type-id="cfg"]'));

        const rows = document.querySelectorAll<HTMLElement>('.field-row');
        const chkFor = (name: string): HTMLInputElement => {
            const row = Array.from(rows).find(r =>
                (r.querySelector('.ofe-name-inp') as HTMLInputElement).value === name)!;
            return row.querySelector('.ofe-hidden-chk') as HTMLInputElement;
        };
        assert.strictEqual(chkFor('reserved').checked, true, 'loaded hidden:true field shows checked');
        assert.strictEqual(chkFor('tag').checked, false, 'visible field shows unchecked');

        chkFor('reserved').checked = false;
        chkFor('reserved').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        chkFor('tag').checked = true;
        chkFor('tag').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        click(dom, document.getElementById('oe-save'));

        const saved = S.types.find(d => d.id === 'cfg')!;
        const reserved = saved.fields.find(f => f.name === 'reserved')!;
        const tag = saved.fields.find(f => f.name === 'tag')!;
        assert.strictEqual(reserved.hidden, undefined, 'unchecked field drops hidden (false is never persisted)');
        assert.strictEqual(tag.hidden, true, 'checked field persists hidden:true');
        assert.strictEqual(JSON.stringify(reserved).includes('hidden'), false, 'false value is omitted from the serialized field');
    });

    // ── per-field / per-type endian overrides ──

    const overrideChange = (dom: JSDOM, sel: HTMLSelectElement): void => {
        sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    };

    test('editor endian selects render with Auto option + inherited-source tooltip', async () => {
        await createMountedPanel();
        openKindEditor('struct');
        const endianSel = document.getElementById('oe-endian') as HTMLSelectElement | null;
        assert.ok(endianSel, 'type-level endian select should render');
        assert.ok(endianSel!.closest('.oe-type-default-row'), 'type-level endian lives in the grid-aligned type-default row');
        assert.strictEqual(endianSel!.value, '', 'type endian defaults to inherited');
        assert.ok(endianSel!.options[0] && endianSel!.options[2], 'type endian tri-state Auto/LE/BE should render');
        assert.strictEqual(endianSel!.options[0].textContent, 'Auto', 'type endian Auto option label');
        assert.strictEqual(endianSel!.options[1].textContent, 'LE', 'type endian LE option label');
        assert.strictEqual(endianSel!.options[2].textContent, 'BE', 'type endian BE option label');
        assert.strictEqual(endianSel!.options[0].title, 'Auto — inherits LE', 'type endian Auto tooltip shows global source');
        assert.ok(!endianSel!.classList.contains('is-explicit'), 'inherited type endian is not tinted');
        assert.strictEqual(document.getElementById('oe-alloc'), null, 'no type-level allocation select');

        // Plain row: field endian select renders; allocation stays a placeholder cell.
        const plainRow = document.querySelector<HTMLElement>('.field-row')!;
        const fieldEndian = plainRow.querySelector<HTMLSelectElement>('.ofe-endian-sel');
        assert.ok(fieldEndian, 'plain row keeps the field endian select');
        assert.strictEqual(plainRow.querySelector('.ofe-alloc-sel'), null, 'plain row authors no field allocation select');
        assert.ok(plainRow.querySelector('.ofe-alloc-placeholder'), 'plain row keeps the alloc alignment placeholder');
        assert.strictEqual(fieldEndian!.options[0].textContent, 'Auto', 'field endian Auto option label');
        assert.strictEqual(fieldEndian!.options[0].title, 'Auto — inherits LE', 'field endian Auto tooltip shows global when the type has none');
    });

    test('editor endian selects save per-type and per-field overrides', async () => {
        await createMountedPanel();
        openKindEditor('struct');
        const typeEndian = document.getElementById('oe-endian') as HTMLSelectElement;
        typeEndian.value = 'be';
        overrideChange(dom, typeEndian);
        // Type-level change re-renders the editor — re-query the fresh select.
        const freshEndian = document.getElementById('oe-endian') as HTMLSelectElement;
        assert.ok(!freshEndian.classList.contains('is-explicit'), 'explicit type endian does not tint the select');
        // Field endian select shows the type-level effective source.
        const fieldEndian = document.querySelector<HTMLSelectElement>('.ofe-endian-sel')!;
        assert.strictEqual(fieldEndian.options[0].title, 'Auto — inherits BE', 'field endian Auto tooltip shows type override');
        fieldEndian.value = 'le';
        overrideChange(dom, fieldEndian);
        assert.ok(!fieldEndian.classList.contains('is-explicit'), 'explicit field endian does not tint the select');
        (document.getElementById('oe-name') as HTMLInputElement).value = 'Mixed';
        click(dom, document.getElementById('oe-save'));
        const saved = S.types.find(d => d.name === 'Mixed');
        assert.ok(saved, 'saved type should exist');
        assert.strictEqual(saved!.endian, 'be');
        assert.strictEqual(saved!.fields[0].endian, 'le');
        assert.strictEqual(saved!.fields[0].allocation, undefined, 'pure type no longer authors field allocation');
    });

    test('type-default row is grid-aligned; non-bit-field rows keep an alloc placeholder', async () => {
        const inner: TypeDef = {
            id: 'inner',
            name: 'Inner',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const outer: TypeDef = {
            id: 'outer',
            name: 'Outer',
            fields: [
                { name: 'plain', type: 'uint16', count: 1 },
                { name: 'p', type: 'void', isPointer: true, count: 1 },
                { name: 'nested', type: 'struct', refTypeId: 'inner', count: 1 },
                {
                    name: 'ctl', type: 'uint16', count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 4 },
                        { name: 'b', bitWidth: 12 },
                    ],
                },
            ],
        };
        S.types = [inner, outer];
        await createMountedPanel();
        click(dom, document.querySelector<HTMLElement>('.act-btn-edit[data-type-id="outer"]'));

        // Type-default row: packed + endian slots; no allocation select.
        const defaultRow = document.querySelector<HTMLElement>('.oe-type-default-row');
        assert.ok(defaultRow, 'type-default row should render');
        assert.ok(defaultRow!.querySelector('#oe-packed'), 'packed toggle sits in the Type column of the type-default row');
        assert.strictEqual(
            defaultRow!.querySelector('.oe-type-default-lbl')?.textContent,
            'type default',
            'type-default label sits in the Name column',
        );
        assert.ok(defaultRow!.querySelector('#oe-endian'), 'type endian select sits in the Endian column');
        assert.strictEqual(defaultRow!.querySelector('#oe-alloc'), null, 'type-default row has no allocation select');
        assert.strictEqual(document.querySelector('.oe-override-row'), null, 'legacy flex override strip removed');

        // Field rows: no bit-field reference here, so no alloc select; every
        // row keeps the alignment placeholder cell.
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.field-row'));
        const rowByName = (name: string) => rows.find(r => (r.querySelector('.ofe-name-inp') as HTMLInputElement).value === name)!;
        assert.strictEqual(document.querySelectorAll('.ofe-alloc-sel').length, 0, 'no alloc select without a bit-field reference');
        assert.strictEqual(document.querySelectorAll('.ofe-alloc-placeholder').length, 4, 'every row keeps the alignment placeholder');
        for (const name of ['plain', 'p', 'nested', 'ctl']) {
            assert.ok(rowByName(name).querySelector('.ofe-alloc-placeholder'), `${name} row keeps an empty alloc cell`);
            assert.strictEqual(rowByName(name).querySelector('.ofe-alloc-sel'), null, `${name} row has no allocation select`);
        }
        assert.strictEqual(document.querySelector('.ofe-bit-btn'), null, 'no field bit toggle anywhere');
    });

    test('decoded rows badge explicit endian/allocation overrides', async () => {
        const beType: TypeDef = {
            id: 'be',
            name: 'BeType',
            packed: true,
            endian: 'be',
            allocation: 'lsb',
            fields: [
                { name: 'word', type: 'uint16', count: 1 },
                { name: 'p', type: 'void', isPointer: true, count: 1 },
                {
                    name: 'ctl', type: 'uint16', count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 4 },
                        { name: 'b', bitWidth: 12 },
                    ],
                },
            ],
        };
        S.types = [beType];
        S.typeInstances = [{ id: 'pin1', typeId: 'be', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x12, 0x34, 0x78, 0x56, 0x34, 0x12, 0x12, 0x34]);
        await createMountedPanel();
        click(dom, document.querySelector('.oi-expand-btn'));

        const leafs = Array.from(document.querySelectorAll<HTMLElement>('.oi-field'));
        const wordRow = leafs.find(el => el.querySelector('.oi-f-name')?.textContent === 'word');
        assert.ok(wordRow, 'word row should render');
        assert.strictEqual(wordRow!.querySelector('.oi-chip-endian')?.textContent, 'BE', 'scalar row badges type endian override');

        const pointerRow = leafs.find(el => el.classList.contains('oi-ptr-field'));
        assert.ok(pointerRow, 'pointer row should render');
        // Pointer header rows render via pointerHeaderBodyHtml, which does
        // not include overrideBadgeHtml — badges live on scalar/bit-unit rows.
        assert.match(elementText(pointerRow!.querySelector('.oi-f-val')!), /0x78563412/, 'pointer value decodes with the inherited type endian');

        const bitHdr = document.querySelector<HTMLElement>('.oi-arr-grp-hdr.oi-bitunit-hdr');
        assert.ok(bitHdr, 'bit unit header should render');
        assert.strictEqual(bitHdr!.querySelector('.oi-chip-endian')?.textContent, 'BE', 'bit unit header badges effective endian');
        assert.strictEqual(bitHdr!.querySelector('.oi-chip-alloc')?.textContent, 'LSB', 'bit unit header badges effective allocation (vs global MSB)');

        const bitChild = leafs.find(el => el.dataset.bitStart !== undefined);
        assert.ok(bitChild, 'bit child row should render');
        assert.strictEqual(bitChild!.querySelector('.oi-chip'), null, 'bit children never chip — chip lives on the bit unit parent header only');
    });

    test('no override badges when everything inherits global', async () => {
        S.types = [scalarDef];
        S.typeInstances = [{ id: 'pin1', typeId: 'scalar', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12]);
        await createMountedPanel();
        click(dom, document.querySelector('.oi-expand-btn'));
        assert.strictEqual(document.querySelector('.oi-chip'), null, 'no override badges when all rows inherit global');
    });

    test('override endian changes rendered values, not just chips (REGRESSION)', async () => {
        const beType: TypeDef = {
            id: 'be2',
            name: 'BeType2',
            packed: true,
            endian: 'be',
            allocation: 'lsb',
            fields: [
                { name: 'word', type: 'uint16', count: 1 },
                {
                    name: 'ctl', type: 'uint16', count: 1,
                    bitFields: [
                        { name: 'a', bitWidth: 4 },
                        { name: 'b', bitWidth: 12 },
                    ],
                },
            ],
        };
        S.types = [beType];
        S.typeInstances = [{ id: 'pin2', typeId: 'be2', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x12, 0x34, 0x78, 0x56, 0x12, 0x34]);
        await createMountedPanel();
        click(dom, document.querySelector('.oi-expand-btn'));

        // word = [0x12,0x34]; global LE -> 0x3412, type override BE -> 0x1234.
        const leafs = Array.from(document.querySelectorAll<HTMLElement>('.oi-field'));
        const wordRow = leafs.find(el => el.querySelector('.oi-f-name')?.textContent === 'word');
        assert.ok(wordRow, 'word row should render');
        assert.match(
            elementText(wordRow!.querySelector('.oi-f-val')!),
            /0x1234/,
            'scalar value cell must render with the effective BE override, not global LE',
        );

        // ctl = [0x78,0x56]; global LE -> 0x5678, type override BE -> 0x7856.
        const bitHdr = document.querySelector<HTMLElement>('.oi-arr-grp-hdr.oi-bitunit-hdr');
        assert.ok(bitHdr, 'bit unit header should render');
        bitHdr!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const hexItem = document.querySelector<HTMLElement>('.oi-field-menu .menu-item[data-cmd="disp-hex"]');
        assert.ok(hexItem, 'header hex menu item should render');
        hexItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const hdrVal = elementText(document.querySelector<HTMLElement>('.oi-bitunit-hdr .oi-f-val')!);
        assert.match(hdrVal, /0x7856/, 'bit-unit header overall value must render with the effective BE override');
    });

    test('invalid type save shows an inline error and does not save', async () => {
        await createMountedPanel();
        openKindEditor('struct');
        // Two same-named fields are rejected by validation.
        const nameInps = Array.from(document.querySelectorAll<HTMLInputElement>('.ofe-name-inp'));
        nameInps[0].value = 'dup';
        click(dom, document.getElementById('oe-add'));
        const afterAdd = Array.from(document.querySelectorAll<HTMLInputElement>('.ofe-name-inp'));
        afterAdd[afterAdd.length - 1].value = 'dup';
        (document.getElementById('oe-name') as HTMLInputElement).value = 'Bad';
        click(dom, document.getElementById('oe-save'));
        assert.ok(document.querySelector('.oe-error'), 'inline error should render on invalid save');
        assert.strictEqual(S.types.length, 0, 'invalid type must not be saved');
    });

    test('array count above 256 saves with the entered value', async () => {
        S.types = [];
        S.typeInstances = [];
        await createMountedPanel();
        openKindEditor('struct');

        const setCount = (value: string): void => {
            const row = document.querySelector<HTMLElement>('.field-row')!;
            if (!row.querySelector('.ofe-arr-cell')?.classList.contains('is-array')) {
                click(dom, row.querySelector<HTMLElement>('.ofe-arr-toggle'));
            }
            const countInp = document.querySelector<HTMLInputElement>('.ofe-count-inp')!;
            countInp.value = value;
            countInp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        };

        setCount('270');
        click(dom, document.getElementById('oe-save'));
        assert.strictEqual(S.types.length, 1, 'type with large array count saves');
        assert.strictEqual(S.types[0].fields[0].count, 270, 'count 270 is preserved, not clamped to 256');
    });

    test('array count with many digits is not truncated on save', async () => {
        S.types = [];
        S.typeInstances = [];
        await createMountedPanel();
        openKindEditor('struct');
        const row = document.querySelector<HTMLElement>('.field-row')!;
        click(dom, row.querySelector<HTMLElement>('.ofe-arr-toggle'));
        const countInp = document.querySelector<HTMLInputElement>('.ofe-count-inp')!;
        countInp.value = '123456';
        countInp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        click(dom, document.getElementById('oe-save'));
        assert.strictEqual(S.types.length, 1, 'type with large array count saves');
        assert.strictEqual(S.types[0].fields[0].count, 123456, 'count is preserved, not truncated to 3 digits');
    });

    test('bit-field def editor disables Add bit when the base width is fully allocated', async () => {
        S.types = [];
        S.typeInstances = [];
        await createMountedPanel();
        openKindEditor('bitfield');

        const setWidth = (inp: HTMLInputElement, value: string): void => {
            inp.value = value;
            inp.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        };
        const addBtn = (): HTMLButtonElement => document.getElementById('oe-bf-def-add') as HTMLButtonElement;

        // Seed is uint32 with one child (1 bit) → room remains.
        assert.strictEqual(addBtn().disabled, false, 'uint32 seed has room for more bits');

        const baseSel = document.getElementById('oe-base-type') as HTMLSelectElement;
        baseSel.value = 'uint8';
        baseSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        setWidth(document.querySelector<HTMLInputElement>('.ofe-bf-child-width')!, '8');
        assert.strictEqual(addBtn().disabled, true, '8/8 bits allocated disables Add bit');

        setWidth(document.querySelector<HTMLInputElement>('.ofe-bf-child-width')!, '1');
        assert.strictEqual(addBtn().disabled, false, 'freeing bits re-enables Add bit without save/reopen');
    });

    test('editing a type preserves a legacy type allocation it can no longer edit', async () => {
        const preset: TypeDef = {
            id: 'preset', name: 'Preset', packed: true, endian: 'be', allocation: 'msb',
            fields: [{ name: 'w', type: 'uint16', count: 1 }],
        };
        S.types = [preset];
        S.typeInstances = [];
        await createMountedPanel();
        click(dom, document.querySelector<HTMLElement>('.act-btn-edit[data-type-id="preset"]'));
        const seEndian = document.getElementById('oe-endian') as HTMLSelectElement;
        assert.ok(seEndian, 'type endian select renders in editor');
        assert.strictEqual(seEndian.value, 'be', 'predefined type endian shows in editor');
        assert.strictEqual(document.getElementById('oe-alloc'), null, 'type allocation is no longer editable');
        click(dom, document.getElementById('oe-save'));
        const saved = S.types.find(d => d.id === 'preset');
        assert.ok(saved, 'saved type should exist');
        assert.strictEqual(saved!.endian, 'be', 'type endian persists after save');
        assert.strictEqual(saved!.allocation, 'msb', 'legacy type allocation is preserved through save');
    });

    test('Add Field mutates rows in place without replacing the editor container', async () => {
        S.types = [];
        S.typeInstances = [];
        await createMountedPanel();
        openKindEditor('struct');
        const fieldsEl = document.getElementById('oe-fields');
        const formEl = document.getElementById('oi-types-body');
        const nameInp = document.getElementById('oe-name');
        const packedBtn = document.getElementById('oe-packed');
        assert.ok(fieldsEl && formEl && nameInp && packedBtn, 'editor renders');

        // The section body (#oi-types-body, .sb-body) is the scroll container:
        // it is never replaced, so its scroll position survives every mutation
        // (no jump to the top).
        formEl!.scrollTop = 120;

        click(dom, document.getElementById('oe-add'));
        assert.strictEqual(document.getElementById('oe-fields'), fieldsEl, 'Add Field does not replace #oe-fields');
        assert.strictEqual(document.getElementById('oi-types-body'), formEl, 'Add Field does not replace the scroll container');
        assert.strictEqual(document.getElementById('oe-name'), nameInp, 'Add Field does not replace the name input');
        assert.strictEqual(document.getElementById('oe-packed'), packedBtn, 'Add Field does not replace the packed toggle');
        assert.strictEqual(formEl!.scrollTop, 120, 'Add Field keeps the scroll position');
        assert.strictEqual(document.querySelectorAll('.field-row').length, 2, 'Add Field appends a row');
        assert.ok(document.querySelector('.oe-preview'), 'preview stays mounted after incremental edits');
    });

    test('editor Edit/Preview tabs swap views without losing draft state', async () => {
        S.types = [];
        S.typeInstances = [];
        await createMountedPanel();
        openKindEditor('struct');

        // Opens on Edit by default.
        const editView = document.querySelector<HTMLElement>('.oe-view[data-oe-view="edit"]');
        const previewView = document.querySelector<HTMLElement>('.oe-view[data-oe-view="preview"]');
        assert.ok(editView && previewView, 'editor renders both views');
        assert.ok(previewView!.hidden, 'preview view is hidden until switched');
        assert.strictEqual(
            document.querySelector<HTMLButtonElement>('.oe-tab.active')?.dataset.oeView,
            'edit',
            'Edit tab is active on open',
        );

        // Edit a field then switch to Preview: form hides, draft is preserved.
        const nameInp = document.getElementById('oe-name') as HTMLInputElement;
        nameInp!.value = 'Widget';
        click(dom, document.querySelector<HTMLElement>('.oe-tab[data-oe-view="preview"]'));
        assert.ok(!previewView!.hidden, 'preview view is visible after switching');
        assert.ok(editView!.hidden, 'edit view is hidden in preview mode');
        assert.strictEqual(
            document.querySelector<HTMLButtonElement>('.oe-tab.active')?.dataset.oeView,
            'preview',
            'Preview tab is active after switching',
        );

        // Switch back: the form returns with the draft intact, no re-render.
        const previewNode = document.getElementById('oe-preview')!;
        click(dom, document.querySelector<HTMLElement>('.oe-tab[data-oe-view="edit"]'));
        assert.ok(!editView!.hidden, 'edit view is visible after switching back');
        assert.ok(previewView!.hidden, 'preview view is hidden again');
        assert.strictEqual((document.getElementById('oe-name') as HTMLInputElement).value, 'Widget', 'draft name preserved across tab switch');
        assert.strictEqual(document.getElementById('oe-preview'), previewNode, 'preview node is not re-rendered by tab switching');
    });

    // ── Reusable bit-field types ──────────────────────────────────

    const reusableBitsDef = (): TypeDef => ({
        id: 'bits',
        name: 'Bits',
        kind: 'bitfield',
        baseType: 'uint8',
        fields: [],
        bitFields: [{ name: 'mode', bitWidth: 2 }, { name: 'code', bitWidth: 6 }],
    });

    const referencedBitFieldUserDef = (): TypeDef => ({
        id: 'user',
        name: 'User',
        packed: true,
        fields: [
            { name: 'control', type: 'bitfield', refTypeId: 'bits', count: 1 },
            { name: 'after', type: 'uint8', count: 1 },
        ],
    });

    test('referenced bit-field renders inline with one row per child and no wrapper level', async () => {
        S.types = [reusableBitsDef(), referencedBitFieldUserDef()];
        S.typeInstances = [{ id: 'pin_ref_bits', typeId: 'user', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0b1010_1100, 0x34]);

        await renderPinsAndExpandCard();

        const groups = document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp');
        assert.strictEqual(groups.length, 1, 'referenced bit-field should render one top-level group');
        const hdr = groups[0].querySelector<HTMLElement>('.oi-arr-grp-hdr')!;
        assert.ok(hdr.classList.contains('oi-bitunit-hdr'), 'group header should be a bitunit header');
        assert.strictEqual(elementText(hdr.querySelector('.oi-f-name')), 'control', 'header should use the local field name');
        assert.strictEqual(elementText(hdr.querySelector('.oi-f-type')), 'u8', 'header should use the referenced base type');
        assert.strictEqual(hdr.querySelector('.oi-bitunit-hdr'), null, 'no nested wrapper header');
        assert.strictEqual(groups[0].querySelector('.oi-arr-grp'), null, 'no extra hierarchy level');

        hdr.querySelector<HTMLElement>('.oi-arr-exp-btn')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field .oi-f-name')).map(elementText);
        assert.deepStrictEqual(childNames, ['mode', 'code'], 'one child row per referenced bit-field child, no wrapper row');
        assert.strictEqual(elementText(document.querySelector<HTMLElement>('.oi-fields > .oi-field .oi-f-name')), 'after', 'sibling scalar field still renders');
    });

    test('referenced bit-field array renders one group per element', async () => {
        const bits = reusableBitsDef();
        const user: TypeDef = {
            id: 'user_arr', name: 'UserArr', packed: true,
            fields: [{ name: 'regs', type: 'bitfield', refTypeId: 'bits', count: 2 }],
        };
        S.types = [bits, user];
        S.typeInstances = [{ id: 'pin_ref_arr', typeId: 'user_arr', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0b1010_1100, 0b0011_0101]);

        await renderPinsAndExpandCard();

        const elementHeaders = document.querySelectorAll<HTMLElement>('.oi-arr-el-hdr.oi-bitunit-hdr .oi-f-name');
        assert.deepStrictEqual(Array.from(elementHeaders).map(elementText), ['[0]', '[1]']);
    });

    test('field type picker offers the bit-field reference', async () => {
        S.types = [reusableBitsDef(), referencedBitFieldUserDef()];

        await createMountedPanel();
        openKindEditor('struct');

        const sel = document.querySelector<HTMLSelectElement>('#oe-fields .ofe-type-sel')!;
        assert.ok(sel, 'editor field type select should render');
        const opt = sel.querySelector<HTMLOptionElement>('option[value="bitfield:bits"]');
        assert.ok(opt, 'type picker should offer the bitfield reference option');
        assert.strictEqual(opt!.textContent, 'bitfield Bits');
        const groupLabels = Array.from(sel.querySelectorAll('optgroup')).map(g => g.getAttribute('label'));
        assert.ok(groupLabels.includes('Bit-field'), 'type picker should have a Bit-field optgroup');
    });

    test('bit-field def editor saves base width + children and lists a kind badge', async () => {
        S.types = [];

        await createMountedPanel();
        openKindEditor('bitfield');

        assert.ok(document.getElementById('oe-base-type'), 'bit-field form should render a base width select');
        assert.strictEqual((document.getElementById('oe-base-type') as HTMLSelectElement).value, 'uint32');
        assert.strictEqual(document.querySelectorAll('#oe-bf-def-children .ofe-bf-child-row').length, 1, 'seeded with one child row');
        assert.strictEqual(document.querySelector('.field-row'), null, 'no type field grid in the bit-field form');
        assert.strictEqual(document.getElementById('oe-endian'), null, 'bit-field form edits name + base width + child rows only (no endian select)');
        assert.strictEqual(document.getElementById('oe-alloc'), null, 'bit-field form edits name + base width + child rows only (no alloc select)');

        (document.getElementById('oe-name') as HTMLInputElement).value = 'Flags';
        (document.getElementById('oe-base-type') as HTMLSelectElement).value = 'uint16';
        click(dom, document.getElementById('oe-bf-def-add'));
        const rows = document.querySelectorAll<HTMLElement>('#oe-bf-def-children .ofe-bf-child-row');
        assert.strictEqual(rows.length, 2, 'Add bit appends a child row');
        (rows[0].querySelector('.ofe-bf-child-name') as HTMLInputElement).value = 'a';
        (rows[0].querySelector('.ofe-bf-child-width') as HTMLInputElement).value = '4';
        (rows[1].querySelector('.ofe-bf-child-name') as HTMLInputElement).value = 'b';
        (rows[1].querySelector('.ofe-bf-child-width') as HTMLInputElement).value = '5';

        click(dom, document.getElementById('oe-save'));

        const saved = S.types.find(d => d.kind === 'bitfield');
        assert.ok(saved, 'bit-field def should be saved');
        assert.strictEqual(saved!.name, 'Flags');
        assert.strictEqual(saved!.baseType, 'uint16');
        assert.deepStrictEqual(saved!.fields, []);
        assert.deepStrictEqual(saved!.bitFields, [{ name: 'a', bitWidth: 4 }, { name: 'b', bitWidth: 5 }]);
        assert.strictEqual(elementText(document.querySelector('.od-row .od-kind')), 'bitfield', 'type list should show a kind badge');
    });

    test('bit-field def editor labels its child columns with a header above the rows', async () => {
        S.types = [];

        await createMountedPanel();
        openKindEditor('bitfield');
        injectOverlayPanelCss();

        const hdr = document.querySelector<HTMLElement>('.ofe-bf-child-hdr');
        assert.ok(hdr, 'bit-field form should render a child column header');
        assert.deepStrictEqual(Array.from(hdr!.children).map(elementText), ['', 'Name', 'Bits', '', 'Enum', 'Hide', '', ''],
            'header cells label the name/width/enum/hide columns and stay blank over the indent, bit unit, move and delete cells');
        assert.strictEqual(hdr!.closest('#oe-bf-def-children'), null, 'header sits outside the refreshed row container');
        assert.strictEqual(document.getElementById('oe-bf-def-children')!.previousElementSibling, hdr, 'header sits directly above the rows');

        click(dom, document.getElementById('oe-bf-def-add'));
        assert.strictEqual(document.querySelectorAll('#oe-bf-def-children .ofe-bf-child-row').length, 2, 'Add bit appends a child row');
        assert.strictEqual(document.querySelector('.ofe-bf-child-hdr'), hdr, 'header node survives the incremental row rebuild after Add');

        click(dom, document.querySelector('#oe-bf-def-children .ofe-bf-child-row .ofe-bf-del-child'));
        assert.strictEqual(document.querySelectorAll('#oe-bf-def-children .ofe-bf-child-row').length, 1, 'deleting a child removes its row');
        assert.strictEqual(document.querySelector('.ofe-bf-child-hdr'), hdr, 'header node survives the incremental row rebuild after delete');

        const row = document.querySelector<HTMLElement>('#oe-bf-def-children .ofe-bf-child-row')!;
        assert.strictEqual(row.querySelector('.ofe-bf-child-name')!.getAttribute('aria-label'), 'Bit name');
        assert.strictEqual(row.querySelector('.ofe-bf-child-width')!.getAttribute('aria-label'), 'Bit width in bits');

        // R3: the labels only line up if header and rows resolve the very same columns.
        const template = computedGridTemplate(dom, row);
        assert.notStrictEqual(template, '', 'the child row grid template should resolve from the stylesheet');
        assert.strictEqual(row.children.length, 8, 'child row renders eight cells (indent/name/width/unit/enum/hide/move/delete)');
        assert.strictEqual(hdr!.children.length, 8, 'header renders one cell per child column');
        assert.strictEqual(computedGridTemplate(dom, hdr), template, 'header and child rows share one grid template');
    });

    test('bit-field def editor child hidden checkbox reflects the loaded flag and saves it (false dropped)', async () => {
        S.types = [{
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }],
        }];
        S.typeInstances = [];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-edit[data-type-id="bits"]'));

        const rows = document.querySelectorAll<HTMLElement>('#oe-bf-def-children .ofe-bf-child-row');
        assert.strictEqual(rows.length, 2, 'both bit-child rows render');
        const chk = (i: number): HTMLInputElement => rows[i].querySelector('.ofe-bf-child-hidden') as HTMLInputElement;
        assert.ok(chk(0), 'each bit-child row carries a hidden checkbox');
        assert.strictEqual(chk(0).checked, true, 'loaded hidden:true bit child shows checked');
        assert.strictEqual(chk(1).checked, false, 'visible bit child shows unchecked');

        setChecked(dom, chk(0), false);
        setChecked(dom, chk(1), true);
        click(dom, document.getElementById('oe-save'));

        const saved = S.types.find(d => d.id === 'bits')!;
        assert.strictEqual(saved.bitFields![1].hidden, true, 'checked bit child persists hidden:true');
        assert.strictEqual('hidden' in saved.bitFields![0], false, 'unchecked bit child drops hidden (false is never persisted)');
        assert.strictEqual(JSON.stringify(saved.bitFields![0]).includes('hidden'), false, 'false value is omitted from the serialized child');
    });

    test('deleting a referenced bit-field strips orphan field references', async () => {
        S.types = [reusableBitsDef(), referencedBitFieldUserDef()];
        S.typeInstances = [];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-del[data-type-id="bits"]'));
        confirmDelete(dom);
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(S.types.map(d => d.id), ['user']);
        assert.deepStrictEqual(S.types[0].fields.map(f => f.name), ['after']);
    });

    test('editing a type authors an Alloc override on a bit-field-reference row only', async () => {
        S.types = [reusableBitsDef(), referencedBitFieldUserDef()];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-edit[data-type-id="user"]'));

        const refRow = document.querySelector<HTMLElement>('#oe-fields .field-row[data-idx="0"]')!;
        assert.ok(refRow, 'editor should render the referencing field row');
        assert.strictEqual((refRow.querySelector('.ofe-type-sel') as HTMLSelectElement).value, 'bitfield:bits', 'reference should be selected');
        assert.ok((refRow.querySelector('.ofe-ptr-btn') as HTMLButtonElement).disabled, 'bit-field reference cannot be a pointer');
        const allocSel = refRow.querySelector<HTMLSelectElement>('.ofe-alloc-sel');
        assert.ok(allocSel, 'bit-field-reference row authors an alloc override');
        assert.deepStrictEqual(Array.from(allocSel!.options).map(o => o.textContent), ['Auto', 'LSB', 'MSB'], 'alloc select offers Auto/LSB/MSB');
        assert.strictEqual(allocSel!.options[0].title, 'Auto — inherits MSB', 'alloc Auto tooltip shows the global source');

        // The sibling pure scalar row stays allocation-free (placeholder cell).
        const scalarRow = document.querySelector<HTMLElement>('#oe-fields .field-row[data-idx="1"]')!;
        assert.strictEqual(scalarRow.querySelector('.ofe-alloc-sel'), null, 'pure scalar rows author no allocation');
        assert.ok(scalarRow.querySelector('.ofe-alloc-placeholder'), 'pure scalar rows keep the alignment placeholder');

        allocSel!.value = 'lsb';
        allocSel!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        click(dom, document.getElementById('oe-save'));

        const saved = S.types.find(d => d.id === 'user')!;
        assert.strictEqual(saved.fields[0].allocation, 'lsb', 'bit-field-reference row saves its allocation override');
        assert.strictEqual(saved.fields[1].allocation, undefined, 'pure scalar row saves no allocation');
    });

    test('switching a field type to/from a bit-field reference swaps the Alloc cell in place', async () => {
        S.types = [reusableBitsDef(), referencedBitFieldUserDef()];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-edit[data-type-id="user"]'));

        const scalarRow = document.querySelector<HTMLElement>('#oe-fields .field-row[data-idx="1"]')!;
        assert.strictEqual(scalarRow.querySelector('.ofe-alloc-sel'), null, 'scalar row starts without an alloc select');
        assert.ok(scalarRow.querySelector('.ofe-alloc-placeholder'), 'scalar row starts with the alignment placeholder');

        const typeSel = scalarRow.querySelector<HTMLSelectElement>('.ofe-type-sel')!;
        typeSel.value = 'bitfield:bits';
        typeSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        const allocSel = scalarRow.querySelector<HTMLSelectElement>('.ofe-alloc-sel');
        assert.ok(allocSel, 'switching to a bit-field reference authors the alloc select in place');
        assert.strictEqual(scalarRow.querySelector('.ofe-alloc-placeholder'), null, 'placeholder is replaced by the alloc select');

        allocSel!.value = 'lsb';
        allocSel!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        typeSel.value = 'uint8';
        typeSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.strictEqual(scalarRow.querySelector('.ofe-alloc-sel'), null, 'switching back removes the alloc select');
        assert.ok(scalarRow.querySelector('.ofe-alloc-placeholder'), 'placeholder is restored');

        click(dom, document.getElementById('oe-save'));
        const saved = S.types.find(d => d.id === 'user')!;
        assert.strictEqual(saved.fields[1].type, 'uint8', 'type select change is saved');
        assert.strictEqual(saved.fields[1].allocation, undefined, 'reverted row authors no allocation key');
    });

    // ── Enums ─────────────────────────────────────────────────────

    const enumModeDef = (): TypeDef => ({
        id: 'mode', name: 'Mode', kind: 'enum', baseType: 'uint8', fields: [],
        entries: [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }],
    });

    const enumUserDef = (): TypeDef => ({
        id: 'user', name: 'User', packed: true,
        fields: [{ name: 'state', type: 'enum', refTypeId: 'mode', count: 1 }],
    });

    const enumBitsDef = (): TypeDef => ({
        id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
        bitFields: [{ name: 'mode', bitWidth: 2, refTypeId: 'mode' }, { name: 'code', bitWidth: 6 }],
    });

    const enumHolderDef = (): TypeDef => ({
        id: 'holder', name: 'Holder', packed: true,
        fields: [{ name: 'ctl', type: 'bitfield', refTypeId: 'bits', count: 1 }],
    });

    test('an enum-typed scalar field renders NAME (0xNN) for a matched value', async () => {
        S.types = [enumModeDef(), enumUserDef()];
        S.typeInstances = [{ id: 'pin_enum', typeId: 'user', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x01]);

        await renderPinsAndExpandCard();

        const row = document.querySelector<HTMLElement>('.oi-fields > .oi-field')!;
        assert.strictEqual(elementText(row.querySelector('.oi-f-name')), 'state');
        assert.strictEqual(elementText(row.querySelector('.oi-f-val')), 'ON (0x01)');
    });

    test('an unmatched enum value falls back to the plain numeric rendering', async () => {
        S.types = [enumModeDef(), enumUserDef()];
        S.typeInstances = [{ id: 'pin_enum2', typeId: 'user', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x05]);

        await renderPinsAndExpandCard();

        assert.strictEqual(elementText(document.querySelector('.oi-fields > .oi-field .oi-f-val')), '0x05');
    });

    test('a bit-field child with an enum ref renders the label for its value', async () => {
        S.types = [enumModeDef(), enumBitsDef(), enumHolderDef()];
        S.typeInstances = [{ id: 'pin_bits_enum', typeId: 'holder', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x40]); // msb allocation: mode = 0b01

        await renderPinsAndExpandCard();
        const hdr = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp .oi-arr-grp-hdr')!;
        hdr.querySelector<HTMLElement>('.oi-arr-exp-btn')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const children = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field'));
        assert.deepStrictEqual(children.map(c => elementText(c.querySelector('.oi-f-name'))), ['mode', 'code']);
        assert.strictEqual(elementText(children[0].querySelector('.oi-f-val')), 'ON (0x1)');
        assert.ok(!elementText(children[1].querySelector('.oi-f-val')).includes('('), 'unlabeled child stays numeric');
    });

    test('field type picker offers the enum reference and a def picker', async () => {
        S.types = [enumModeDef(), enumUserDef()];

        await createMountedPanel();
        openKindEditor('struct');

        const sel = document.querySelector<HTMLSelectElement>('#oe-fields .ofe-type-sel')!;
        const opt = sel.querySelector<HTMLOptionElement>('option[value="enum:mode"]');
        assert.ok(opt, 'type picker should offer the enum reference option');
        assert.strictEqual(opt!.textContent, 'enum Mode');
        const groupLabels = Array.from(sel.querySelectorAll('optgroup')).map(g => g.getAttribute('label'));
        assert.ok(groupLabels.includes('Enum'), 'type picker should have an Enum optgroup');
    });

    test('an enum-typed field row blocks the pointer toggle and shows no alloc override', async () => {
        S.types = [enumModeDef(), enumUserDef()];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-edit[data-type-id="user"]'));

        const row = document.querySelector<HTMLElement>('#oe-fields .field-row[data-idx="0"]')!;
        assert.strictEqual((row.querySelector('.ofe-type-sel') as HTMLSelectElement).value, 'enum:mode');
        assert.ok((row.querySelector('.ofe-ptr-btn') as HTMLButtonElement).disabled, 'enum field cannot be a pointer');
        assert.strictEqual(row.querySelector('.ofe-alloc-sel'), null, 'enum field shows no allocation override');
    });

    test('enum def editor saves base width + entries and lists a kind badge', async () => {
        S.types = [];

        await createMountedPanel();
        openKindEditor('enum');

        assert.ok(document.getElementById('oe-enum-base-type'), 'enum form should render a base width select');
        assert.strictEqual((document.getElementById('oe-enum-base-type') as HTMLSelectElement).value, 'uint8');
        assert.strictEqual(document.querySelectorAll('#oe-enum-entries .ofe-enum-entry-row').length, 1, 'seeded with one entry row');
        assert.strictEqual(document.querySelector('.field-row'), null, 'no type field grid in the enum form');

        (document.getElementById('oe-name') as HTMLInputElement).value = 'Mode';
        click(dom, document.getElementById('oe-enum-add'));
        const rows = document.querySelectorAll<HTMLElement>('#oe-enum-entries .ofe-enum-entry-row');
        assert.strictEqual(rows.length, 2, 'Add entry appends a row');
        (rows[0].querySelector('.ofe-enum-entry-name') as HTMLInputElement).value = 'OFF';
        (rows[0].querySelector('.ofe-enum-entry-value') as HTMLInputElement).value = '0';
        (rows[1].querySelector('.ofe-enum-entry-name') as HTMLInputElement).value = 'ON';
        (rows[1].querySelector('.ofe-enum-entry-value') as HTMLInputElement).value = '0x1';

        click(dom, document.getElementById('oe-save'));

        const saved = S.types.find(d => d.kind === 'enum');
        assert.ok(saved, 'enum def should be saved');
        assert.strictEqual(saved!.name, 'Mode');
        assert.strictEqual(saved!.baseType, 'uint8');
        assert.deepStrictEqual(saved!.fields, []);
        assert.deepStrictEqual(saved!.entries, [{ name: 'OFF', value: 0 }, { name: 'ON', value: 1 }]);
        assert.strictEqual(elementText(document.querySelector('.od-row .od-kind')), 'enum', 'type list should show an enum kind badge');
    });

    test('enum def editor labels its entry columns with a header above the rows', async () => {
        S.types = [];

        await createMountedPanel();
        openKindEditor('enum');
        injectOverlayPanelCss();

        const hdr = document.querySelector<HTMLElement>('.ofe-enum-entry-hdr');
        assert.ok(hdr, 'enum form should render an entry column header');
        assert.deepStrictEqual(Array.from(hdr!.children).map(elementText), ['', 'Name', '', 'Value', '', ''],
            'header cells label the name/value columns and stay blank over the indent, =, move and delete cells');
        assert.strictEqual(hdr!.closest('#oe-enum-entries'), null, 'header sits outside the refreshed row container');
        assert.strictEqual(document.getElementById('oe-enum-entries')!.previousElementSibling, hdr, 'header sits directly above the rows');

        click(dom, document.getElementById('oe-enum-add'));
        assert.strictEqual(document.querySelectorAll('#oe-enum-entries .ofe-enum-entry-row').length, 2, 'Add entry appends a row');
        assert.strictEqual(document.querySelector('.ofe-enum-entry-hdr'), hdr, 'header node survives the incremental row rebuild after Add');

        click(dom, document.querySelector('#oe-enum-entries .ofe-enum-entry-row .ofe-enum-del-entry'));
        assert.strictEqual(document.querySelectorAll('#oe-enum-entries .ofe-enum-entry-row').length, 1, 'deleting an entry removes its row');
        assert.strictEqual(document.querySelector('.ofe-enum-entry-hdr'), hdr, 'header node survives the incremental row rebuild after delete');

        const row = document.querySelector<HTMLElement>('#oe-enum-entries .ofe-enum-entry-row')!;
        assert.strictEqual(row.querySelector('.ofe-enum-entry-name')!.getAttribute('aria-label'), 'Enum entry name');
        assert.strictEqual(row.querySelector('.ofe-enum-entry-value')!.getAttribute('aria-label'), 'Enum entry value');

        // R3: the labels only line up if header and rows resolve the very same columns.
        const template = computedGridTemplate(dom, row);
        assert.notStrictEqual(template, '', 'the entry row grid template should resolve from the stylesheet');
        assert.strictEqual(row.children.length, 6, 'entry row renders six cells (indent/name/=/value/move/delete)');
        assert.strictEqual(hdr!.children.length, 6, 'header renders one cell per entry column');
        assert.strictEqual(computedGridTemplate(dom, hdr), template, 'header and entry rows share one grid template');
    });

    test('enum def editor rejects an entry that does not fit the base width', async () => {
        S.types = [];

        await createMountedPanel();
        openKindEditor('enum');
        (document.getElementById('oe-name') as HTMLInputElement).value = 'Mode';
        (document.querySelector('#oe-enum-entries .ofe-enum-entry-value') as HTMLInputElement).value = '0x100';

        click(dom, document.getElementById('oe-save'));

        assert.ok(document.querySelector('.oe-error'), 'oversized entry should surface an inline error');
        assert.strictEqual(S.types.length, 0, 'no def is committed while invalid');
    });

    test('bit-field def editor exposes an enum picker per child and saves the ref', async () => {
        S.types = [enumModeDef()];

        await createMountedPanel();
        openKindEditor('bitfield');

        const enumSel = document.querySelector<HTMLSelectElement>('#oe-bf-def-children .ofe-bf-child-enum');
        assert.ok(enumSel, 'bit-field child row should offer an enum picker');
        assert.ok(enumSel!.querySelector('option[value="mode"]'), 'picker should list the enum def');
        enumSel!.value = 'mode';
        enumSel!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

        (document.getElementById('oe-name') as HTMLInputElement).value = 'Bits';
        click(dom, document.getElementById('oe-save'));

        const saved = S.types.find(d => d.kind === 'bitfield');
        assert.ok(saved, 'bit-field def should save');
        assert.strictEqual(saved!.bitFields![0].refTypeId, 'mode');
    });

    test('editing an enum re-renders referencing instances with the new label', async () => {
        S.types = [enumModeDef(), enumUserDef()];
        S.typeInstances = [{ id: 'pin_enum_edit', typeId: 'user', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00]);

        await renderPinsAndExpandCard();
        assert.strictEqual(elementText(document.querySelector('.oi-fields > .oi-field .oi-f-val')), 'OFF (0x00)');

        click(dom, document.querySelector('.od-row .act-btn-edit[data-type-id="mode"]'));
        const entryName = document.querySelector<HTMLInputElement>('#oe-enum-entries .ofe-enum-entry-name')!;
        entryName.value = 'OFFLINE';
        entryName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        click(dom, document.getElementById('oe-save'));

        assert.strictEqual(elementText(document.querySelector('.oi-fields > .oi-field .oi-f-val')), 'OFFLINE (0x00)');
    });

    test('deleting a referenced enum strips orphan scalar + bit-child refs (pin-safe)', async () => {
        const bits = enumBitsDef();
        bits.bitFields![0].hidden = true;
        S.types = [enumModeDef(), bits, enumUserDef()];
        S.typeInstances = [];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-del[data-type-id="mode"]'));
        confirmDelete(dom);
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(S.types.map(d => d.id), ['bits', 'user']);
        assert.strictEqual(S.types[0].bitFields![0].refTypeId, undefined);
        assert.strictEqual(S.types[0].bitFields![0].hidden, true, 'pin-safe ref strip preserves the bit-child hidden flag');
        assert.deepStrictEqual(S.types[1].fields, []);
    });

    // ── hidden fields (Instances view filter) ──────────────

    function topFieldNames(): string[] {
        return Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > *'))
            .map(el => el.querySelector<HTMLElement>('.oi-f-name')?.textContent ?? '');
    }

    function setShowHidden(show: boolean): void {
        const btn = document.getElementById('oi-show-hidden-btn') as HTMLButtonElement | null;
        assert.ok(btn, 'show-hidden toggle should render');
        if ((btn!.getAttribute('aria-pressed') === 'true') !== show) { click(dom, btn!); }
    }

    function hiddenFixture(): void {
        const child: TypeDef = {
            id: 'child', name: 'ChildNode', packed: true, fields: [
                { name: 'tag', type: 'uint8', count: 1 },
                { name: 'secret', type: 'uint8', count: 1, hidden: true },
            ],
        };
        const root: TypeDef = {
            id: 'root', name: 'Root', packed: true, fields: [
                { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                { name: 'tag', type: 'uint16', count: 1 },
                { name: 'ctrl', type: 'uint8', count: 1, hidden: true, bitFields: [{ name: 'lo', bitWidth: 4 }, { name: 'hi', bitWidth: 4 }] },
                { name: 'nodes', type: 'struct', refTypeId: 'child', count: 2 },
                { name: 'data', type: 'uint8', count: 2, hidden: true },
            ],
        };
        S.types = [child, root];
        S.typeInstances = [{ id: 'pin_hidden', typeId: 'root', addr: 0, name: 'rootInst' }];
        setBytesInSegment(0, [0x00, 0x34, 0x12, 0xA5, 0x01, 0x02, 0x03, 0x04, 0x08, 0x09]);
    }

    test('omits hidden leaf / container / array groups by default; reveals them when toggled on', async () => {
        hiddenFixture();
        await renderPinsAndExpandCard();

        assert.deepStrictEqual(topFieldNames(), ['tag', 'nodes'], 'hidden field, container, and array are omitted by default');

        setShowHidden(true);
        assert.deepStrictEqual(topFieldNames(), ['reserved', 'tag', 'ctrl', 'nodes', 'data'], 'toggle on reveals every hidden group');
    });

    test('a hidden bit-field container hides all of its children (field-level hidden)', async () => {
        hiddenFixture();
        await renderPinsAndExpandCard();

        const ctrlGroup = (): HTMLElement | undefined =>
            Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp'))
                .find(g => g.querySelector<HTMLElement>('.oi-f-name')?.textContent === 'ctrl');
        assert.strictEqual(ctrlGroup(), undefined, 'hidden bit-field container group is not rendered');

        setShowHidden(true);
        const group = ctrlGroup();
        assert.ok(group, 'toggle on reveals the bit-field container group');
        click(dom, group!.querySelector<HTMLElement>('.oi-arr-exp-btn'));
        const childNames = Array.from(group!.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childNames, ['lo', 'hi'], 'revealing the container reveals its bit children');
    });

    test('a hidden nested type leaf is dropped from its visible container subtree', async () => {
        hiddenFixture();
        await renderPinsAndExpandCard();

        const nodesGroup = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp')!;
        click(dom, nodesGroup.querySelector<HTMLElement>('.oi-arr-grp-hdr .oi-arr-exp-btn'));
        click(dom, document.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-arr-el-exp-btn'));

        const firstElement = document.querySelector<HTMLElement>('.oi-arr-el-grp')!;
        const nestedNames = Array.from(firstElement.querySelectorAll<HTMLElement>('.oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(nestedNames, ['tag'], 'visible nested leaf renders, hidden nested leaf is dropped');

        setShowHidden(true);
        const firstElementAfter = document.querySelector<HTMLElement>('.oi-arr-el-grp')!;
        const revealed = Array.from(firstElementAfter.querySelectorAll<HTMLElement>('.oi-field .oi-f-name'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(revealed, ['tag', 'secret'], 'toggle on reveals the nested hidden leaf too');
    });

    test('deleting a referenced type strips orphan nested type:struct refs across the pool', async () => {
        const inner: TypeDef = { id: 'inner_del', name: 'InnerDel', fields: [{ name: 'tag', type: 'uint8', count: 1 }] };
        const holder: TypeDef = {
            id: 'holder_del', name: 'HolderDel', packed: true,
            fields: [
                { name: 'kid', type: 'struct', refTypeId: 'inner_del', count: 1 },
                { name: 'after', type: 'uint8', count: 1 },
            ],
        };
        S.types = [inner, holder];
        S.typeInstances = [];

        await createMountedPanel();
        click(dom, document.querySelector('.od-row .act-btn-del[data-type-id="inner_del"]'));
        confirmDelete(dom);
        await new Promise(resolve => setTimeout(resolve, 0));

        assert.deepStrictEqual(S.types.map(d => d.id), ['holder_del']);
        assert.deepStrictEqual(S.types[0].fields.map(f => f.name), ['after'], 'nested type:struct ref stripped, sibling kept');
    });

    test('composition: hidden field + reusable bit-field ref + enum render together, toggle off/on', async () => {
        const bits = enumBitsDef();
        const root: TypeDef = {
            id: 'compose', name: 'Compose', packed: true,
            fields: [
                { name: 'reserved', type: 'uint8', count: 1, hidden: true },
                { name: 'flags', type: 'bitfield', refTypeId: 'bits', count: 1 },
                { name: 'state', type: 'enum', refTypeId: 'mode', count: 1 },
            ],
        };
        S.types = [enumModeDef(), bits, root];
        S.typeInstances = [{ id: 'pin_compose', typeId: 'compose', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0b01_000101, 0x01]);

        await renderPinsAndExpandCard();

        assert.deepStrictEqual(topFieldNames(), ['flags', 'state'], 'hidden field omitted; bit-field ref + enum render');

        const group = document.querySelector<HTMLElement>('.oi-fields > .oi-arr-grp')!;
        assert.ok(group.querySelector('.oi-arr-grp-hdr.oi-bitunit-hdr'), 'bit-field ref renders as a bitunit group');
        click(dom, group.querySelector<HTMLElement>('.oi-arr-grp-hdr .oi-arr-exp-btn'));
        const childNames = Array.from(group.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field .oi-f-name')).map(elementText);
        assert.deepStrictEqual(childNames, ['mode', 'code'], 'referenced bit-field children render');
        const modeField = Array.from(group.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field'))
            .find(el => elementText(el.querySelector('.oi-f-name')) === 'mode')!;
        assert.strictEqual(elementText(modeField.querySelector('.oi-f-val')), 'ON (0x1)', 'enum-ref bit child label uses its bit width (1 hex digit)');

        const stateRow = Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-field'))
            .find(el => elementText(el.querySelector('.oi-f-name')) === 'state')!;
        assert.strictEqual(elementText(stateRow.querySelector('.oi-f-val')), 'ON (0x01)', 'enum scalar label uses the field width');

        setShowHidden(true);
        assert.deepStrictEqual(topFieldNames(), ['reserved', 'flags', 'state'], 'toggle on reveals the hidden field alongside the new features');
    });

    // ── hidden bit children (def-level, instance view) ────────────

    function bitUnitGroups(): HTMLElement[] {
        return Array.from(document.querySelectorAll<HTMLElement>('.oi-fields > .oi-arr-grp'));
    }

    function expandBitUnit(group: HTMLElement): void {
        if (!group.classList.contains('open')) {
            click(dom, group.querySelector<HTMLElement>('.oi-arr-grp-hdr .oi-arr-exp-btn'));
        }
    }

    function bitChildNames(group: HTMLElement): string[] {
        return Array.from(group.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-field .oi-f-name')).map(elementText);
    }

    test('a hidden bit child is absent by default, revealed by Show hidden, container header intact', async () => {
        S.types = [{
            id: 'regs', name: 'Regs', packed: true, fields: [
                { name: 'ctrl', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }] },
            ],
        }];
        S.typeInstances = [{ id: 'pin_hidden_bit', typeId: 'regs', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xA5]);

        await renderPinsAndExpandCard();

        const group = bitUnitGroups()[0];
        assert.ok(group.querySelector('.oi-arr-grp-hdr.oi-bitunit-hdr'), 'container header row renders');
        expandBitUnit(group);
        assert.deepStrictEqual(bitChildNames(group), ['hi'], 'the hidden bit child row is omitted by default');

        setShowHidden(true);
        const revealed = bitUnitGroups()[0];
        assert.ok(revealed.querySelector('.oi-arr-grp-hdr.oi-bitunit-hdr'), 'container header row stays after the in-place refresh');
        expandBitUnit(revealed);
        assert.deepStrictEqual(bitChildNames(revealed), ['lo', 'hi'], 'Show hidden reveals the hidden bit child');
    });

    test('a container with every bit child hidden keeps its header row and drops every child row', async () => {
        S.types = [{
            id: 'regs', name: 'Regs', packed: true, fields: [
                { name: 'ctrl', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4, hidden: true }] },
            ],
        }];
        S.typeInstances = [{ id: 'pin_all_hidden', typeId: 'regs', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xA5]);

        await renderPinsAndExpandCard();

        const group = bitUnitGroups()[0];
        const hdr = group.querySelector<HTMLElement>('.oi-arr-grp-hdr')!;
        assert.ok(hdr.classList.contains('oi-bitunit-hdr'), 'container header row still renders');
        assert.ok(elementText(hdr.querySelector('.oi-f-name')), 'the container header keeps its name');
        assert.ok(elementText(hdr.querySelector('.oi-f-val')), 'the container header keeps its decoded value');
        expandBitUnit(group);
        assert.deepStrictEqual(bitChildNames(group), [], 'no bit child rows render when all are hidden');

        setShowHidden(true);
        const revealed = bitUnitGroups()[0];
        expandBitUnit(revealed);
        assert.deepStrictEqual(bitChildNames(revealed), ['lo', 'hi'], 'toggle reveals every hidden bit child');
    });

    test('hiding a bit child on a reusable type drops it in every referencing field (def-level)', async () => {
        const bits: TypeDef = {
            id: 'bits', name: 'Bits', kind: 'bitfield', baseType: 'uint8', fields: [],
            bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }],
        };
        const user: TypeDef = {
            id: 'user', name: 'User', packed: true, fields: [
                { name: 'a', type: 'bitfield', refTypeId: 'bits', count: 1 },
                { name: 'b', type: 'bitfield', refTypeId: 'bits', count: 1 },
            ],
        };
        S.types = [bits, user];
        S.typeInstances = [{ id: 'pin_ref_hidden', typeId: 'user', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xA5, 0x3C]);

        await renderPinsAndExpandCard();

        const groups = bitUnitGroups();
        assert.strictEqual(groups.length, 2, 'both referencing fields render a bitunit group');
        for (const group of groups) { expandBitUnit(group); }
        const names = bitUnitGroups().flatMap(bitChildNames);
        assert.deepStrictEqual(names, ['hi', 'hi'], 'the hidden bit is dropped in every usage of the reusable type');
    });

    function expandBitElements(): void {
        document.querySelectorAll<HTMLElement>('.oi-arr-grp .oi-arr-el-grp').forEach(element => {
            if (!element.classList.contains('open')) {
                click(dom, element.querySelector<HTMLElement>('.oi-arr-el-hdr .oi-arr-el-exp-btn'));
            }
        });
    }

    function bitElementChildNames(): string[] {
        return Array.from(
            document.querySelectorAll<HTMLElement>('.oi-arr-grp-body .oi-arr-el-body .oi-field .oi-f-name'),
        ).map(elementText);
    }

    test('a hidden bit child is dropped per element of a bit-field array', async () => {
        S.types = [{
            id: 'regs', name: 'Regs', packed: true, fields: [
                { name: 'cfg', type: 'uint8', count: 2, bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }] },
            ],
        }];
        S.typeInstances = [{ id: 'pin_bit_arr', typeId: 'regs', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xA5, 0x3C]);

        await renderPinsAndExpandCard();

        expandBitUnit(bitUnitGroups()[0]);
        expandBitElements();
        assert.deepStrictEqual(bitElementChildNames(), ['hi', 'hi'], 'every element of the bit-field array drops the hidden bit child');

        setShowHidden(true);
        expandBitUnit(bitUnitGroups()[0]);
        expandBitElements();
        assert.deepStrictEqual(bitElementChildNames(), ['lo', 'hi', 'lo', 'hi'], 'the toggle reveals the hidden bit child in every element');
    });

    test('a hidden bit child inside a pointer target type is dropped from the inline preview', async () => {
        const target: TypeDef = {
            id: 'bf_target', name: 'BfTarget', packed: true, fields: [
                { name: 'ctrl', type: 'uint8', count: 1, bitFields: [{ name: 'lo', bitWidth: 4, hidden: true }, { name: 'hi', bitWidth: 4 }] },
            ],
        };
        const parent: TypeDef = {
            id: 'bf_parent', name: 'BfParent', packed: true,
            fields: [{ name: 'hdr', type: 'struct', refTypeId: target.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xA5;
        S.types = [target, parent];
        S.typeInstances = [{ id: 'pin_bf_ptr', typeId: parent.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        click(dom, document.querySelector<HTMLElement>('.oi-ptr-hdr .oi-arr-exp-btn'));
        click(dom, document.querySelector<HTMLElement>('.oi-ptr-child-hdr .oi-arr-exp-btn'));

        const container = Array.from(document.querySelectorAll<HTMLElement>('.oi-arr-grp-hdr.oi-bitunit-hdr'))
            .find(hdr => elementText(hdr.querySelector('.oi-f-name')) === 'ctrl')?.closest<HTMLElement>('.oi-arr-grp');
        assert.ok(container, 'the pointer target bit-field container renders inline');
        expandBitUnit(container!);
        assert.deepStrictEqual(bitChildNames(container!), ['hi'], 'the target type resolves its own hidden bit child');
    });

    test('parity golden: unused new features keep the instance view and C preview byte-identical', async () => {
        const child: TypeDef = { id: 'par', name: 'Par', fields: [{ name: 'tag', type: 'uint8', count: 1 }] };
        const root: TypeDef = {
            id: 'baseline', name: 'Baseline', packed: true,
            fields: [
                { name: 'count', type: 'uint16', count: 1 },
                { name: 'items', type: 'uint8', count: 2 },
                { name: 'child', type: 'struct', refTypeId: 'par', count: 1 },
            ],
        };
        S.types = [child, root];
        S.typeInstances = [{ id: 'pin_baseline', typeId: 'baseline', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x34, 0x12, 0xAA, 0xBB, 0x7F]);
        await renderPinsAndExpandCard();

        // Instance-view golden: a pool that uses none of the new features
        // (hidden / reusable bit-field ref / enum) renders exactly as before.
        const rendered = document.querySelector<HTMLElement>('.oi-fields')!.innerHTML;
        assert.deepStrictEqual(
            Array.from(document.querySelectorAll<HTMLElement>('.oi-fields .oi-f-name')).map(elementText),
            ['count', 'items', '[0]', '[1]', 'child', 'tag'],
            'visible row names are the pre-change set',
        );
        // The golden moved with the DOM/CSS vocabulary rename: the struct-derived
        // class families became the overlay families (and the `data-source-*`
        // attribute mirrors the renamed persisted key). Folding the legacy
        // vocabulary back in must reproduce the pre-rename hash byte-for-byte —
        // proof that the rename changed nothing else in the rendered view.
        const legacyVocabulary = rendered
            .split('ofe-').join('sfe-')
            .split('oi-').join('si-')
            .split('oe-').join('se-')
            .split('oa-').join('sa-')
            .split('om-').join('sm-')
            .split('od-').join('sd-')
            .split('data-source-type-id').join('data-source-struct-id');
        assert.strictEqual(
            crypto.createHash('sha256').update(legacyVocabulary).digest('hex'),
            'bf39479b1e6a22aff464bd4ae3592e06f1c1dccc6648c4cd928eb04807f4a640',
            'folding the pre-rename vocabulary back in reproduces the pre-rename view hash',
        );
        assert.strictEqual(
            crypto.createHash('sha256').update(rendered).digest('hex'),
            '960a850f2d62f6861baaff48c97135dec3d27b9621ab2db4d737a249590c4c79',
            'instance-view HTML is byte-identical with every new feature unused',
        );

        // C-preview golden: same guarantee for the exported layout.
        assert.strictEqual(
            typeDefToC(root, [child, root]),
            [
                'typedef struct __attribute__((packed)) {',
                '    uint16_t count;                         /* +  0  2B */',
                '    uint8_t  items[2];                      /* +  2  2B */',
                '    Par      child;                         /* +  4  1B */',
                '} Baseline;                                 /* 5B, packed */',
            ].join('\n'),
            'C preview is byte-identical with every new feature unused',
        );
    });
});
