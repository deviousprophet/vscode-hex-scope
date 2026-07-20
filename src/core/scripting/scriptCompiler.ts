import * as fs from 'node:fs';
import * as path from 'node:path';

type CompileFn = (code: string) => string;

const mtimeCache = new Map<string, number>();
let compile: CompileFn | null = null;

async function getCompiler(): Promise<CompileFn | null> {
    if (compile) { return compile; }
    try {
        const esbuild = await import('esbuild');
        compile = (code: string): string => {
            const result = esbuild.transformSync(code, {
                loader: 'ts',
                format: 'cjs',
                sourcemap: false,
                target: 'node20',
            });
            return result.code;
        };
        return compile;
    } catch {
        return null;
    }
}

export function isScriptFile(name: string): boolean {
    return name.endsWith('.js') || name.endsWith('.ts');
}

function needsCompile(name: string): boolean {
    return name.endsWith('.ts');
}

export function readScript(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
}

function cacheValid(filePath: string): boolean {
    const cached = mtimeCache.get(filePath);
    if (cached === undefined) { return false; }
    try { return fs.statSync(filePath).mtimeMs <= cached; } catch { return false; }
}

function markCached(filePath: string): void {
    try { mtimeCache.set(filePath, fs.statSync(filePath).mtimeMs); } catch { /* ignore */ }
}

export async function compileScript(source: string, filePath: string): Promise<string> {
    const name = path.basename(filePath);
    if (!needsCompile(name)) { return source; }
    if (cacheValid(filePath)) { throw new Error('unreachable'); }
    const c = await getCompiler();
    if (!c) { throw new Error('TypeScript compiler (esbuild) unavailable. Use .js or run npm install.'); }
    const result = c(source);
    markCached(filePath);
    return result;
}
