// Compiled tests run as CJS in Node/Electron and require() webview
// modules that carry side-effect CSS imports (SearchBar.css). Node has
// no .css loader, and tsc does not copy .css assets, so:
//  1. teach require() to swallow .css (no-op handler)
//  2. ensure the compiled component's css path exists so resolution succeeds
// This module must be imported before any webview component import.
import * as fs from 'fs';
import * as path from 'path';

const nodeRequire = require as unknown as {
    extensions: Record<string, (module: unknown, filename: string) => void>;
};

if (!nodeRequire.extensions['.css']) {
    nodeRequire.extensions['.css'] = () => {};
}

const compiledCss = path.join(__dirname, '..', '..', 'webview', 'components', 'SearchBar', 'SearchBar.css');
if (!fs.existsSync(compiledCss)) {
    fs.mkdirSync(path.dirname(compiledCss), { recursive: true });
    fs.writeFileSync(compiledCss, '');
}
