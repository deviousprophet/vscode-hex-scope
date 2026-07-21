import type { ScriptHost, HexScopeAPI } from './types';
import { hexAPI } from './api/hexAPI';
import { crcAPI } from './api/crcAPI';
import { hashAPI } from './api/hashAPI';
import { execAPI } from './api/execAPI';
import { fetchAPI } from './api/fetchAPI';
import { ioAPI } from './api/ioAPI';

export function buildAPI(host: ScriptHost): HexScopeAPI {
    const io = ioAPI(host);
    return {
        hex: hexAPI(host),
        crc: crcAPI(),
        hash: hashAPI(),
        exec: execAPI(host),
        fetch: fetchAPI(host),
        output: io.output,
        setResult: io.setResult,
        assert: io.assert,
    };
}
