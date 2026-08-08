import * as assert from 'assert';

import { clampWindowTop } from '../../webview/render/virtualScroll';

suite('webview virtualScroll clampWindowTop', () => {
    test('windowTop is clamped so the slice never overflows physicalHeight', () => {
        const physicalHeight = 16_000_000;
        const sliceHeight = 644.8;
        // windowTop positioned at the very bottom plus buffer overflow would exceed the container.
        const overflowing = physicalHeight - sliceHeight + 197;
        const clamped = clampWindowTop(overflowing, physicalHeight, sliceHeight);
        assert.strictEqual(clamped + sliceHeight, physicalHeight, 'slice bottom must sit at physicalHeight, not past it');
        assert.ok(clamped >= 0);
    });

    test('clamp is a no-op when the slice already fits', () => {
        const physicalHeight = 16_000_000;
        const sliceHeight = 644.8;
        const fits = 500;
        assert.strictEqual(clampWindowTop(fits, physicalHeight, sliceHeight), fits);
    });

    test('clamp never goes negative for an oversized offset', () => {
        const physicalHeight = 1000;
        const sliceHeight = 800;
        assert.strictEqual(clampWindowTop(-50, physicalHeight, sliceHeight), 0);
        assert.strictEqual(clampWindowTop(9999, physicalHeight, sliceHeight), 200);
    });
});
