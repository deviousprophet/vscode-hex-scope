import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { S } from '../../webview/state';
import type { StructDef, StructPin } from '../../core/types';
import { setBytesInSegment } from '../shared/struct-test-helpers';

function resetStructState(): void {
    S.structs = [];
    S.structPins = [];
    S.activeStructAddr = null;
    S.parseResult = null;
    S.segmentIndex = [];
    S.endian = 'le';
    S.bitFieldAllocation = 'msb';
    S.sidebarTab = 'struct';
}

function elementText(element: Element | null): string {
    return element?.textContent ?? '';
}

function getTopStructFieldHeaders(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-f-name'))
        .map(el => el.textContent ?? '');
}

function openValueMenuLabels(target: HTMLElement, dom: JSDOM): string[] {
    target.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
    return Array.from(document.querySelectorAll<HTMLElement>('#si-val-menu .ctx-row[data-cmd^="disp-"] .ctx-label'))
        .map(el => el.textContent ?? '');
}

suite('struct UI array header summary', () => {
    let dom: JSDOM;

    setup(() => {
        dom = new JSDOM('<!doctype html><html><body><div id="s-struct-pins"></div></body></html>');

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

        resetStructState();
    });

    teardown(() => {
        resetStructState();
        dom.window.close();
        delete (globalThis as unknown as { window?: Window }).window;
        delete (globalThis as unknown as { document?: Document }).document;
        delete (globalThis as unknown as { navigator?: Navigator }).navigator;
        delete (globalThis as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi;
    });

    async function renderPinsAndExpandCard(): Promise<HTMLElement> {
        const { renderStructPins } = await import('../../webview/sidebar/struct/index.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        return expandCard!;
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

    function setupStructPointerFixture(ids: { header: string; parent: string; pin: string }): StructDef {
        const header: StructDef = {
            id: ids.header,
            name: 'HeaderCreate',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: ids.parent,
            name: 'ParentCreate',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refStructId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.structs = [header, parent];
        S.structPins = [{ id: ids.pin, structId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);
        return header;
    }

    function setupUnmappedPointerFixture(): void {
        const def: StructDef = {
            id: 'ptr_unmapped',
            name: 'PtrUnmapped',
            packed: true,
            fields: [
                { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            ],
        };
        S.structs = [def];
        S.structPins = [{ id: 'pin_ptr_unmapped', structId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00, 0x00, 0x00, 0x20]);
    }

    function setupNullPointerFixture(): void {
        const def: StructDef = {
            id: 'ptr_null',
            name: 'PtrNull',
            packed: true,
            fields: [
                { name: 'next', type: 'uint16', isPointer: true, count: 1 },
            ],
        };
        S.structs = [def];
        S.structPins = [{ id: 'pin_ptr_null', structId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x00, 0x00, 0x00, 0x00]);
    }

    function setupVoidPointerFixture(type: 'void' | 'pointer' = 'void'): void {
        const def: StructDef = {
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
        S.structs = [def];
        S.structPins = [{ id: `pin_ptr_${type}`, structId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);
    }

    function assertUnmappedPointerRow(): void {
        const row = document.querySelector<HTMLElement>('.si-ptr-hdr.si-ptr-field');
        assert.ok(row, 'typed pointer row should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-f-name')?.textContent ?? '', 'next', 'typed pointer name should not repeat target type');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-f-type')?.textContent, 'u16*', 'typed pointer type cell should show target pointer type');
        assertUnmappedPointerValue(row!);
        assert.ok(row!.classList.contains('si-field'), 'unmapped pointer should use scalar field row layout');
        assert.ok(!row!.classList.contains('si-arr-grp-hdr'), 'unmapped pointer should not use composite header layout');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-arr-exp-btn'), null, 'unmapped pointer should not render an expand button');
        assert.strictEqual(document.querySelector<HTMLElement>('.si-ptr-child-hdr'), null, 'unmapped pointer should not render a child preview row');
    }

    function assertUnmappedPointerValue(row: HTMLElement): void {
        const value = row.querySelector<HTMLElement>('.si-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.strictEqual(value, '(unmapped) 0x20000000', 'unmapped status should not imply followable pointer navigation');
    }

    function assertNullPointerRow(): void {
        const row = document.querySelector<HTMLElement>('.si-ptr-hdr.si-ptr-field');
        assert.ok(row, 'null pointer row should render');
        const value = row!.querySelector<HTMLElement>('.si-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.strictEqual(value, '(null) 0x00000000', 'null status should be explicit without pointer navigation arrow');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-arr-exp-btn'), null, 'null pointer should not render an expand button');
    }

    function assertVoidPointerLeafRow(): HTMLElement {
        const row = document.querySelector<HTMLElement>('.si-ptr-hdr.si-ptr-field');
        assert.ok(row, 'void pointer row should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-f-type')?.textContent, 'void*', 'void pointer type cell should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-f-name')?.textContent, 'raw', 'void pointer name should render');
        assert.strictEqual(row!.querySelector<HTMLElement>('.si-arr-exp-btn'), null, 'void pointer should not render an expand button');
        assert.strictEqual(document.querySelector<HTMLElement>('.si-ptr-child-hdr'), null, 'void pointer should not render a child preview row');
        const value = row!.querySelector<HTMLElement>('.si-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.strictEqual(value, '→ 0x00000020', 'mapped void pointer should keep followable value display');
        return row!;
    }

    function assertUnmappedPointerMenu(dom: JSDOM): void {
        const row = document.querySelector<HTMLElement>('.si-ptr-hdr.si-ptr-field');
        assert.ok(row, 'typed pointer row should render before opening menu');
        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const disabledFollow = document.querySelector<HTMLElement>('#si-val-menu .ctx-row.disabled');
        assert.ok(disabledFollow?.textContent?.includes('Jump to Address'), 'jump item should be visible but disabled');
        assert.ok(disabledFollow?.textContent?.includes('unmapped'), 'disabled jump should explain unmapped target');
    }

    function setupScalarPointerPreviewFixture(): void {
        const def: StructDef = {
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
        S.structs = [def];
        S.structPins = [{ id: 'pin_ptr_scalar_preview', structId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);
    }

    function assertScalarPointerTargetPreview(row: HTMLElement): void {
        const body = requiredPointerBody(row);
        const child = body.querySelector<HTMLElement>(':scope > .si-field');
        assert.ok(child, 'scalar pointer target preview should render');
        assert.strictEqual(body.querySelector<HTMLElement>('.si-ptr-child-hdr'), null, 'scalar target should not render an object child header');
        assertScalarPointerTargetField(child!);
    }

    function assertScalarPointerTargetField(child: HTMLElement): void {
        assert.strictEqual(child.querySelector<HTMLElement>('.si-f-off'), null, 'scalar pointer target should hide noisy +000 offset');
        assert.ok(child.querySelector<HTMLElement>('.si-node-pad'), 'scalar pointer target should keep row alignment');
        assert.strictEqual(requiredPointerTargetText(child, '.si-f-type'), 'u32');
        assert.strictEqual(requiredPointerTargetText(child, '.si-f-name'), '*');
        assert.strictEqual(requiredPointerTargetText(child, '.si-f-val'), '0x38433330');
    }

    function requiredPointerTargetText(row: HTMLElement, selector: string): string {
        const el = row.querySelector<HTMLElement>(selector);
        assert.ok(el, `${selector} should render`);
        return el!.textContent ?? '';
    }

    function requiredPointerBody(row: HTMLElement): HTMLElement {
        const group = row.closest<HTMLElement>('.si-arr-grp');
        assert.ok(group, 'pointer group should render');
        const body = group!.querySelector<HTMLElement>(':scope > .si-arr-grp-body');
        assert.ok(body, 'pointer body should render after expand');
        return body!;
    }

    function setupOffsetVisiblePointerFixture(): void {
        const header: StructDef = {
            id: 'header_offset_visible',
            name: 'HeaderOffsetVisible',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent = offsetVisiblePointerParent(header.id);
        const bytes = new Array(0x40).fill(0);
        bytes[1] = 0x20;
        bytes[0x20] = 0xAB;
        S.structs = [header, parent];
        S.structPins = [{ id: 'pin_parent_offset_visible', structId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);
    }

    function offsetVisiblePointerParent(headerId: string): StructDef {
        return {
            id: 'parent_offset_visible',
            name: 'ParentOffsetVisible',
            packed: true,
            fields: [
                { name: 'prefix', type: 'uint8', count: 1 },
                { name: 'hdr', type: 'struct', refStructId: headerId, isPointer: true, count: 1 },
            ],
        };
    }

    function assertPointerOffsetVisibleAfterExpand(dom: JSDOM): void {
        const headerRow = requiredPointerHeader('struct pointer header should render');
        assert.strictEqual(pointerHeaderOffset(headerRow), '+001', 'collapsed pointer header should show storage offset');
        expandPointerHeader(headerRow, dom);
        assert.strictEqual(pointerHeaderOffset(requiredPointerHeader('expanded pointer header should render')), '+001', 'expanded pointer header should keep its offset visible');
    }

    function requiredPointerHeader(message: string): HTMLElement {
        const headerRow = document.querySelector<HTMLElement>('.si-ptr-hdr');
        assert.ok(headerRow, message);
        return headerRow!;
    }

    function pointerHeaderOffset(headerRow: HTMLElement): string {
        const offset = headerRow.querySelector<HTMLElement>('.si-f-off');
        assert.ok(offset, 'pointer header offset should render');
        return offset!.textContent ?? '';
    }

    function expandPointerHeader(headerRow: HTMLElement, dom: JSDOM): void {
        const expand = headerRow.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expand, 'struct pointer expand button should render');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }

    function triggerCreateStructInstance(dom: JSDOM, message: string): void {
        const parentHeader = document.querySelector<HTMLElement>('.si-ptr-hdr');
        assert.ok(parentHeader, message);
        const expand = parentHeader!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expand, 'struct pointer header should have expand button');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const childHeader = document.querySelector<HTMLElement>('.si-ptr-child-hdr[data-pointer-allow-create="true"]');
        assert.ok(childHeader, 'struct pointer child header should render create-enabled menu source');
        childHeader!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const create = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="create-struct-ptr"]');
        assert.ok(create, 'create struct instance command should be enabled');
        create!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    }

    function pinsForTarget(structId: string, addr: number): StructPin[] {
        const matches: StructPin[] = [];
        for (const pin of S.structPins) {
            if (pin.structId === structId && pin.addr === addr) { matches.push(pin); }
        }
        return matches;
    }

    function assertPointerCreateMetadata(pin: StructPin): void {
        assert.strictEqual(pin.name, 'parentInst.hdr @00000020');
        const source = pin.pointerSources?.[0];
        assert.ok(source, 'created pin should store pointer source metadata');
        assert.strictEqual(source!.sourcePinId, 'pin_parent_create');
        assert.strictEqual(source!.sourceFieldPath, 'hdr');
        assert.strictEqual(source!.pointerStorageAddress, 0);
        assert.strictEqual(elementText(document.querySelector('.si-csource')), 'from parentInst.hdr @0x00000000');
    }

    function assertSinglePointerTarget(structId: string): StructPin {
        const targetPins = pinsForTarget(structId, 0x20);
        assert.strictEqual(targetPins.length, 1, 'create should add target struct pin once');
        return targetPins[0];
    }

    test('uses declared struct type and element count for nested struct array header', async () => {
        const child: StructDef = {
            id: 'child',
            name: 'ChildNode',
            fields: [
                { name: 'a', type: 'uint8', count: 1 },
                { name: 'b', type: 'uint16', count: 1 },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'child', count: 3 },
            ],
        };
        const pin: StructPin = {
            id: 'pin_2',
            structId: 'parent',
            addr: 0,
            name: 'parentInst',
        };

        S.structs = [child, parent];
        S.structPins = [pin];

        await renderPinsAndExpandCard();

        const header = document.querySelector<HTMLElement>('.si-arr-addr');
        assert.ok(header, 'array header summary should be rendered');

        const text = header!.textContent ?? '';
        const title = header!.getAttribute('title') ?? '';

        assert.ok(text.includes('[3]'), `expected element count [3] in header text, got: ${text}`);
        assert.ok(title.includes('[3]'), `expected element count [3] in header title, got: ${title}`);
        assert.ok(text.includes('ChildNode'), `expected struct name ChildNode in header text, got: ${text}`);
        assert.ok(title.includes('ChildNode'), `expected struct name ChildNode in header title, got: ${title}`);
        assert.ok(!text.includes('[6]'), `header should not use flattened child row count, got: ${text}`);
    });

    test('renders nested struct arrays as element groups with leaf-only labels', async () => {
        const child: StructDef = {
            id: 'child',
            name: 'ChildNode',
            fields: [
                { name: 'field0', type: 'uint8', count: 1 },
                { name: 'field1', type: 'uint8', count: 1 },
                { name: 'field2', type: 'uint8', count: 2 },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'child', count: 2 },
            ],
        };
        const pin: StructPin = {
            id: 'pin_1',
            structId: 'parent',
            addr: 0,
            name: 'parentInst',
        };

        S.structs = [child, parent];
        S.structPins = [pin];

        await renderPinsAndExpandCard();

        const expandArray = document.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expandArray, 'array group expand button should be rendered');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const topArrayHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
        const nodesHeaderCount = topArrayHeaders.filter(name => name === 'nodes').length;
        assert.strictEqual(nodesHeaderCount, 1, 'parent struct-array group should not be split by nested arrays');

        const firstElementBody = document.querySelector<HTMLElement>('.si-arr-el-body');
        assert.ok(firstElementBody, 'nested element body should be rendered');
        assert.strictEqual(firstElementBody!.style.display, 'none', 'nested element body should be collapsed by default');

        const expandElement = document.querySelector<HTMLElement>('.si-arr-el-exp-btn');
        assert.ok(expandElement, 'nested element expand button should be rendered');
        expandElement!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const elementHeaderName = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-f-name');
        assert.ok(elementHeaderName, 'element header name should be rendered');
        assert.strictEqual(elementHeaderName!.textContent ?? '', '[0]', 'element header should only show index');
        const elementHeaderMeta = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-arr-addr');
        assert.ok(elementHeaderMeta, 'element header should show struct summary');
        assert.strictEqual(elementHeaderMeta!.textContent ?? '', 'ChildNode', 'element header should show struct type');

        const firstLeafName = document.querySelector<HTMLElement>('.si-arr-el-body .si-field .si-f-name');
        assert.ok(firstLeafName, 'leaf row name should be rendered after expanding an element');
        const label = firstLeafName!.textContent ?? '';
        assert.strictEqual(label, 'field0', `expected leaf-only label field0, got: ${label}`);
        assert.ok(!label.includes('['), `label should not include array index prefix, got: ${label}`);
        assert.ok(!label.includes('nodes.'), `label should not include parent path, got: ${label}`);

        const nestedHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-arr-grp-hdr'));
        const nestedField2Header = nestedHeaders.find(h =>
            h.querySelector<HTMLElement>('.si-f-name')?.textContent === 'field2'
        );
        assert.ok(nestedField2Header, 'nested scalar-array node field2 should be rendered');

        const nestedExpandBtn = nestedField2Header!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(nestedExpandBtn, 'nested scalar-array node should have expand button');
        nestedExpandBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedLeafNames = Array.from(
            nestedField2Header!
                .closest<HTMLElement>('.si-arr-grp')!
                .querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field .si-f-name')
        ).map(el => el.textContent ?? '');
        assert.ok(nestedLeafNames.includes('[0]'), 'nested scalar-array child should use index-only label [0]');
        assert.ok(nestedLeafNames.includes('[1]'), 'nested scalar-array child should use index-only label [1]');
        assert.ok(!nestedLeafNames.some(name => name.includes('nodes[')), 'nested leaf labels should not include parent array path');
    });

    test('uses local node label for scalar-struct nested scalar array', async () => {
        const child: StructDef = {
            id: 'child',
            name: 'MyStruct',
            fields: [
                { name: 'field0', type: 'uint32', count: 1 },
                { name: 'field1', type: 'uint8', count: 1 },
                { name: 'field2', type: 'uint8', count: 2 },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'field3', type: 'struct', refStructId: 'child', count: 1 },
            ],
        };
        const pin: StructPin = {
            id: 'pin_scalar_struct',
            structId: 'parent',
            addr: 0,
            name: 'parentInst',
        };

        S.structs = [child, parent];
        S.structPins = [pin];

        await renderPinsAndExpandCard();

        const topHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(topHeaders.includes('field3'), 'scalar struct node should be labeled with local field name');
        assert.ok(topHeaders.includes('field2'), 'nested scalar-array node should be labeled with local field name');
        assert.ok(!topHeaders.includes('field3.field2'), 'nested scalar-array node should not include parent path');

        const topLevelHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(topLevelHeaders, ['field3'], 'nested scalar-array node should not be rendered at top level');

        const parentGroup = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp');
        assert.ok(parentGroup, 'scalar struct group should exist');
        const parentExpandBtn = parentGroup!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(parentExpandBtn, 'scalar struct group should be expandable');
        parentExpandBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedHeader = parentGroup!.querySelector<HTMLElement>('.si-arr-grp-body .si-arr-grp-hdr .si-f-name');
        assert.ok(nestedHeader, 'nested scalar-array header should render inside scalar struct body');
        assert.strictEqual(nestedHeader!.textContent ?? '', 'field2', 'nested scalar-array header should keep local name');
    });

    test('keeps child composite nodes collapsed by default after opening parent', async () => {
        const child: StructDef = {
            id: 'child_collapse',
            name: 'ChildCollapse',
            fields: [
                { name: 'field0', type: 'uint32', count: 1 },
                { name: 'field1', type: 'uint8', count: 2 },
            ],
        };
        const parent: StructDef = {
            id: 'parent_collapse',
            name: 'ParentCollapse',
            fields: [
                { name: 'field3', type: 'struct', refStructId: 'child_collapse', count: 1 },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_collapse', structId: 'parent_collapse', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topGroup = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp');
        assert.ok(topGroup, 'top composite group should render');
        const topBody = topGroup!.querySelector<HTMLElement>('.si-arr-grp-body');
        assert.ok(topBody, 'top group body should render');
        assert.strictEqual(topBody!.style.display, 'none', 'top group should be collapsed by default');

        const topExpand = topGroup!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(topExpand, 'top group expand button should render');
        topExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedGroup = topGroup!.querySelector<HTMLElement>('.si-arr-grp-body .si-arr-grp');
        assert.ok(nestedGroup, 'nested scalar-array group should render inside parent body');
        const nestedBody = nestedGroup!.querySelector<HTMLElement>('.si-arr-grp-body');
        assert.ok(nestedBody, 'nested group body should render');
        assert.strictEqual(nestedBody!.style.display, 'none', 'nested composite should remain collapsed by default');
    });

    test('renders scalar struct node even when it has only one leaf child', async () => {
        const child: StructDef = {
            id: 'single_leaf_child',
            name: 'SingleLeafChild',
            fields: [
                { name: 'only', type: 'uint16', count: 1 },
            ],
        };
        const parent: StructDef = {
            id: 'single_leaf_parent',
            name: 'SingleLeafParent',
            fields: [
                { name: 'wrap', type: 'struct', refStructId: 'single_leaf_child', count: 1 },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_single_leaf', structId: 'single_leaf_parent', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topHeaders = getTopStructFieldHeaders();
        assert.deepStrictEqual(topHeaders, ['wrap'], 'struct field should render as a composite node header even with one leaf child');

        const leafAtTop = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-field .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(!leafAtTop.includes('only'), 'child leaf should not render at top level');
    });

    test('supports rendering nested structs at max depth with local labels', async () => {
        const level3: StructDef = {
            id: 'depth_l3',
            name: 'DepthL3',
            fields: [
                { name: 'bytes', type: 'uint8', count: 2 },
            ],
        };
        const level2: StructDef = {
            id: 'depth_l2',
            name: 'DepthL2',
            fields: [
                { name: 'inner', type: 'struct', refStructId: 'depth_l3', count: 1 },
            ],
        };
        const level1: StructDef = {
            id: 'depth_l1',
            name: 'DepthL1',
            fields: [
                { name: 'outer', type: 'struct', refStructId: 'depth_l2', count: 1 },
            ],
        };

        S.structs = [level3, level2, level1];
        S.structPins = [{ id: 'pin_depth', structId: 'depth_l1', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-f-name');
        assert.ok(topHeader, 'top nested struct header should render');
        assert.strictEqual(topHeader!.textContent ?? '', 'outer', 'top nested struct should use local label');

        const topExpand = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(topExpand, 'top nested struct expand button should render');
        topExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const innerHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-body .si-arr-grp-hdr .si-f-name');
        assert.ok(innerHeader, 'second-level struct header should render at max depth boundary');
        assert.strictEqual(innerHeader!.textContent ?? '', 'inner', 'second-level struct should use local label');

        const innerExpand = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-body .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(innerExpand, 'second-level struct expand button should render');
        innerExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const bytesHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-body .si-arr-grp-body .si-arr-grp-hdr .si-f-name');
        assert.ok(bytesHeader, 'scalar array at max depth should render as a composite node');
        assert.strictEqual(bytesHeader!.textContent ?? '', 'bytes', 'max-depth scalar array should use local label');
    });

    test('moves array offset from collapsed header to expanded child rows', async () => {
        const def: StructDef = {
            id: 'array_offset',
            name: 'ArrayOffset',
            fields: [
                { name: 'prefix', type: 'uint8', count: 1 },
                { name: 'values', type: 'uint16', count: 2 },
            ],
        };

        S.structs = [def];
        S.structPins = [{ id: 'pin_array_offset', structId: 'array_offset', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0x11, 0x22, 0x33, 0x44]);

        await renderPinsAndExpandCard();

        const arrayHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr');
        assert.ok(arrayHeader, 'array header should render');
        assert.strictEqual(arrayHeader!.querySelector<HTMLElement>('.si-f-off')?.textContent ?? '', '+002', 'collapsed array header should show first element offset');

        const expandArray = arrayHeader!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expandArray, 'array expand button should render');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandedHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr');
        assert.ok(expandedHeader, 'expanded array header should render');
        assert.strictEqual(expandedHeader!.querySelector<HTMLElement>('.si-f-off'), null, 'expanded array header should not duplicate child offsets');

        const childOffsets = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-body > .si-field .si-f-off'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childOffsets, ['+002', '+004'], 'expanded array children should keep their own offsets');
    });

    test('moves nested struct offset from collapsed header to expanded child rows', async () => {
        const child: StructDef = {
            id: 'nested_offset_child',
            name: 'NestedOffsetChild',
            fields: [
                { name: 'a', type: 'uint8', count: 1 },
                { name: 'b', type: 'uint16', count: 1 },
            ],
        };
        const parent: StructDef = {
            id: 'nested_offset_parent',
            name: 'NestedOffsetParent',
            fields: [
                { name: 'prefix', type: 'uint8', count: 1 },
                { name: 'node', type: 'struct', refStructId: 'nested_offset_child', count: 1 },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_nested_offset', structId: 'nested_offset_parent', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0x11, 0x22, 0x33]);

        await renderPinsAndExpandCard();

        const structHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr');
        assert.ok(structHeader, 'nested struct header should render');
        assert.strictEqual(structHeader!.querySelector<HTMLElement>('.si-f-off')?.textContent ?? '', '+002', 'collapsed nested struct header should show first child offset');

        const expandStruct = structHeader!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expandStruct, 'nested struct expand button should render');
        expandStruct!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandedHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr');
        assert.ok(expandedHeader, 'expanded nested struct header should render');
        assert.strictEqual(expandedHeader!.querySelector<HTMLElement>('.si-f-off'), null, 'expanded nested struct header should not duplicate child offsets');

        const childOffsets = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-body > .si-field .si-f-off'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childOffsets, ['+002', '+004'], 'expanded nested struct children should keep their own offsets');
    });

    test('renders ascii string field as scalar leaf without collapse node', async () => {
        const def: StructDef = {
            id: 'str_leaf',
            name: 'StrLeaf',
            fields: [
                { name: 'name', type: 'ascii', count: 8 },
            ],
        };
        const pin: StructPin = {
            id: 'pin_str_leaf',
            structId: 'str_leaf',
            addr: 0,
            name: 'inst',
        };

        S.structs = [def];
        S.structPins = [pin];

        await renderPinsAndExpandCard();

        const arrNodeNames = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(!arrNodeNames.includes('name'), 'ascii field should not render as collapsible array node');

        const leafNames = Array.from(document.querySelectorAll<HTMLElement>('.si-field .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(leafNames.includes('name'), 'ascii field should render as leaf field');
    });

    test('recurses nested struct arrays without disambiguation suffix labels', async () => {
        const leaf: StructDef = {
            id: 'leaf_suffix',
            name: 'LeafSuffix',
            fields: [
                { name: 'field0', type: 'uint8', count: 1 },
            ],
        };
        const mid: StructDef = {
            id: 'mid_suffix',
            name: 'MidSuffix',
            fields: [
                { name: 'children', type: 'struct', refStructId: 'leaf_suffix', count: 2 },
            ],
        };
        const top: StructDef = {
            id: 'top_suffix',
            name: 'TopSuffix',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'mid_suffix', count: 2 },
            ],
        };
        const pin: StructPin = {
            id: 'pin_suffix',
            structId: 'top_suffix',
            addr: 0,
            name: 'inst',
        };

        S.structs = [leaf, mid, top];
        S.structPins = [pin];

        await renderPinsAndExpandCard();

        const openFirst = (selector: string) => {
            const btn = document.querySelector<HTMLElement>(selector);
            assert.ok(btn, `expand button should exist for ${selector}`);
            btn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        };

        openFirst('.si-arr-grp-hdr .si-arr-exp-btn');
        openFirst('.si-arr-el-hdr .si-arr-el-exp-btn');
        openFirst('.si-arr-el-body .si-arr-grp-hdr .si-arr-exp-btn');
        openFirst('.si-arr-el-body .si-arr-el-hdr .si-arr-el-exp-btn');

        const labels = Array.from(document.querySelectorAll<HTMLElement>('.si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(!labels.some(label => /#\d+$/.test(label)), 'nested labels should not use disambiguation suffixes');
    });

    test('groups bit fields by storage unit with child rows', async () => {
        const def: StructDef = {
            id: 'bit_struct',
            name: 'BitStruct',
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bits', structId: 'bit_struct', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topField0 = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp:nth-child(1) > .si-arr-grp-hdr .si-f-name');
        assert.ok(topField0, 'array bit-field group should render a top-level header');
        assert.strictEqual(elementText(topField0), 'field0', 'array bit-field group should display the declared field name');

        const topField1 = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp:nth-child(2) > .si-arr-grp-hdr .si-f-name');
        assert.ok(topField1, 'second bit-field group should render a top-level header');
        assert.strictEqual(elementText(topField1), 'field1', 'single bit-field group should display the declared field name');

        const unitType = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-f-type');
        assert.ok(unitType, 'bit-field header should show scalar-like type');
        assert.strictEqual(elementText(unitType), 'u8', 'bit-field header should use base scalar type');

        const unitOffset = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-f-off');
        assert.ok(unitOffset, 'bit-field header should show scalar-like offset');

        const unitValue = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-f-val');
        assert.ok(unitValue, 'bit-field unit should show scalar-like value cell');
        assert.strictEqual(unitValue!.dataset.valType, 'bin', 'bit-field parent row should default to binary view');

        const unitExpand = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(unitExpand, 'bit-field unit should be expandable');
        unitExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-field .si-f-name'))
            .map(elementText);
        assert.ok(childNames.includes('mode'), 'bit-field child row should contain mode');
        assert.ok(childNames.includes('flags'), 'bit-field child row should contain flags');

        const firstElementHeader = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-f-name');
        assert.ok(firstElementHeader, 'bit-field array element should render a scalar-like header');
        assert.strictEqual(elementText(firstElementHeader), '[0]', 'bit-field array element header should show its index');

        const firstElementValue = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-f-val');
        assert.ok(firstElementValue, 'bit-field array element should show a scalar-like value cell');
        assert.strictEqual(firstElementValue!.dataset.valType, 'bin', 'bit-field array element should default to binary view');

        const elementExpand = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-arr-el-exp-btn');
        assert.ok(elementExpand, 'bit-field array element should be expandable');
        elementExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const selectedBits = document.querySelectorAll<HTMLElement>('.si-arr-grp-hdr .si-f-val .si-bit.sel');
        assert.ok(selectedBits.length === 0, 'array element expansion should not select bits by itself');

        const childRows = document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-field');
        assert.ok(childRows.length > 0, 'bit-field array element should expose child bit rows');
    });

    test('uses shared byte order with a local bit-layout toggle', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_alloc_toggle', structId: 'bit_alloc_toggle', addr: 0x600, name: 'inst' }];
        setBytesInSegment(0x600, [0xB1]);

        await renderPinsAndExpandCard();

        S.bitFieldAllocation = 'lsb';
        const toggleGroups = Array.from(document.querySelectorAll<HTMLElement>('.si-toggle-group'))
            .map(el => el.getAttribute('title') ?? '');
        assert.ok(!toggleGroups.some(title => title.includes('Byte endianness')), 'Struct must use shared sidebar byte order');
        assert.ok(toggleGroups.some(title => title.includes('Bit-field allocation')), 'bit-field allocation detail should be available on hover');
        assert.strictEqual(S.bitFieldAllocation, 'lsb', 'bit-field allocation should be LSB after explicit set');
        assert.ok(document.getElementById('sa-btn-bit-lsb'), 'LSB bit-field button should render');
        assert.ok(document.getElementById('sa-btn-bit-msb'), 'MSB bit-field button should render');
        assert.strictEqual(document.getElementById('sa-btn-bit-lsb')?.textContent, 'LSB');
        assert.strictEqual(document.getElementById('sa-btn-bit-msb')?.textContent, 'MSB');
        assert.ok(document.getElementById('sa-btn-bit-lsb')?.getAttribute('title')?.includes('least significant bit'), 'LSB button should explain allocation on hover');
        assert.ok(document.getElementById('sa-btn-bit-msb')?.getAttribute('title')?.includes('most significant bit'), 'MSB button should explain allocation on hover');

        const expandBits = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-arr-exp-btn');
        assert.ok(expandBits, 'bit-field parent should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValuesMsb = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childValuesMsb, ['101', '1 0001'], 'MSB-first should allocate from high bits by default');

        document.getElementById('sa-btn-bit-lsb')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValuesLsb = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'))
            .map(el => el.textContent ?? '');
        assert.deepStrictEqual(childValuesLsb, ['001', '1 0110'], 'LSB-first should allocate from low bits independently of byte endianness');
    });

    test('renders scalar values using shared byte order', async () => {
        const fields: StructDef['fields'] = [
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
            resetStructState();
            S.endian = endian;
            const def: StructDef = {
                id: `scalar_${endian}`,
                name: `Scalar${endian.toUpperCase()}`,
                packed: true,
                fields,
            };
            S.structs = [def];
            S.structPins = [{ id: `pin_${endian}`, structId: def.id, addr: 0, name: 'inst' }];
            setBytesInSegment(0, bytes);
            await renderPinsAndExpandCard();
            return Array.from(document.querySelectorAll<HTMLElement>('.si-field > .si-f-body > .si-f-val'))
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
        const ptrValueLe = document.querySelector<HTMLElement>('.si-ptr-hdr .si-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.ok(ptrValueLe.includes('0x12345678'), `ptr LE display: ${ptrValueLe}`);
        let firstRow = document.querySelector<HTMLElement>('.si-field');
        assert.ok(firstRow, 'first scalar row should render');
        firstRow!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        let binItem = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="disp-bin"]');
        assert.ok(binItem, 'binary view menu item should render');
        binItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        let firstBinary = document.querySelector<HTMLElement>('.si-field .si-f-val[data-val-type="bin"]');
        assert.strictEqual(firstBinary?.textContent?.replace(/\s+/g, ' ').trim(), '0001 0010 0011 0100', 'LE binary should display the numeric value bits, not raw memory byte order');
        firstRow = document.querySelector<HTMLElement>('.si-field');
        firstRow!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const hexItem = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="disp-hex"]');
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
        const ptrValueBe = document.querySelector<HTMLElement>('.si-ptr-hdr .si-f-val')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        assert.ok(ptrValueBe.includes('0x12345678'), `ptr BE display: ${ptrValueBe}`);
        firstRow = document.querySelector<HTMLElement>('.si-field');
        assert.ok(firstRow, 'first scalar row should render after BE rerender');
        firstRow!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        binItem = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="disp-bin"]');
        assert.ok(binItem, 'binary view menu item should render after BE rerender');
        binItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        firstBinary = document.querySelector<HTMLElement>('.si-field .si-f-val[data-val-type="bin"]');
        assert.strictEqual(firstBinary?.textContent?.replace(/\s+/g, ' ').trim(), '0001 0010 0011 0100', 'BE binary should display the same numeric value bits for the same decoded value');
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
        const jump = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="jump-ptr"]');
        assert.ok(jump, 'jump pointer command should be enabled for mapped void pointer');
        assert.strictEqual(document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="create-struct-ptr"]'), null, 'void pointer should not offer create struct instance');

        row.querySelector<HTMLElement>('.si-f-ptr')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0x20);
        assert.strictEqual(S.selEnd, 0x20);
    });

    test('renders legacy pointer type as void pointer storage leaf', async () => {
        setupVoidPointerFixture('pointer');
        await renderPinsAndExpandCard();
        assertVoidPointerLeafRow();
    });

    test('following scalar pointer selects target byte span', async () => {
        const def: StructDef = {
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
        S.structs = [def];
        S.structPins = [{ id: 'pin_ptr_scalar_follow', structId: def.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const row = document.querySelector<HTMLElement>('.si-ptr-hdr.si-ptr-field');
        assert.ok(row, 'typed pointer row should render');
        row!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0);
        assert.strictEqual(S.selEnd, 3);

        row!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const jump = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="jump-ptr"]');
        assert.ok(jump, 'jump pointer command should be enabled');
        jump!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        assert.strictEqual(S.selStart, 0x20);
        assert.strictEqual(S.selEnd, 0x21);
    });

    test('scalar pointer target preview renders typed dereference row', async () => {
        setupScalarPointerPreviewFixture();

        await renderPinsAndExpandCard();

        const row = document.querySelector<HTMLElement>('.si-ptr-hdr.si-ptr-field');
        assert.ok(row, 'scalar pointer row should render');
        row!.querySelector<HTMLElement>('.si-arr-exp-btn')!
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assertScalarPointerTargetPreview(row!);
    });

    test('struct pointer click jumps without creating destination pin', async () => {
        const header: StructDef = {
            id: 'header_follow',
            name: 'HeaderFollow',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: 'parent_follow',
            name: 'ParentFollow',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refStructId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.structs = [header, parent];
        S.structPins = [{ id: 'pin_parent_follow', structId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const value = document.querySelector<HTMLElement>('.si-ptr-hdr .si-f-ptr');
        assert.ok(value, 'struct pointer value should render');
        value!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const targetPins = S.structPins.filter(pin => pin.structId === header.id && pin.addr === 0x20);
        assert.strictEqual(targetPins.length, 0, 'jump should not create target struct pin');
        assert.strictEqual(S.selStart, 0x20);
        assert.strictEqual(S.selEnd, 0x20);
    });

    test('struct pointer menu creates or reuses destination pin with source metadata', async () => {
        const header = setupStructPointerFixture({ header: 'header_create', parent: 'parent_create', pin: 'pin_parent_create' });

        await renderPinsAndExpandCard();

        triggerCreateStructInstance(dom, 'struct pointer header should render');

        const targetPin = assertSinglePointerTarget(header.id);
        assertPointerCreateMetadata(targetPin);

        triggerCreateStructInstance(dom, 'struct pointer header should render after create');
        assert.strictEqual(pinsForTarget(header.id, 0x20).length, 1, 'create should reuse existing target pin');
        assert.strictEqual(targetPin.pointerSources?.length, 1, 'duplicate source metadata should not be added');
    });

    test('expanding struct pointer decodes target fields inline', async () => {
        const header: StructDef = {
            id: 'header_inline',
            name: 'HeaderInline',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: 'parent_inline',
            name: 'ParentInline',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refStructId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.structs = [header, parent];
        S.structPins = [{ id: 'pin_parent_inline', structId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const expand = document.querySelector<HTMLElement>('.si-ptr-hdr .si-arr-exp-btn');
        assert.ok(expand, 'struct pointer should render expandable row');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const child = document.querySelector<HTMLElement>('.si-ptr-hdr + .si-arr-grp-body .si-field');
        assert.ok(child, 'expanded pointer should render target child rows inline');
        assert.strictEqual(child!.dataset.byteStart, '32', 'inline child byte start should use target address');
        assert.strictEqual(child!.querySelector<HTMLElement>('.si-f-off')?.textContent, '+000', 'inline child offset should be relative to target base');
        assert.strictEqual(child!.querySelector<HTMLElement>('.si-f-name')?.textContent, 'tag');
    });

    test('expanded struct pointer header keeps its offset visible', async () => {
        setupOffsetVisiblePointerFixture();
        await renderPinsAndExpandCard();
        assertPointerOffsetVisibleAfterExpand(dom);
    });

    test('renders struct pointer arrays with parent and pointer element rows', async () => {
        const node: StructDef = {
            id: 'ptr_array_node',
            name: 'Node',
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: 'ptr_array_parent',
            name: 'PtrArrayParent',
            packed: true,
            fields: [{ name: 'nodes', type: 'struct', refStructId: node.id, isPointer: true, count: 2 }],
        };
        const bytes = new Array(0x40).fill(0);
        bytes[0] = 0x20;
        bytes[4] = 0x30;
        bytes[0x20] = 0xAA;
        bytes[0x30] = 0xBB;
        S.structs = [node, parent];
        S.structPins = [{ id: 'pin_ptr_array_parent', structId: parent.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const parentHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr');
        assert.ok(parentHeader, 'pointer array parent header should render');
        assert.strictEqual(parentHeader!.querySelector<HTMLElement>('.si-f-name')?.textContent, 'nodes');
        assert.strictEqual(parentHeader!.querySelector<HTMLElement>('.si-arr-addr')?.textContent, 'Node*[2]');

        parentHeader!.querySelector<HTMLElement>('.si-arr-exp-btn')!
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const pointerHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-ptr-hdr'));
        assert.strictEqual(pointerHeaders.length, 2, 'expanded pointer array should render pointer element rows');
        assert.deepStrictEqual(pointerHeaders.map(h => h.querySelector<HTMLElement>('.si-f-name')?.textContent), ['[0]', '[1]']);
        assert.deepStrictEqual(pointerHeaders.map(h => h.querySelector<HTMLElement>('.si-f-type')?.textContent), ['Node*', 'Node*']);
        assert.deepStrictEqual(pointerHeaders.map(h => h.dataset.byteStart), ['0', '4']);

        pointerHeaders[0].querySelector<HTMLElement>('.si-arr-exp-btn')!
            .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        const childHeader = pointerHeaders[0]
            .closest<HTMLElement>('.si-arr-grp')!
            .querySelector<HTMLElement>('.si-ptr-child-hdr');
        assert.ok(childHeader, 'pointer element should render target preview header');
        assert.ok(childHeader!.querySelector<HTMLElement>('.si-arr-addr')?.textContent?.includes('Node @ 0x00000020'));
        const child = pointerHeaders[0]
            .closest<HTMLElement>('.si-arr-grp')!
            .querySelector<HTMLElement>('.si-arr-grp-body .si-field');
        assert.strictEqual(child?.querySelector<HTMLElement>('.si-f-off')?.textContent, '+000');
    });

    test('compacts long struct pointer type labels in the data type column', async () => {
        const longName = 'VeryLongTelemetryHeaderStruct';
        const header: StructDef = {
            id: 'long_ptr_header',
            name: longName,
            fields: [{ name: 'tag', type: 'uint8', count: 1 }],
        };
        const parent: StructDef = {
            id: 'long_ptr_parent',
            name: 'LongPtrParent',
            packed: true,
            fields: [{ name: 'hdr', type: 'struct', refStructId: header.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x30).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0xAB;
        S.structs = [header, parent];
        S.structPins = [{ id: 'pin_long_ptr_parent', structId: parent.id, addr: 0, name: 'inst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const typeCell = document.querySelector<HTMLElement>('.si-ptr-hdr .si-f-type');
        assert.ok(typeCell, 'struct pointer type cell should render');
        assert.strictEqual(typeCell!.textContent, 'VeryL...truct*');
        assert.strictEqual(typeCell!.getAttribute('title'), `${longName}*`);
        assert.strictEqual(typeCell!.getAttribute('aria-label'), `${longName}*`);
    });

    test('nested inline struct pointer uses inline source for jump and create', async () => {
        const leaf: StructDef = {
            id: 'leaf_inline_ptr',
            name: 'LeafInlinePtr',
            fields: [{ name: 'flag', type: 'uint8', count: 1 }],
        };
        const inner: StructDef = {
            id: 'inner_inline_ptr',
            name: 'InnerInlinePtr',
            packed: true,
            fields: [{ name: 'next', type: 'struct', refStructId: leaf.id, isPointer: true, count: 1 }],
        };
        const parent: StructDef = {
            id: 'parent_inline_ptr',
            name: 'ParentInlinePtr',
            packed: true,
            fields: [{ name: 'inner', type: 'struct', refStructId: inner.id, isPointer: true, count: 1 }],
        };
        const bytes = new Array(0x60).fill(0);
        bytes[0] = 0x20;
        bytes[0x20] = 0x30;
        bytes[0x30] = 0x7F;
        S.structs = [leaf, inner, parent];
        S.structPins = [{ id: 'pin_parent_inline_ptr', structId: parent.id, addr: 0, name: 'parentInst' }];
        setBytesInSegment(0, bytes);

        await renderPinsAndExpandCard();

        const expand = document.querySelector<HTMLElement>('.si-ptr-hdr .si-arr-exp-btn');
        assert.ok(expand, 'parent struct pointer should render expandable row');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const headers = Array.from(document.querySelectorAll<HTMLElement>('.si-ptr-hdr'));
        assert.strictEqual(headers.length, 2, 'expanded pointer should render nested pointer header');
        const nested = headers[1];
        nested!.querySelector<HTMLElement>('.si-f-ptr')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(S.selStart, 0x30);
        assert.strictEqual(S.selEnd, 0x30);

        const nestedChild = nested!
            .closest<HTMLElement>('.si-arr-grp')!
            .querySelector<HTMLElement>('.si-arr-grp-body .si-ptr-child-hdr[data-pointer-allow-create="true"]');
        assert.ok(nestedChild, 'nested struct pointer should expose create-enabled child row');
        nestedChild!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const create = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="create-struct-ptr"]');
        assert.ok(create, 'nested struct pointer should enable create');
        create!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const targetPins = pinsForTarget(leaf.id, 0x30);
        assert.strictEqual(targetPins.length, 1, 'nested create should add leaf target pin once');
        const source = targetPins[0].pointerSources?.[0];
        assert.ok(source, 'nested create should store source metadata');
        assert.strictEqual(source!.sourcePinId, 'pin_parent_inline_ptr');
        assert.strictEqual(source!.sourceStructId, inner.id);
        assert.strictEqual(source!.sourceFieldPath, 'next');
        assert.strictEqual(source!.pointerStorageAddress, 0x20);
        assert.strictEqual(source!.targetAddress, 0x30);
    });

    test('defaults bit-field parent binary to full storage range', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_binary_modes', structId: 'bit_binary_modes', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x33]);

        await renderPinsAndExpandCard();

        const bitHeader = document.querySelector<HTMLElement>('.si-bitunit-hdr');
        assert.ok(bitHeader, 'bit-field parent header should render');

        const parentValue = bitHeader!.querySelector<HTMLElement>('.si-f-val');
        assert.ok(parentValue, 'bit-field parent should render a value');
        assert.strictEqual(parentValue!.dataset.valType, 'bin', 'bit-field parent should default to full binary');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00110011', 'full binary should show the complete u8 storage range');

        const labels = openValueMenuLabels(bitHeader!, dom);
        assert.ok(labels.includes('Binary'), 'View as should include full Binary');
        assert.ok(labels.includes('Binary (bit fields only)'), 'View as should include bit-fields-only binary');

        const slicedItem = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="disp-bin-sliced"]');
        assert.ok(slicedItem, 'sliced binary menu item should render');
        slicedItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const slicedValue = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-f-val');
        assert.ok(slicedValue, 'bit-field parent should rerender after selecting sliced binary');
        assert.strictEqual(slicedValue!.dataset.valType, 'bin-sliced', 'sliced binary should use its own value type');
        assert.strictEqual(slicedValue!.textContent?.replace(/\s+/g, ''), '0011', 'sliced binary should show the declared bit range as one value');

        const parentExpand = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-arr-exp-btn');
        assert.ok(parentExpand, 'bit-field parent should be expandable');
        parentExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValues = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'));
        assert.ok(childValues.length >= 2, 'bit-field child rows should render after expanding parent');
        assert.ok(childValues.every(el => el.dataset.valType === 'bin'), 'changing bit-field parent view should not change child row views');

        const firstChild = document.querySelector<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start]');
        assert.ok(firstChild, 'first bit-field child should render');
        firstChild!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));

        const childDecItem = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="disp-dec"]');
        assert.ok(childDecItem, 'bit-field child decimal menu item should render');
        childDecItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const parentAfterChildChange = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-f-val');
        assert.ok(parentAfterChildChange, 'bit-field parent should still render after changing a child');
        assert.strictEqual(parentAfterChildChange!.dataset.valType, 'bin-sliced', 'changing a bit-field child should not change parent view');

        const childValuesAfterChange = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val'));
        assert.strictEqual(childValuesAfterChange[0]?.dataset.valType, 'dec', 'changing a bit-field child should affect that child');
        assert.strictEqual(childValuesAfterChange[1]?.dataset.valType, 'bin', 'changing a bit-field child should not affect sibling children');
    });

    test('omits sliced binary when bit fields fill parent storage', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_full_range_menu', structId: 'bit_full_range_menu', addr: 0x200, name: 'inst' }];
        setBytesInSegment(0x200, [0x33]);

        await renderPinsAndExpandCard();

        const bitHeader = document.querySelector<HTMLElement>('.si-bitunit-hdr');
        assert.ok(bitHeader, 'bit-field parent header should render');
        const labels = openValueMenuLabels(bitHeader!, dom);
        assert.ok(labels.includes('Binary'), 'View as should include full Binary');
        assert.ok(!labels.includes('Binary (bit fields only)'), 'View as should omit bit-fields-only binary when it matches full range');
    });

    test('copies bit-field parent and child values from the clicked row', async () => {
        const writes = captureClipboardWrites();

        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_copy_rows', structId: 'bit_copy_rows', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xB1]);

        await renderPinsAndExpandCard();

        const parent = document.querySelector<HTMLElement>('.si-bitunit-hdr');
        assert.ok(parent, 'bit-field parent should render');
        parent!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const parentCopyHex = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="copy-hex"]');
        assert.ok(parentCopyHex, 'parent copy hex item should render');
        parentCopyHex!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(writes.pop(), '0xB1', 'parent copy should use the aggregate storage value');

        const expandParent = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-arr-exp-btn');
        assert.ok(expandParent, 'bit-field parent should be expandable');
        expandParent!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const children = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start]'));
        assert.strictEqual(children.length, 3, 'three bit-field children should render');
        children[1]!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const childCopyDec = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="copy-dec"]');
        assert.ok(childCopyDec, 'child copy decimal item should render');
        childCopyDec!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.strictEqual(writes.pop(), '6', 'child copy should use the clicked bit-field child value');
    });

    test('copies every struct value format as a single line', async () => {
        const writes = captureClipboardWrites();
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_single_line_copy', structId: 'single_line_copy', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF,
            0x00, 0x00, 0x80, 0x3F,
            0x41, 0x0A, 0x42, 0x43,
            0x12, 0x34, 0x56, 0x78,
        ]);

        await renderPinsAndExpandCard();

        const copyFromRow = (row: HTMLElement, cmd: string): string => {
            row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
            const item = document.querySelector<HTMLElement>(`#si-val-menu .ctx-row[data-cmd="${cmd}"]`);
            assert.ok(item, `${cmd} menu item should render`);
            item!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
            const copied = writes.pop();
            assert.ok(copied !== undefined, `${cmd} should write to clipboard`);
            assert.ok(!/[\r\n]/.test(copied!), `${cmd} should copy a single line`);
            return copied!;
        };

        const rows = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-field'));
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

        const bitParent = document.querySelector<HTMLElement>('.si-bitunit-hdr');
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
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_wide_bit_parent_binary', structId: 'wide_bit_parent_binary', addr: 0x500, name: 'inst' }];
        setBytesInSegment(0x500, [0x12, 0x34, 0x56, 0x78]);

        await renderPinsAndExpandCard();

        const parentValue = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-f-val[data-val-type="bin"]');
        assert.ok(parentValue, 'wide bit-field parent should render full binary by default');
        assert.strictEqual(parentValue!.querySelectorAll('br').length, 1, 'uint32 bit-field parent binary should wrap after 16 bits');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '01111000010101100011010000010010', 'wide bit-field parent binary should follow shared byte order');

        const expandBits = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-arr-exp-btn');
        assert.ok(expandBits, 'wide bit-field parent should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const firstChild = document.querySelector<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start]');
        assert.ok(firstChild, 'wide bit-field child row should render');
        firstChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const selectedBits = Array.from(document.querySelectorAll<HTMLElement>('.si-bitunit-hdr .si-f-val[data-val-type="bin"] .si-bit.sel'));
        assert.strictEqual(selectedBits.length, 4, 'selecting a wide bit-field child should highlight its bits on the wrapped parent value');
        assert.deepStrictEqual(
            selectedBits.map(el => el.dataset.bitIdx).sort(),
            ['0', '1', '2', '3'],
            'wrapped parent binary highlight should preserve bit indexes across lines',
        );
    });

    test('groups bit-field child binary from lower bits first', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_child_binary_grouping', structId: 'bit_child_binary_grouping', addr: 0x300, name: 'inst' }];
        setBytesInSegment(0x300, [0x00]);

        await renderPinsAndExpandCard();

        const parentExpand = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-arr-exp-btn');
        assert.ok(parentExpand, 'bit-field parent should be expandable');
        parentExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValue = document.querySelector<HTMLElement>('.si-arr-grp-body .si-field[data-bit-start] .si-f-val');
        assert.ok(childValue, 'bit-field child value should render');
        assert.strictEqual(childValue!.textContent, '0 0000', 'bit-field child binary should keep the lower four bits packed together');
    });

    test('array header view changes direct bit-field elements only', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_array_view_scope', structId: 'bit_array_view_scope', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0x33, 0x55]);

        await renderPinsAndExpandCard();

        const arrayHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr');
        assert.ok(arrayHeader, 'bit-field array header should render');
        arrayHeader!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));

        const hexItem = document.querySelector<HTMLElement>('#si-val-menu .ctx-row[data-cmd="disp-hex"]');
        assert.ok(hexItem, 'array header hex menu item should render');
        hexItem!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandArray = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(expandArray, 'bit-field array should be expandable');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const elementValues = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-hdr.si-bitunit-hdr .si-f-val'));
        assert.strictEqual(elementValues.length, 2, 'bit-field array should render two direct element aggregate values');
        assert.ok(elementValues.every(el => el.dataset.valType === 'hex'), 'array header view should change direct bit-field element parents');

        const expandFirstElement = document.querySelector<HTMLElement>('.si-arr-el-hdr.si-bitunit-hdr .si-arr-el-exp-btn');
        assert.ok(expandFirstElement, 'bit-field array element should be expandable');
        expandFirstElement!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childValues = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-field[data-bit-start] .si-f-val'));
        assert.ok(childValues.length > 0, 'bit-field array element should render child bit rows');
        assert.ok(childValues.every(el => el.dataset.valType === 'bin'), 'array header view should not change nested bit-field children');
    });

    test('highlights array bit-field parent bits and selected child row', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_array_highlight', structId: 'bit_array_highlight', addr: 0x100, name: 'inst' }];
        setBytesInSegment(0x100, [0x33, 0x55]);

        await renderPinsAndExpandCard();

        const expandArray = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(expandArray, 'bit-field array should be expandable');
        expandArray!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandFirstElement = document.querySelector<HTMLElement>('.si-arr-el-hdr.si-bitunit-hdr .si-arr-el-exp-btn');
        assert.ok(expandFirstElement, 'bit-field array element should be expandable');
        expandFirstElement!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const firstChild = document.querySelector<HTMLElement>('.si-arr-el-body .si-field[data-bit-start]');
        assert.ok(firstChild, 'bit-field child row should render');

        firstChild!.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true }));
        const hoveredBits = document.querySelectorAll<HTMLElement>('.si-arr-el-hdr.si-bitunit-hdr .si-f-val .si-bit.hov');
        assert.ok(hoveredBits.length > 0, 'hovering array bit-field child should highlight bits in the element parent value');

        firstChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
        assert.ok(firstChild!.classList.contains('si-selected'), 'selecting bit-field child should highlight the child row');

        const selectedBits = document.querySelectorAll<HTMLElement>('.si-arr-el-hdr.si-bitunit-hdr .si-f-val .si-bit.sel');
        assert.ok(selectedBits.length > 0, 'selecting array bit-field child should highlight bits in the element parent value');
    });

    test('renders nested bit-field arrays with declared field names', async () => {
        const child: StructDef = {
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
        const parent: StructDef = {
            id: 'parent_bits',
            name: 'ParentBits',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'child_bits', count: 2 },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_nested_bits', structId: 'parent_bits', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const parentGroupExpand = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-exp-btn');
        assert.ok(parentGroupExpand, 'nested struct array group should be expandable');
        parentGroupExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const elementExpand = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-arr-el-exp-btn');
        assert.ok(elementExpand, 'nested struct array element should be expandable');
        elementExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedBitGroup = document.querySelector<HTMLElement>('.si-arr-el-body .si-arr-grp-hdr .si-f-name');
        assert.ok(nestedBitGroup, 'nested bit-field group should render a header');
        assert.strictEqual(nestedBitGroup!.textContent ?? '', 'field0', 'nested bit-field group should show the declared field name');

        const nestedBitExpand = document.querySelector<HTMLElement>('.si-arr-el-body .si-arr-grp .si-arr-exp-btn');
        assert.ok(nestedBitExpand, 'nested bit-field group should be expandable');
        nestedBitExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedElementNames = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-arr-el-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(nestedElementNames.includes('[0]'), 'nested bit-field array should show element index [0]');
        assert.ok(nestedElementNames.includes('[1]'), 'nested bit-field array should show element index [1]');

        const nestedChildNames = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-arr-el-body .si-field .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(nestedChildNames.includes('mode'), 'nested bit-field child row should contain mode');
        assert.ok(nestedChildNames.includes('flags'), 'nested bit-field child row should contain flags');
        assert.ok(!nestedChildNames.includes('BitField'), 'nested bit-field groups should not use synthetic labels');
    });

    test('renders nested single bit-field groups like top-level bit-field groups', async () => {
        S.structs = nestedSingleBitFieldStructs();
        S.structPins = [{ id: 'pin_nested_single_bits', structId: 'parent_single_bits', addr: 0x40, name: 'inst' }];
        setBytesInSegment(0x40, [0x0B]);

        await renderPinsAndExpandCard();

        const expandNode = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(expandNode, 'nested struct node should be expandable');
        expandNode!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedBitHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-body > .si-arr-grp > .si-bitunit-hdr');
        assertNestedSingleBitFieldHeader(nestedBitHeader);

        assertNestedSingleBitFieldValue(nestedBitHeader!);

        const expandBits = nestedBitHeader!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expandBits, 'nested bit-field group should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        assertNestedSingleBitFieldChildren();
    });

    function assertNestedSingleBitFieldHeader(nestedBitHeader: HTMLElement | null): void {
        assert.ok(nestedBitHeader, 'nested single bit-field group should use the scalar-like bit-field header');
        const header = nestedBitHeader as HTMLElement;
        assert.strictEqual(requiredText(header, '.si-f-name'), 'control', 'nested bit-field header should use declared field name');
        assert.strictEqual(requiredText(header, '.si-f-off'), '+000', 'nested bit-field header should show its byte offset');
        assert.strictEqual(requiredText(header, '.si-f-type'), 'u8', 'nested bit-field header should show the base scalar type');
    }

    function requiredText(root: HTMLElement, selector: string): string {
        return root.querySelector<HTMLElement>(selector)?.textContent ?? '';
    }

    function assertNestedSingleBitFieldValue(nestedBitHeader: HTMLElement): void {
        const parentValue = nestedBitHeader.querySelector<HTMLElement>('.si-f-val');
        assert.ok(parentValue, 'nested bit-field parent should show an aggregate value');
        assert.strictEqual(parentValue!.dataset.valType, 'bin', 'nested bit-field parent should default to full binary');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00001011', 'nested bit-field parent should show full storage binary');
    }

    function assertNestedSingleBitFieldChildren(): void {
        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-body .si-field[data-bit-start] .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(childNames.includes('mode'), 'nested bit-field child row should contain mode');
        assert.ok(childNames.includes('enabled'), 'nested bit-field child row should contain enabled');
    }

    function nestedSingleBitFieldStructs(): StructDef[] {
        const child: StructDef = {
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
        const parent: StructDef = {
            id: 'parent_single_bits',
            name: 'ParentSingleBits',
            fields: [
                { name: 'node', type: 'struct', refStructId: 'child_single_bits', count: 1 },
            ],
        };
        return [child, parent];
    }

    test('keeps scalar arrays separate from bit-field groups', async () => {
        const def: StructDef = {
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

        S.structs = [def];
        S.structPins = [{ id: 'pin_mixed_bits', structId: 'mixed_bits', addr: 0, name: 'inst' }];

        await renderPinsAndExpandCard();

        const topHeaders = getTopStructFieldHeaders();
        assert.deepStrictEqual(topHeaders, ['field0', 'data', 'field1'], 'mixed sibling groups should keep their declared order and names');

        const dataGroup = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp:nth-child(2)');
        assert.ok(dataGroup, 'scalar array group should render at the top level');
        const dataExpand = dataGroup!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(dataExpand, 'scalar array group should be expandable');
        dataExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const scalarArrayNames = Array.from(dataGroup!.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(scalarArrayNames.includes('[0]'), 'scalar array should keep index-only child labels');
        assert.ok(scalarArrayNames.includes('[1]'), 'scalar array should keep index-only child labels');
        assert.ok(scalarArrayNames.includes('[2]'), 'scalar array should keep index-only child labels');
        assert.ok(!scalarArrayNames.includes('BitField'), 'scalar arrays should not be reclassified as bit-field groups');
    });
});
