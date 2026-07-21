import { request as httpRequest, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ScriptHost, FetchResult } from '../types';

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

function httpFetch(url: URL, options: RequestInit = {}): Promise<FetchResult> {
    const lib = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const reqOpts = buildRequestOptions(url, options);
    return new Promise((resolve, reject) => {
        const req = lib(reqOpts, res => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve({
                ok: isOkStatus(res.statusCode ?? 500),
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        });
        req.on('error', reject);
        if (options.body) { req.write(options.body as string); }
        req.end();
    });
}

export function fetchAPI(host: ScriptHost) {
    return async (urlStr: string, options?: RequestInit): Promise<FetchResult | null> => {
        const ok = await host.confirm('fetch', urlStr);
        if (!ok) { return null; }
        return httpFetch(new URL(urlStr), options);
    };
}
