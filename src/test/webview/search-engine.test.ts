import * as assert from 'assert';
import { shouldNavigateCompletedSearch } from '../../webview/search/searchEngine';

suite('search engine glue — completed-query navigation decision', () => {
    const KEY = 'bytes|n/a|de ad';

    test('navigates on Enter for an unchanged completed query', () => {
        assert.ok(shouldNavigateCompletedSearch('DE AD', KEY, 'enter-next', KEY));
    });

    test('navigates prev on Shift+Enter for an unchanged completed query', () => {
        assert.ok(shouldNavigateCompletedSearch('DE AD', KEY, 'enter-prev', KEY));
    });

    test('does not navigate on the run button even when the query matches', () => {
        assert.ok(!shouldNavigateCompletedSearch('DE AD', KEY, 'button', KEY));
    });

    test('does not navigate an empty query', () => {
        assert.ok(!shouldNavigateCompletedSearch('', KEY, 'enter-next', KEY));
    });

    test('does not navigate when the search key differs (changed query/mode/endian)', () => {
        assert.ok(!shouldNavigateCompletedSearch('BE', 'bytes|n/a|be', 'enter-next', KEY));
        assert.ok(!shouldNavigateCompletedSearch('DE AD', 'ascii|n/a|de ad', 'enter-next', KEY));
    });

    test('does not navigate when no prior completed search exists', () => {
        assert.ok(!shouldNavigateCompletedSearch('DE AD', KEY, 'enter-next', ''));
    });
});
