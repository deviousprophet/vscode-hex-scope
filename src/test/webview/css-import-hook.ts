// Compiled tests run as CJS in Node/Electron and require() webview
// modules that carry side-effect CSS imports (e.g. SearchBar.css). Node has
// no .css loader, and tsc does not copy .css assets, so:
//  1. teach require() to swallow .css (no-op handler)
//  2. mirror every src/webview/**/*.css into the compiled out/webview tree so
//     relative `require('./X.css')` resolution succeeds.
// Walk is dynamic: new components under components/ are picked up with no
// hook changes. Import this module before any webview component import.
import * as fs from 'fs';
import * as path from 'path';

const nodeRequire = require as unknown as {
    extensions: Record<string, (module: unknown, filename: string) => void>;
};

if (!nodeRequire.extensions['.css']) {
    nodeRequire.extensions['.css'] = () => {};
}

const srcWebview = path.resolve(__dirname, '..', '..', '..', 'src', 'webview');
const outWebview = path.resolve(__dirname, '..', '..', 'webview');

function mirrorCss(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            mirrorCss(full);
        } else if (entry.isFile() && full.endsWith('.css')) {
            const rel = path.relative(srcWebview, full);
            const target = path.join(outWebview, rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (!fs.existsSync(target)) {
                fs.writeFileSync(target, '');
            }
        }
    }
}

mirrorCss(srcWebview);
