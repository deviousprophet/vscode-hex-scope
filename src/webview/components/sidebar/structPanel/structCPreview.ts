/** Struct panel — C preview token/line builders and render/hydrate entry points.
Extracted verbatim from structPanel.ts (pure move). */
import { allStructs, structToC } from '../../../../core/structCodec.js';
import type { StructDef } from '../../../../core/types';

// ── C syntax-highlighted struct preview ─────────────────────────────────────

export const SC_KW   = /\b(typedef|struct|enum)\b/g;

export const SC_ATTR = /__attribute__\(\(packed\)\)/g;

export function buildStructCPreviewNodes(def: StructDef, structs: readonly StructDef[]): DocumentFragment {
    const out = document.createDocumentFragment();
    const nameEscRe = (def.name || 'MyStruct').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nestedTypeNames = def.fields
        .filter(f => f.type === 'struct' && f.refStructId)
        .map(f => allStructs(structs).find(d => d.id === f.refStructId)?.name)
        .filter((n): n is string => typeof n === 'string')
        .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const typeUnion = [
        'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
        'int8_t', 'int16_t', 'int32_t', 'int64_t',
        'float', 'double', 'void', 'char',
        nameEscRe,
        ...nestedTypeNames,
    ].join('|');
    const scTyp = new RegExp(`\\b(${typeUnion})\\b`, 'g');

    const appendText = (parent: DocumentFragment | HTMLElement, text: string) => {
        parent.appendChild(document.createTextNode(text));
    };

    const appendTokenizedCode = (parent: DocumentFragment | HTMLElement, code: string) => {
        // Tokenize into spans/text nodes so user text is never parsed as HTML.
        const tokenRe = new RegExp(`${SC_ATTR.source}|${SC_KW.source}|${scTyp.source}`, 'g');
        let lastIdx = 0;
        let m: RegExpExecArray | null;
        while ((m = tokenRe.exec(code)) !== null) {
            const idx = m.index;
            if (idx > lastIdx) { appendText(parent, code.slice(lastIdx, idx)); }
            const tok = m[0];
            const span = document.createElement('span');
            span.className = structCodeTokenClass(tok);
            span.textContent = tok;
            parent.appendChild(span);
            lastIdx = idx + tok.length;
        }
        if (lastIdx < code.length) { appendText(parent, code.slice(lastIdx)); }
    };

    const lines = structToC(def, structs).split('\n');
    lines.forEach((line, i) => {
        appendStructPreviewLine(out, line, i, lines.length, appendTokenizedCode);
    });

    return out;
}

export function appendStructPreviewLine(
    out: DocumentFragment,
    line: string,
    idx: number,
    lineCount: number,
    appendTokenizedCode: (parent: DocumentFragment | HTMLElement, code: string) => void,
): void {
    const parts = structPreviewLineParts(line);
    if (isPaddingPreviewLine(parts.code)) {
        appendPaddingPreviewLine(out, line, parts.code);
    } else {
        appendTokenizedCode(out, parts.code);
        appendPreviewComment(out, parts.cmt);
    }
    appendPreviewLineBreak(out, idx, lineCount);
}

export function structPreviewLineParts(line: string): { code: string; cmt: string } {
    const ci = line.indexOf('/*');
    if (ci < 0) { return { code: line, cmt: '' }; }
    return { code: line.slice(0, ci), cmt: line.slice(ci) };
}

export function isPaddingPreviewLine(code: string): boolean {
    return /\b_pad\w+/.test(code);
}

export function appendPreviewLineBreak(out: DocumentFragment, idx: number, lineCount: number): void {
    if (idx < lineCount - 1) { appendPreviewText(out, '\n'); }
}

export function appendPaddingPreviewLine(out: DocumentFragment, line: string, code: string): void {
    const n = code.match(/_pad\w+\[(\d+)\]/)?.[1] ?? '?';
    const indent = line.slice(0, line.length - line.trimStart().length);
    appendPreviewText(out, indent);
    appendPreviewComment(out, `/* ${n} byte${n === '1' ? '' : 's'} padding */`);
}

export function appendPreviewComment(out: DocumentFragment, cmt: string): void {
    if (!cmt) { return; }
    const span = document.createElement('span');
    span.className = 'sc-cmt';
    span.textContent = cmt;
    out.appendChild(span);
}

export function appendPreviewText(parent: DocumentFragment | HTMLElement, text: string): void {
    parent.appendChild(document.createTextNode(text));
}

export function structCodeTokenClass(tok: string): string {
    if (tok === '__attribute__((packed))') { return 'sc-attr'; }
    if (tok === 'typedef' || tok === 'struct' || tok === 'enum') { return 'sc-kw'; }
    return 'sc-type';
}

export function renderStructCPreview(pre: HTMLElement, def: StructDef, structs: readonly StructDef[]): void {
    pre.replaceChildren(buildStructCPreviewNodes(def, structs));
}

export function hydrateStructPreviews(root: HTMLElement, structs: readonly StructDef[], editingDraft: StructDef | null): void {
    root.querySelectorAll<HTMLElement>('.si-c-preview[data-struct-preview-id]').forEach(pre => {
        const id = pre.dataset.structPreviewId;
        if (!id) { return; }
        const def = (editingDraft?.id === id)
            ? editingDraft
            : allStructs(structs).find(d => d.id === id);
        if (!def) {
            pre.textContent = '';
            return;
        }
        renderStructCPreview(pre, def, structs);
    });
}

