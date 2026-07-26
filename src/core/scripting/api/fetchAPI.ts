import { request as httpRequest, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ScriptHost, FetchResult, FetchOptions } from '../types';

const DEFAULT_MAX_SIZE = 1_048_576; // 1 MiB

/**
 * Check if hostname is loopback or link-local (SSRF prevention).
 * Matches: 127.0.0.0/8, ::1, 169.254.0.0/16, fe80::/10, localhost,
 * and numeric IP forms (decimal 2130706433, hex 0x7f000001, octal 0177.0.0.1).
 */
export function isPrivateHost(hostname: string): boolean {
    const h = hostname.replace(/^\[|\]$/g, '');
    if (/^::1$/.test(h) || /^localhost$/i.test(h) || /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) { return true; }
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || /^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) { return true; }
    if (h.startsWith('fe80:')) { return true; }
    if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) { return true; }
    if (/^0\d+\./.test(h)) { return true; }
    return false;
}

function isOkStatus(code: number): boolean {
    return code >= 200 && code < 300;
}

function buildRequestOptions(url: URL, options: RequestInit = {}): RequestOptions {
    return {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: (options.method || 'GET') as string,
        headers: options.headers as Record<string, string> | undefined,
    };
}

export function oversizeResponse(cl: string | undefined, maxSize: number): number | null {
    const n = parseInt(cl ?? '', 10);
    return !isNaN(n) && n > maxSize ? n : null;
}

function httpFetch(url: URL, maxSize: number, options: RequestInit = {}): Promise<FetchResult> {
    const lib = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const reqOpts = buildRequestOptions(url, options);
    return new Promise((resolve, reject) => {
        const req = lib(reqOpts, res => {
            const tooBig = oversizeResponse(res.headers['content-length'] as string | undefined, maxSize);
            if (tooBig !== null) {
                res.destroy();
                resolve({ ok: false, status: 0, body: `Response too large: content-length ${tooBig} exceeds limit of ${maxSize}` });
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
                const total = chunks.reduce((s, c) => s + c.length, 0) + chunk.length;
                if (total > maxSize) {
                    res.destroy();
                    resolve({ ok: false, status: 0, body: `Response exceeded ${maxSize} byte limit` });
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => resolve({
                ok: isOkStatus(res.statusCode ?? 500),
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
            res.on('error', reject);
        });
        req.on('error', reject);
        if (options.body) { req.write(options.body as string); }
        req.end();
    });
}

function checkSSRF(url: URL, options?: FetchOptions): FetchResult | null {
    if (options?.allowLoopback) { return null; }
    if (!isPrivateHost(url.hostname)) { return null; }
    return { ok: false, status: 0, body: `Blocked request to private host: ${url.hostname}` };
}

function fetchMaxSize(options?: FetchOptions): number {
    return options?.maxSize ?? DEFAULT_MAX_SIZE;
}

export function fetchAPI(host: ScriptHost) {
    return async (urlStr: string, options?: FetchOptions): Promise<FetchResult | null> => {
        const url = new URL(urlStr);
        const blocked = checkSSRF(url, options);
        if (blocked) { return blocked; }
        if (!await host.confirm('fetch', urlStr)) { return null; }
        return httpFetch(url, fetchMaxSize(options), options);
    };
}
