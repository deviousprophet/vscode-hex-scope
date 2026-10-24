/** Overlay panel — C preview token/line builders and render/hydrate entry points.
Extracted verbatim from overlayPanel.ts (pure move). */
import { allTypes, typeDefToC } from '../../../../core/overlay/overlayCodec.js';
import type { TypeDef } from '../../../../core/types';

// ── C syntax-highlighted type preview ─────────────────────────────────────

const SC_KW   = /\b(typedef|struct|enum)\b/g;

const SC_ATTR = /__attribute__\(\(packed\)\)/g;

function buildTypeCPreviewNodes(def: TypeDef, types: readonly TypeDef[], params?: Readonly<Record<string, number>>): DocumentFragment {
    const out = document.createDocumentFragment();
    const nameEscRe = (def.name || 'MyType').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nestedTypeNames = def.fields
        .filter(f => f.type === 'struct' && f.refTypeId)
        .map(f => allTypes(types).find(d => d.id === f.refTypeId)?.name)
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
            span.className = typeCodeTokenClass(tok);
            span.textContent = tok;
            parent.appendChild(span);
            lastIdx = idx + tok.length;
        }
        if (lastIdx < code.length) { appendText(parent, code.slice(lastIdx)); }
    };

    const lines = typeDefToC(def, types, params).split('\n');
    lines.forEach((line, i) => {
        appendTypePreviewLine(out, line, i, lines.length, appendTokenizedCode);
    });

    return out;
}

function appendTypePreviewLine(
    out: DocumentFragment,
    line: string,
    idx: number,
    lineCount: number,
    appendTokenizedCode: (parent: DocumentFragment | HTMLElement, code: string) => void,
): void {
    const parts = previewLineParts(line);
    if (isPaddingPreviewLine(parts.code)) {
        appendPaddingPreviewLine(out, line, parts.code);
    } else {
        appendTokenizedCode(out, parts.code);
        appendPreviewComment(out, parts.cmt);
    }
    appendPreviewLineBreak(out, idx, lineCount);
}

function previewLineParts(line: string): { code: string; cmt: string } {
    const ci = line.indexOf('/*');
    if (ci < 0) { return { code: line, cmt: '' }; }
    return { code: line.slice(0, ci), cmt: line.slice(ci) };
}

function isPaddingPreviewLine(code: string): boolean {
    return /\b_pad\w+/.test(code);
}

function appendPreviewLineBreak(out: DocumentFragment, idx: number, lineCount: number): void {
    if (idx < lineCount - 1) { appendPreviewText(out, '\n'); }
}

function appendPaddingPreviewLine(out: DocumentFragment, line: string, code: string): void {
    const n = code.match(/_pad\w+\[(\d+)\]/)?.[1] ?? '?';
    const indent = line.slice(0, line.length - line.trimStart().length);
    appendPreviewText(out, indent);
    appendPreviewComment(out, `/* ${n} byte${n === '1' ? '' : 's'} padding */`);
}

function appendPreviewComment(out: DocumentFragment, cmt: string): void {
    if (!cmt) { return; }
    const span = document.createElement('span');
    span.className = 'sc-cmt';
    span.textContent = cmt;
    out.appendChild(span);
}

function appendPreviewText(parent: DocumentFragment | HTMLElement, text: string): void {
    parent.appendChild(document.createTextNode(text));
}

const SC_KEYWORD_TOKENS = new Set(['typedef', 'struct', 'enum']);

function typeCodeTokenClass(tok: string): string {
    if (tok === '__attribute__((packed))') { return 'sc-attr'; }
    return SC_KEYWORD_TOKENS.has(tok) ? 'sc-kw' : 'sc-type';
}

export function renderTypeCPreview(
    pre: HTMLElement,
    def: TypeDef,
    types: readonly TypeDef[],
    params?: Readonly<Record<string, number>>,
): void {
    pre.replaceChildren(buildTypeCPreviewNodes(def, types, params));
}

export function hydrateTypePreviews(root: HTMLElement, types: readonly TypeDef[], editingDraft: TypeDef | null): void {
    root.querySelectorAll<HTMLElement>('.oi-c-preview[data-preview-id]')
        .forEach(pre => hydrateTypePreview(pre, types, editingDraft));
}

/** Hydrate one preview element from its def id. */
function hydrateTypePreview(pre: HTMLElement, types: readonly TypeDef[], editingDraft: TypeDef | null): void {
    const def = previewDefForId(pre.dataset.previewId, types, editingDraft);
    if (!def) {
        pre.textContent = '';
        return;
    }
    renderTypeCPreview(pre, def, types, previewParams(pre));
}

/** Per-instance resolved parameters carried by the card's preview element. */
function previewParams(pre: HTMLElement): Readonly<Record<string, number>> | undefined {
    const raw = pre.dataset.previewParams;
    if (!raw) { return undefined; }
    const parsed = parsePreviewJson(raw);
    if (parsed === undefined) { return undefined; }
    const values = pickPreviewNumbers(parsed);
    return Object.keys(values).length > 0 ? values : undefined;
}

function parsePreviewJson(raw: string): Record<string, unknown> | undefined {
    try {
        const parsed = JSON.parse(raw) as unknown;
        return isPlainRecord(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickPreviewNumbers(parsed: Record<string, unknown>): Record<string, number> {
    const values: Record<string, number> = {};
    for (const [name, value] of Object.entries(parsed)) {
        if (isValidPreviewNumber(value)) { values[name] = value; }
    }
    return values;
}

function isValidPreviewNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** Resolve the def a preview id points at, preferring the in-flight editor draft. */
function previewDefForId(id: string | undefined, types: readonly TypeDef[], editingDraft: TypeDef | null): TypeDef | null {
    if (!id) { return null; }
    return isDraftPreviewId(id, editingDraft) ? editingDraft : typeDefById(types, id);
}

function isDraftPreviewId(id: string, editingDraft: TypeDef | null): boolean {
    return editingDraft?.id === id;
}

function typeDefById(types: readonly TypeDef[], id: string): TypeDef | null {
    return allTypes(types).find(d => d.id === id) ?? null;
}

