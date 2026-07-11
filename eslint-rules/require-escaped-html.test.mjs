import { RuleTester } from 'eslint';
import { requireEscapedHtml } from './require-escaped-html.mjs';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

tester.run('require-escaped-html', requireEscapedHtml, {
    valid: [
        'el.innerHTML = `<b>${esc(label)}</b>`;',
        'el.innerHTML = `<b>${rowHtml}</b>`;',
        'el.innerHTML = renderRowsHtml(rows);',
        'el.innerHTML = `<b class="${activeClass(true)}">ok</b>`;',
        'el.innerHTML = "<b>static</b>";',
    ],
    invalid: [
        {
            code: 'el.innerHTML = `<b>${label}</b>`;',
            errors: [{ messageId: 'unescaped' }],
        },
        {
            code: 'el.insertAdjacentHTML("beforeend", `<b>${label}</b>`);',
            errors: [{ messageId: 'unescaped' }],
        },
        {
            code: 'el.outerHTML = `<b>${label}</b>`;',
            errors: [{ messageId: 'unescaped' }],
        },
        {
            code: 'el.innerHTML = label;',
            errors: [{ messageId: 'unescaped' }],
        },
    ],
});
