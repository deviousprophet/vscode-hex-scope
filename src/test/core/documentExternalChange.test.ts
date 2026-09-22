import * as assert from 'assert';
import { createExternalChangeGate } from '../../core/documentExternalChange';

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
});
