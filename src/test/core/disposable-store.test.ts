import * as assert from 'assert';
import { DisposableStore } from '../../core/disposableStore';

suite('DisposableStore', () => {
    test('disposes resources once in reverse ownership order', () => {
        const events: string[] = [];
        const store = new DisposableStore();
        store.add(() => events.push('first'));
        store.add({ dispose: () => events.push('second') });

        store.dispose();
        store.dispose();

        assert.deepStrictEqual(events, ['second', 'first']);
        assert.strictEqual(store.isDisposed, true);
    });

    test('immediately disposes resources added after disposal', () => {
        let disposed = 0;
        const store = new DisposableStore();
        store.dispose();

        store.add(() => { disposed++; });

        assert.strictEqual(disposed, 1);
    });

    test('runs every cleanup when one throws', () => {
        const events: string[] = [];
        const store = new DisposableStore();
        store.add(() => events.push('first'));
        store.add(() => { throw new Error('cleanup failed'); });

        assert.throws(() => store.dispose(), /cleanup failed/);
        assert.deepStrictEqual(events, ['first']);
    });
});
