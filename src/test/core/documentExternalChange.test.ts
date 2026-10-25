import * as assert from 'assert';
import { bytesEqual } from '../../core/bytesEqual';
import { createExternalChangeGate, sameDocumentSource } from '../../core/documentExternalChange';

suite('documentExternalChange', () => {
    test('suppresses a watcher event whose content is unchanged', () => {
        const gate = createExternalChangeGate(1000);
        assert.strictEqual(gate.shouldHandle('same', true, 'same', 5000), false);
    });

    test('suppresses a watcher event delivered before the initial load finished', () => {
        const gate = createExternalChangeGate(1000);
        assert.strictEqual(gate.shouldHandle('new', false, 'old', 5000), false);
    });

    test('handles a genuine external content change', () => {
        const gate = createExternalChangeGate(1000);
        assert.strictEqual(gate.shouldHandle('new', true, 'old', 5000), true);
    });

    test('ignores events inside the self-write horizon, handles them at the exclusive boundary', () => {
        const gate = createExternalChangeGate(1000);
        gate.markSelfWrite(5000);
        assert.strictEqual(gate.shouldHandle('new', true, 'old', 5000), false);
        assert.strictEqual(gate.shouldHandle('new', true, 'old', 5999), false);
        assert.strictEqual(gate.isSelfWrite(5999), true);
        // The horizon is exclusive: exactly horizonMs later the event is real.
        assert.strictEqual(gate.shouldHandle('new', true, 'old', 6000), true);
        assert.strictEqual(gate.isSelfWrite(6000), false);
    });

    test('a custom comparator makes raw byte arrays compare by content', () => {
        const gate = createExternalChangeGate<Uint8Array>(1000, bytesEqual);
        const a = Uint8Array.from([1, 2, 3]);
        const b = Uint8Array.from([1, 2, 3]);
        const c = Uint8Array.from([1, 2, 4]);

        assert.strictEqual(gate.shouldHandle(b, true, a, 5000), false, 'equal content is not a change');
        assert.strictEqual(gate.shouldHandle(c, true, a, 5000), true, 'different content is a change');
        assert.strictEqual(gate.shouldHandle(Uint8Array.from([1, 2]), true, a, 5000), true, 'length differs');
    });

    test('sameDocumentSource compares strings by value and bytes byte-for-byte', () => {
        assert.strictEqual(sameDocumentSource('a', 'a'), true);
        assert.strictEqual(sameDocumentSource('a', 'b'), false);
        assert.strictEqual(sameDocumentSource(Uint8Array.from([0, 255]), Uint8Array.from([0, 255])), true);
        assert.strictEqual(sameDocumentSource(Uint8Array.from([0, 255]), Uint8Array.from([0, 254])), false);
        assert.strictEqual(sameDocumentSource('a', Uint8Array.from([97])), false, 'strings and bytes are distinct sources');
    });
});
