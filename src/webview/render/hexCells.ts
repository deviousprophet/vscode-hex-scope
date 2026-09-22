// ── Shared hex row/cell builder ──────────────────────────────────
// One byte-to-cell implementation shared by the memory grid host and
// the diff grid host. The caller supplies the byte reader and a small
// decoration callback for its own classes; the printable/empty-cell
// model lives here.

import type { HexViewCell } from '../components/hexView/hexViewRender';
import { byteClass, esc } from '../utils';

export interface CellDecoration {
    /** Extra hex-cell classes (dirty/integrity/diff). */
    hexCls?: string;
    /** Extra char-cell classes (dirty/integrity/diff placeholder). */
    charCls?: string;
    /** Char-cell text override; defaults to the printable glyph / empty. */
    char?: string;
}

const EMPTY_CELL: HexViewCell = { hex: ' ', char: ' ', cls: 'be' };

export function isPrintableByte(value: number): boolean {
    return value >= 0x20 && value < 0x7F;
}

export function buildHexCells(
    base: number,
    bytesPerRow: number,
    readByte: (addr: number) => number | undefined,
    decorate: (addr: number, val: number) => CellDecoration,
): HexViewCell[] {
    const cells: HexViewCell[] = [];
    for (let col = 0; col < bytesPerRow; col++) {
        const addr = base + col;
        const value = readByte(addr);
        cells.push(value === undefined ? EMPTY_CELL : dataCell(value, decorate(addr, value)));
    }
    return cells;
}

function dataCell(value: number, decoration: CellDecoration): HexViewCell {
    const printable = isPrintableByte(value);
    return {
        hex: value.toString(16).toUpperCase().padStart(2, '0'),
        char: charText(value, printable, decoration.char),
        cls: byteClass(value) + suffix(decoration.hexCls),
        charCls: charClass(printable) + suffix(decoration.charCls),
        val: value,
    };
}

function charText(value: number, printable: boolean, override: string | undefined): string {
    if (override !== undefined) { return override; }
    return printable ? esc(String.fromCharCode(value)) : '';
}

function charClass(printable: boolean): string {
    return printable ? 'cp' : 'cd';
}

function suffix(cls: string | undefined): string {
    return cls ?? '';
}
