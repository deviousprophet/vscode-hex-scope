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

        const result = parseSourceRecordLine(trimmed, i + 1, parseLine, onRecord);
        records.push(result.record);
        checksumErrors += result.checksumErrorCount;
        malformedLines += result.malformedLineCount;
    }

    return { records, checksumErrors, malformedLines };
}

function parseSourceRecordLine(
    line: string,
    lineNumber: number,
    parseLine: (line: string, lineNumber: number) => HexRecord,
    onRecord?: (record: HexRecord) => void,
): { record: HexRecord; checksumErrorCount: number; malformedLineCount: number } {
    const record = parseLine(line, lineNumber);
    if (record.error) {
        return { record, checksumErrorCount: 0, malformedLineCount: 1 };
    }
    onRecord?.(record);
    return { record, checksumErrorCount: record.checksumValid ? 0 : 1, malformedLineCount: 0 };
}
