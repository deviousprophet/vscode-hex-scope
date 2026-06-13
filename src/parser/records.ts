import type { HexRecord } from './types';

export interface ParsedRecords {
    records: HexRecord[];
    checksumErrors: number;
    malformedLines: number;
}

export function parseSourceRecords(
    source: string,
    parseLine: (line: string, lineNumber: number) => HexRecord,
    onRecord?: (record: HexRecord) => void,
): ParsedRecords {
    const records: HexRecord[] = [];
    let checksumErrors = 0;
    let malformedLines = 0;

    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '') { continue; }

        const record = parseLine(trimmed, i + 1);
        records.push(record);

        if (record.error) {
            malformedLines++;
            continue;
        }
        if (!record.checksumValid) { checksumErrors++; }
        onRecord?.(record);
    }

    return { records, checksumErrors, malformedLines };
}
