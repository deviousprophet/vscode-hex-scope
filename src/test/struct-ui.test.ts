import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import { S } from '../webview/state';
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
                { name: 'mode', type: 'uint16', bitWidth: 3, count: 1, endian: 'inherit' },
                { name: 'flags', type: 'uint16', bitWidth: 5, count: 1, endian: 'inherit' },
            ],
        };

        S.structs = [def];
        S.structPins = [{ id: 'pin_bits', structId: 'bit_struct', addr: 0, name: 'inst' }];

        const { renderStructPins } = await import('../webview/struct.js');
        renderStructPins();

        const expandCard = document.querySelector<HTMLElement>('.si-expand-btn');
        assert.ok(expandCard, 'expand button should render');
        expandCard!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const unitHeader = document.querySelector<HTMLElement>('.si-arr-grp-hdr .si-f-name');
        assert.ok(unitHeader, 'bit-field unit header should render');
        assert.strictEqual(unitHeader!.textContent ?? '', 'BitField', 'bit-field header should display BitField');

        const unitType = document.querySelector<HTMLElement>('.si-arr-grp-hdr .si-f-type');
        assert.ok(unitType, 'bit-field header should show scalar-like type');
        assert.strictEqual(unitType!.textContent ?? '', 'u16', 'bit-field header should use base scalar type');

        const unitOffset = document.querySelector<HTMLElement>('.si-arr-grp-hdr .si-f-off');
        assert.ok(unitOffset, 'bit-field header should show scalar-like offset');

        const unitValue = document.querySelector<HTMLElement>('.si-arr-grp-hdr .si-f-val');
        assert.ok(unitValue, 'bit-field unit should show scalar-like value cell');
        assert.strictEqual(unitValue!.dataset.valType, 'bin', 'bit-field parent row should default to binary view');

        const unitExpand = document.querySelector<HTMLElement>('.si-arr-grp-hdr .si-arr-exp-btn');
        assert.ok(unitExpand, 'bit-field unit should be expandable');
        unitExpand!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const childNames = Array.from(document.querySelectorAll<HTMLElement>('.si-arr-grp-body .si-field .si-f-name'))
            .map(el => el.textContent ?? '');
        assert.ok(childNames.includes('mode'), 'bit-field child row should contain mode');
        assert.ok(childNames.includes('flags'), 'bit-field child row should contain flags');

        const childType = document.querySelector<HTMLElement>('.si-arr-grp-body .si-field .si-f-type');
        assert.ok(childType, 'bit-field child row should show type');
        assert.strictEqual(childType!.textContent ?? '', 'bit:3', 'bit-field child type should be displayed as bit:N');

        const childOffset = document.querySelector<HTMLElement>('.si-arr-grp-body .si-field .si-f-off');
        assert.ok(childOffset, 'bit-field child row should show offset');
        assert.strictEqual(childOffset!.textContent ?? '', '.0', 'bit-field child offset should use .N format');

        const firstChild = document.querySelector<HTMLElement>('.si-arr-grp-body .si-field');
        assert.ok(firstChild, 'first bit-field child should render');
        firstChild!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

        const selectedBits = document.querySelectorAll<HTMLElement>('.si-arr-grp-hdr .si-f-val .si-bit.sel');
        assert.ok(selectedBits.length > 0, 'selecting bit-field child should highlight corresponding parent bits');

        const selectedRows = document.querySelectorAll<HTMLElement>('.si-field.si-selected');
        assert.strictEqual(selectedRows.length, 0, 'bit-field child selection should not apply row selection/jump styling');

        // Hover highlight should clear when pointer leaves the struct panel.
        const panel = document.getElementById('s-struct-pins');
        assert.ok(panel, 'struct panel should exist');
        panel!.dispatchEvent(new dom.window.MouseEvent('mouseleave', { bubbles: true }));

        const selectedBitsAfterLeave = document.querySelectorAll<HTMLElement>('.si-arr-grp-hdr .si-f-val .si-bit.sel');
        assert.ok(selectedBitsAfterLeave.length > 0, 'selected highlight should remain after hover leaves');
    });
});
