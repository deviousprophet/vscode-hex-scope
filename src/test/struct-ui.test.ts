import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { S } from '../webview/state';
import { initFlatBytes } from '../webview/data';
import type { StructDef, StructPin } from '../webview/types';

function resetStructState(): void {
    S.structs = [];
    S.structPins = [];
    S.activeStructAddr = null;
    S.parseResult = null;
    S.segmentIndex = [];
    S.endian = 'le';
    S.sidebarTab = 'struct';
}

function setBytesInSegment(baseAddr: number, bytes: number[]): void {
    S.parseResult = {
        records: [],
        segments: [{ startAddress: baseAddr, data: bytes }],
        totalDataBytes: bytes.length,
        checksumErrors: 0,
        malformedLines: 0,
        format: 'ihex',
    };
    initFlatBytes();
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

    test('uses declared struct type and element count for nested struct array header', async () => {
        const child: StructDef = {
            id: 'child',
            name: 'ChildNode',
            fields: [
                { name: 'a', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'b', type: 'uint16', count: 1, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'child', count: 3, endian: 'inherit' },
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expand = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expand, 'expand button should be rendered');
        expand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'field0', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'field1', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'field2', type: 'uint8', count: 2, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'child', count: 2, endian: 'inherit' },
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should be rendered');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'field0', type: 'uint32', count: 1, endian: 'inherit' },
                { name: 'field1', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'field2', type: 'uint8', count: 2, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'parent',
            name: 'Parent',
            fields: [
                { name: 'field3', type: 'struct', refStructId: 'child', count: 1, endian: 'inherit' },
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should be rendered');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'field0', type: 'uint32', count: 1, endian: 'inherit' },
                { name: 'field1', type: 'uint8', count: 2, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'parent_collapse',
            name: 'ParentCollapse',
            fields: [
                { name: 'field3', type: 'struct', refStructId: 'child_collapse', count: 1, endian: 'inherit' },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_collapse', structId: 'parent_collapse', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'only', type: 'uint16', count: 1, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'single_leaf_parent',
            name: 'SingleLeafParent',
            fields: [
                { name: 'wrap', type: 'struct', refStructId: 'single_leaf_child', count: 1, endian: 'inherit' },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_single_leaf', structId: 'single_leaf_parent', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const topHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
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
                { name: 'bytes', type: 'uint8', count: 2, endian: 'inherit' },
            ],
        };
        const level2: StructDef = {
            id: 'depth_l2',
            name: 'DepthL2',
            fields: [
                { name: 'inner', type: 'struct', refStructId: 'depth_l3', count: 1, endian: 'inherit' },
            ],
        };
        const level1: StructDef = {
            id: 'depth_l1',
            name: 'DepthL1',
            fields: [
                { name: 'outer', type: 'struct', refStructId: 'depth_l2', count: 1, endian: 'inherit' },
            ],
        };

        S.structs = [level3, level2, level1];
        S.structPins = [{ id: 'pin_depth', structId: 'depth_l1', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'prefix', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'values', type: 'uint16', count: 2, endian: 'inherit' },
            ],
        };

        S.structs = [def];
        S.structPins = [{ id: 'pin_array_offset', structId: 'array_offset', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0x11, 0x22, 0x33, 0x44]);

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'a', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'b', type: 'uint16', count: 1, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'nested_offset_parent',
            name: 'NestedOffsetParent',
            fields: [
                { name: 'prefix', type: 'uint8', count: 1, endian: 'inherit' },
                { name: 'node', type: 'struct', refStructId: 'nested_offset_child', count: 1, endian: 'inherit' },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_nested_offset', structId: 'nested_offset_parent', addr: 0, name: 'inst' }];
        setBytesInSegment(0, [0xAA, 0x11, 0x22, 0x33]);

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'name', type: 'ascii', count: 8, endian: 'inherit' },
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                { name: 'field0', type: 'uint8', count: 1, endian: 'inherit' },
            ],
        };
        const mid: StructDef = {
            id: 'mid_suffix',
            name: 'MidSuffix',
            fields: [
                { name: 'children', type: 'struct', refStructId: 'leaf_suffix', count: 2, endian: 'inherit' },
            ],
        };
        const top: StructDef = {
            id: 'top_suffix',
            name: 'TopSuffix',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'mid_suffix', count: 2, endian: 'inherit' },
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                    endian: 'inherit',
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
                {
                    name: 'field1',
                    type: 'uint8',
                    count: 1,
                    endian: 'inherit',
                    bitFields: [
                        { name: 'bit0', bitWidth: 1 },
                        { name: 'bit1', bitWidth: 1 },
                    ],
                },
            ],
        };

        S.structs = [def];
        S.structPins = [{ id: 'pin_bits', structId: 'bit_struct', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const topField0 = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp:nth-child(1) > .si-arr-grp-hdr .si-f-name');
        assert.ok(topField0, 'array bit-field group should render a top-level header');
        assert.strictEqual(topField0!.textContent ?? '', 'field0', 'array bit-field group should display the declared field name');

        const topField1 = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp:nth-child(2) > .si-arr-grp-hdr .si-f-name');
        assert.ok(topField1, 'second bit-field group should render a top-level header');
        assert.strictEqual(topField1!.textContent ?? '', 'field1', 'single bit-field group should display the declared field name');

        const unitType = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-f-type');
        assert.ok(unitType, 'bit-field header should show scalar-like type');
        assert.strictEqual(unitType!.textContent ?? '', 'u8', 'bit-field header should use base scalar type');

        const unitOffset = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-f-off');
        assert.ok(unitOffset, 'bit-field header should show scalar-like offset');

        const unitValue = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-f-val');
        assert.ok(unitValue, 'bit-field unit should show scalar-like value cell');
        assert.strictEqual(unitValue!.dataset.valType, 'bin', 'bit-field parent row should default to binary view');

        const unitExpand = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(unitExpand, 'bit-field unit should be expandable');
        unitExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-el-body .si-field .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(childNames.includes('mode'), 'bit-field child row should contain mode');
        assert.ok(childNames.includes('flags'), 'bit-field child row should contain flags');

        const firstElementHeader = document.querySelector<HTMLElement>('.si-arr-el-hdr .si-f-name');
        assert.ok(firstElementHeader, 'bit-field array element should render a scalar-like header');
        assert.strictEqual(firstElementHeader!.textContent ?? '', '[0]', 'bit-field array element header should show its index');

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

    test('defaults bit-field parent binary to full storage range', async () => {
        const def: StructDef = {
            id: 'bit_binary_modes',
            name: 'BitBinaryModes',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 1,
                    endian: 'inherit',
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const bitHeader = document.querySelector<HTMLElement>('.si-bitunit-hdr');
        assert.ok(bitHeader, 'bit-field parent header should render');

        const parentValue = bitHeader!.querySelector<HTMLElement>('.si-f-val');
        assert.ok(parentValue, 'bit-field parent should render a value');
        assert.strictEqual(parentValue!.dataset.valType, 'bin', 'bit-field parent should default to full binary');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00110011', 'full binary should show the complete u8 storage range');

        bitHeader!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));
        const labels = Array.from(document.querySelectorAll<HTMLElement>('#si-val-menu .ctx-row[data-cmd^="disp-"] .ctx-label'))
            .map(el => el.textContent ?? '');
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
                    endian: 'inherit',
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const bitHeader = document.querySelector<HTMLElement>('.si-bitunit-hdr');
        assert.ok(bitHeader, 'bit-field parent header should render');
        bitHeader!.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 4 }));

        const labels = Array.from(document.querySelectorAll<HTMLElement>('#si-val-menu .ctx-row[data-cmd^="disp-"] .ctx-label'))
            .map(el => el.textContent ?? '');
        assert.ok(labels.includes('Binary'), 'View as should include full Binary');
        assert.ok(!labels.includes('Binary (bit fields only)'), 'View as should omit bit-fields-only binary when it matches full range');
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
                    endian: 'inherit',
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const parentValue = document.querySelector<HTMLElement>('.si-bitunit-hdr .si-f-val[data-val-type="bin"]');
        assert.ok(parentValue, 'wide bit-field parent should render full binary by default');
        assert.strictEqual(parentValue!.querySelectorAll('br').length, 1, 'uint32 bit-field parent binary should wrap after 16 bits');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00010010001101000101011001111000', 'wide bit-field parent binary should still show full storage bits');

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
                    endian: 'inherit',
                    bitFields: [
                        { name: 'wide', bitWidth: 5 },
                    ],
                },
            ],
        };

        S.structs = [def];
        S.structPins = [{ id: 'pin_bit_child_binary_grouping', structId: 'bit_child_binary_grouping', addr: 0x300, name: 'inst' }];
        setBytesInSegment(0x300, [0x00]);

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                    endian: 'inherit',
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                    endian: 'inherit',
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

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
                    endian: 'inherit',
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
                { name: 'payload', type: 'uint8', count: 2, endian: 'inherit' },
            ],
        };
        const parent: StructDef = {
            id: 'parent_bits',
            name: 'ParentBits',
            fields: [
                { name: 'nodes', type: 'struct', refStructId: 'child_bits', count: 2, endian: 'inherit' },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_nested_bits', structId: 'parent_bits', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

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
        const child: StructDef = {
            id: 'child_single_bits',
            name: 'ChildSingleBits',
            fields: [
                {
                    name: 'control',
                    type: 'uint8',
                    count: 1,
                    endian: 'inherit',
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
                { name: 'node', type: 'struct', refStructId: 'child_single_bits', count: 1, endian: 'inherit' },
            ],
        };

        S.structs = [child, parent];
        S.structPins = [{ id: 'pin_nested_single_bits', structId: 'parent_single_bits', addr: 0x40, name: 'inst' }];
        setBytesInSegment(0x40, [0x0B]);

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const expandNode = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(expandNode, 'nested struct node should be expandable');
        expandNode!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const nestedBitHeader = document.querySelector<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-body > .si-arr-grp > .si-bitunit-hdr');
        assert.ok(nestedBitHeader, 'nested single bit-field group should use the scalar-like bit-field header');
        assert.strictEqual(nestedBitHeader!.querySelector<HTMLElement>('.si-f-name')?.textContent ?? '', 'control', 'nested bit-field header should use declared field name');
        assert.strictEqual(nestedBitHeader!.querySelector<HTMLElement>('.si-f-off')?.textContent ?? '', '+000', 'nested bit-field header should show its byte offset');
        assert.strictEqual(nestedBitHeader!.querySelector<HTMLElement>('.si-f-type')?.textContent ?? '', 'u8', 'nested bit-field header should show the base scalar type');

        const parentValue = nestedBitHeader!.querySelector<HTMLElement>('.si-f-val');
        assert.ok(parentValue, 'nested bit-field parent should show an aggregate value');
        assert.strictEqual(parentValue!.dataset.valType, 'bin', 'nested bit-field parent should default to full binary');
        assert.strictEqual(parentValue!.textContent?.replace(/\s+/g, ''), '00001011', 'nested bit-field parent should show full storage binary');

        const expandBits = nestedBitHeader!.querySelector<HTMLElement>('.si-arr-exp-btn');
        assert.ok(expandBits, 'nested bit-field group should be expandable');
        expandBits!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-body .si-field[data-bit-start] .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(childNames.includes('mode'), 'nested bit-field child row should contain mode');
        assert.ok(childNames.includes('enabled'), 'nested bit-field child row should contain enabled');
    });

    test('keeps scalar arrays separate from bit-field groups', async () => {
        const def: StructDef = {
            id: 'mixed_bits',
            name: 'MixedBits',
            fields: [
                {
                    name: 'field0',
                    type: 'uint8',
                    count: 2,
                    endian: 'inherit',
                    bitFields: [
                        { name: 'mode', bitWidth: 3 },
                        { name: 'flags', bitWidth: 5 },
                    ],
                },
                { name: 'data', type: 'uint8', count: 3, endian: 'inherit' },
                {
                    name: 'field1',
                    type: 'uint8',
                    count: 1,
                    endian: 'inherit',
                    bitFields: [
                        { name: 'bit0', bitWidth: 1 },
                        { name: 'bit1', bitWidth: 1 },
                    ],
                },
            ],
        };

        S.structs = [def];
        S.structPins = [{ id: 'pin_mixed_bits', structId: 'mixed_bits', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const topHeaders = Array.from(document.querySelectorAll<HTMLElement>('.si-fields > .si-arr-grp > .si-arr-grp-hdr .si-f-name'))
            .map(el => el.textContent ?? '');
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
