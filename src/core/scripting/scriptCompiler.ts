import * as fs from 'node:fs';
import * as path from 'node:path';

type CompileFn = (code: string) => string;
let compile: CompileFn | null | false = null;

async function getCompiler(): Promise<CompileFn | null> {
    if (compile === false) { return null; }
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
        compile = false;
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

export async function compileScript(source: string, filePath: string): Promise<string> {
    const name = path.basename(filePath);
    if (!needsCompile(name)) { return source; }
    const c = await getCompiler();
    if (!c) { throw new Error('TypeScript compiler (esbuild) unavailable. Use .js or run npm install.'); }
    return c(source);
}
