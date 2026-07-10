import type { HexRecord, ParseWorkOptions } from './types';

export interface ParsedRecords {
    records: HexRecord[];
    checksumErrors: number;
    malformedLines: number;
}

export interface SourceRange { start: number; end: number }

export interface ParsedRecordsWithRanges extends ParsedRecords {
    ranges: SourceRange[];
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

function defaultNow(): number { return performance.now(); }

function defaultYield(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export async function parseSourceRecordsAsync(
    source: string,
    parseLine: (line: string, lineNumber: number) => HexRecord,
    onRecord?: (record: HexRecord) => void,
    options: ParseWorkOptions = {},
): Promise<ParsedRecordsWithRanges> {
    const records: HexRecord[] = [];
    const ranges: SourceRange[] = [];
    let checksumErrors = 0;
    let malformedLines = 0;
    let lineNumber = 1;
    let cursor = 0;
    const now = options.now ?? defaultNow;
    const yieldControl = options.yieldControl ?? defaultYield;
    const budget = options.timeBudgetMs ?? 24;
    let deadline = now() + budget;

    while (cursor <= source.length) {
        if (options.signal?.aborted) { throw new Error('Parse cancelled'); }
        const newline = source.indexOf('\n', cursor);
        const lineEnd = newline < 0 ? source.length : newline;
        let start = cursor;
        let end = lineEnd > start && source.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
        while (start < end && /\s/.test(source[start])) { start++; }
        while (end > start && /\s/.test(source[end - 1])) { end--; }
        if (start < end) {
            const result = parseSourceRecordLine(source.slice(start, end), lineNumber, parseLine, onRecord);
            records.push(result.record);
            ranges.push({ start, end });
            checksumErrors += result.checksumErrorCount;
            malformedLines += result.malformedLineCount;
        }
        if (newline < 0) { break; }
        cursor = newline + 1;
        lineNumber++;
        options.onProgress?.({ stage: 'parse', completed: cursor, total: source.length });
        if (now() >= deadline) {
            await yieldControl();
            deadline = now() + budget;
        }
    }
    options.onProgress?.({ stage: 'parse', completed: source.length, total: source.length });
    return { records, ranges, checksumErrors, malformedLines };
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
