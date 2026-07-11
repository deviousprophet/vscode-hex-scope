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

interface SourceLineRange {
    start: number;
    end: number;
    nextCursor: number;
    final: boolean;
}

function sourceLineRange(source: string, cursor: number): SourceLineRange {
    const newline = source.indexOf('\n', cursor);
    const lineEnd = newline < 0 ? source.length : newline;
    const contentEnd = lineEnd > cursor && source.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    return { start: cursor, end: contentEnd, nextCursor: newline + 1, final: newline < 0 };
}

function trimSourceRange(source: string, range: SourceLineRange): SourceRange {
    let { start, end } = range;
    while (hasLeadingWhitespace(source, start, end)) { start++; }
    while (hasTrailingWhitespace(source, start, end)) { end--; }
    return { start, end };
}

function hasLeadingWhitespace(source: string, start: number, end: number): boolean {
    return start < end && /\s/.test(source[start]);
}

function hasTrailingWhitespace(source: string, start: number, end: number): boolean {
    return end > start && /\s/.test(source[end - 1]);
}

function appendParsedSourceLine(
    source: string,
    range: SourceRange,
    lineNumber: number,
    parseLine: (line: string, lineNumber: number) => HexRecord,
    onRecord: ((record: HexRecord) => void) | undefined,
    parsed: ParsedRecordsWithRanges,
): void {
    if (range.start === range.end) { return; }
    const result = parseSourceRecordLine(source.slice(range.start, range.end), lineNumber, parseLine, onRecord);
    parsed.records.push(result.record);
    parsed.ranges.push(range);
    parsed.checksumErrors += result.checksumErrorCount;
    parsed.malformedLines += result.malformedLineCount;
}

function throwIfParseCancelled(options: ParseWorkOptions): void {
    if (options.signal?.aborted) { throw new Error('Parse cancelled'); }
}

async function yieldWhenDue(
    now: () => number,
    yieldControl: () => Promise<void>,
    deadline: number,
    budget: number,
): Promise<number> {
    if (now() < deadline) { return deadline; }
    await yieldControl();
    return now() + budget;
}

function parseWorkRuntime(options: ParseWorkOptions): {
    now: () => number;
    yieldControl: () => Promise<void>;
    budget: number;
} {
    return {
        now: options.now ?? defaultNow,
        yieldControl: options.yieldControl ?? defaultYield,
        budget: options.timeBudgetMs ?? 24,
    };
}

function reportParseProgress(options: ParseWorkOptions, completed: number, total: number): void {
    options.onProgress?.({ stage: 'parse', completed, total });
}

export async function parseSourceRecordsAsync(
    source: string,
    parseLine: (line: string, lineNumber: number) => HexRecord,
    onRecord?: (record: HexRecord) => void,
    options: ParseWorkOptions = {},
): Promise<ParsedRecordsWithRanges> {
    const parsed: ParsedRecordsWithRanges = { records: [], ranges: [], checksumErrors: 0, malformedLines: 0 };
    let lineNumber = 1;
    let cursor = 0;
    const { now, yieldControl, budget } = parseWorkRuntime(options);
    let deadline = now() + budget;

    while (cursor <= source.length) {
        throwIfParseCancelled(options);
        const line = sourceLineRange(source, cursor);
        appendParsedSourceLine(source, trimSourceRange(source, line), lineNumber, parseLine, onRecord, parsed);
        if (line.final) { break; }
        cursor = line.nextCursor;
        lineNumber++;
        reportParseProgress(options, cursor, source.length);
        deadline = await yieldWhenDue(now, yieldControl, deadline, budget);
    }
    reportParseProgress(options, source.length, source.length);
    return parsed;
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
