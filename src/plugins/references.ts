import { decodeEntities } from '../core/entities.js';
import { InlineContext, ParserExtension } from '../core/types.js';

const LINK_REFERENCES_EXTENSION_KEY = 'link-references';

export interface LinkReference {
    url: string;
    title?: string;
}

interface ReferenceScan {
    references: Map<string, LinkReference>;
    definitionLineStarts: Set<number>;
}

export function createLinkReferenceExtension(): ParserExtension {
    return {
        name: 'link-references',
        prepare(src: string) {
            const scan = collectLinkReferences(src);
            return {
                definitionLineStarts: scan.definitionLineStarts,
                inlineContext: new Map([[LINK_REFERENCES_EXTENSION_KEY, scan.references]]),
            };
        },
    };
}

export function getLinkReference(ctx: InlineContext, label: string): LinkReference | undefined {
    const references = ctx.extensions.get(LINK_REFERENCES_EXTENSION_KEY);
    return references instanceof Map ? references.get(normalizeReferenceLabel(label)) : undefined;
}

export function normalizeReferenceLabel(label: string): string {
    return decodeEntities(label)
        .trim()
        .replace(/[ \t\r\n]+/g, ' ')
        .toLocaleUpperCase()
        .replace(/\u1E9E/g, 'SS')
        .toLocaleLowerCase();
}

export function parseLinkDestination(src: string, pos: number, end: number): { url: string; newPos: number } | null {
    if (pos >= end) return null;

    const ch = src.charCodeAt(pos);

    if (ch === 60) {
        let i = pos + 1;
        let url = '';
        while (i < end) {
            const c = src.charCodeAt(i);
            if (c === 62) return { url: decodeEntities(url), newPos: i + 1 };
            if (c === 60 || c === 10) return null;
            if (c === 92 && i + 1 < end) {
                url += escapedChar(src, i);
                i += 2;
                continue;
            }
            url += src[i];
            i++;
        }
        return null;
    }

    let i = pos;
    let depth = 0;
    let url = '';
    while (i < end) {
        const c = src.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10) break;
        if (c === 40) depth++;
        else if (c === 41) {
            if (depth === 0) break;
            depth--;
        }
        if (c === 92 && i + 1 < end) {
            url += escapedChar(src, i);
            i += 2;
            continue;
        }
        url += src[i];
        i++;
    }
    if (depth !== 0) return null;
    return { url: decodeEntities(url), newPos: i };
}

export function parseLinkTitle(src: string, pos: number, end: number): { title: string; newPos: number } | null {
    if (pos >= end) return null;

    const openCh = src.charCodeAt(pos);
    const closeCh = openCh === 34 ? 34 : openCh === 39 ? 39 : openCh === 40 ? 41 : 0;
    if (closeCh === 0) return null;

    let i = pos + 1;
    let title = '';
    while (i < end) {
        const c = src.charCodeAt(i);
        if (c === closeCh) return { title: decodeEntities(title), newPos: i + 1 };
        if (openCh === 40 && c === 40) return null;
        if (c === 92 && i + 1 < end) {
            title += escapedChar(src, i);
            i += 2;
            continue;
        }
        title += src[i];
        i++;
    }
    return null;
}

function collectLinkReferences(src: string): ReferenceScan {
    const references = new Map<string, LinkReference>();
    const definitionLineStarts = new Set<number>();
    if (!src.includes(']:')) {
        return { references, definitionLineStarts };
    }

    const lines = getLines(src);
    let previousWasDefinition = false;

    for (let index = 0; index < lines.length; index++) {
        if (isFenceStart(lines[index].text)) {
            index = skipFence(lines, index);
            previousWasDefinition = false;
            continue;
        }

        const parsed = parseReferenceDefinition(
            lines,
            index,
            index === 0 || previousWasDefinition ? undefined : lines[index - 1]
        );
        if (!parsed) {
            previousWasDefinition = false;
            continue;
        }
        if (!references.has(parsed.label)) references.set(parsed.label, parsed.reference);
        parsed.lineStarts.forEach(start => definitionLineStarts.add(start));
        previousWasDefinition = true;
        index = parsed.endLine;
    }

    return { references, definitionLineStarts };
}

function parseReferenceDefinition(
    lines: SourceLine[],
    startLine: number,
    previousLine: SourceLine | undefined
): { label: string; reference: LinkReference; lineStarts: number[]; endLine: number } | null {
    const first = lines[startLine];
    const blockquote = parseBlockquoteReferenceLine(first.text);
    const firstText = blockquote ?? first.text;
    const indent = countLeadingSpaces(firstText);
    if (indent > 3) return null;
    if (blockquote === null && !canStartReferenceDefinition(previousLine)) return null;

    let line = firstText.slice(indent);
    const consumedStarts = blockquote === null ? [first.start] : [];
    let endLine = startLine;

    if (!line.startsWith('[')) return null;

    while (!hasReferenceLabelEnd(line) && endLine + 1 < lines.length) {
        endLine++;
        const nextText = blockquote === null ? lines[endLine].text : parseBlockquoteReferenceLine(lines[endLine].text);
        if (nextText === null) return null;
        line += `\n${nextText}`;
        if (blockquote === null) consumedStarts.push(lines[endLine].start);
    }

    const labelEnd = findClosingBracket(line, 0);
    if (labelEnd <= 1 || labelEnd > 999 || line.charCodeAt(labelEnd + 1) !== 58) return null;

    const label = normalizeReferenceLabel(line.slice(1, labelEnd));
    if (label === '') return null;

    let source = line.slice(labelEnd + 2);

    while (source.trim() === '' && endLine + 1 < lines.length && lines[endLine + 1].text.trim() !== '') {
        endLine++;
        consumedStarts.push(lines[endLine].start);
        source += `\n${lines[endLine].text}`;
    }

    let pos = skipSpaces(source, 0);
    const destination = parseLinkDestination(source, pos, source.length);
    if (!destination) return null;
    pos = destination.newPos;

    let title: string | undefined;
    const afterDestination = skipSpaces(source, pos);
    const hasTitleWhitespace = afterDestination > pos;
    const titleResult = hasTitleWhitespace ? parseLinkTitle(source, afterDestination, source.length) : null;
    if (titleResult && /^[ \t]*$/u.test(source.slice(titleResult.newPos))) {
        title = titleResult.title;
        pos = titleResult.newPos;
    }

    while (title === undefined && endLine + 1 < lines.length && lines[endLine + 1].text.trim() !== '') {
        const nextLine = lines[endLine + 1];
        const combined = `${source}\n${nextLine.text}`;
        const titleStart = skipSpaces(combined, pos);
        const nextTitle = titleStart > pos ? parseLinkTitle(combined, titleStart, combined.length) : null;
        if (!nextTitle) {
            if (titleStart <= pos || !isTitleOpener(combined.charCodeAt(titleStart))) break;
            source = combined;
            endLine++;
            consumedStarts.push(nextLine.start);
            continue;
        }
        if (!/^[ \t]*$/u.test(combined.slice(nextTitle.newPos))) break;
        title = nextTitle.title;
        source = combined;
        pos = nextTitle.newPos;
        endLine++;
        consumedStarts.push(nextLine.start);
    }

    if (!/^[ \t]*$/u.test(source.slice(pos))) return null;

    return {
        label,
        reference: title === undefined ? { url: destination.url } : { url: destination.url, title },
        lineStarts: consumedStarts,
        endLine,
    };
}

interface SourceLine {
    start: number;
    text: string;
}

function getLines(src: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    while (start < src.length) {
        const end = src.indexOf('\n', start);
        const lineEnd = end === -1 ? src.length : end;
        lines.push({ start, text: src.slice(start, lineEnd) });
        if (end === -1) break;
        start = end + 1;
    }
    return lines;
}

function findClosingBracket(src: string, start: number): number {
    for (let i = start + 1; i < src.length; i++) {
        const c = src.charCodeAt(i);
        if (c === 92 && i + 1 < src.length) {
            i++;
            continue;
        }

        if (c === 91) return -1;
        if (c === 93) return i;
    }
    return -1;
}

function hasReferenceLabelEnd(src: string): boolean {
    const end = findClosingBracket(src, 0);
    return end > 0 && src.charCodeAt(end + 1) === 58;
}

function skipSpaces(src: string, pos: number): number {
    let i = pos;
    while (i < src.length && (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9 || src.charCodeAt(i) === 10)) i++;
    return i;
}

function countLeadingSpaces(line: string): number {
    let spaces = 0;
    while (spaces < line.length && line.charCodeAt(spaces) === 32) spaces++;
    return spaces;
}

function escapedChar(src: string, index: number): string {
    const next = src[index + 1];
    return next !== undefined && /[!-/:-@[-`{-~]/u.test(next) ? next : `\\${next ?? ''}`;
}

function isTitleOpener(char: number): boolean {
    return char === 34 || char === 39 || char === 40;
}

function parseBlockquoteReferenceLine(line: string): string | null {
    let i = 0;
    while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
    if (line.charCodeAt(i) !== 62) return null;
    let content = line.slice(i + 1);
    if (content.charCodeAt(0) === 32) content = content.slice(1);
    return content;
}

function canStartReferenceDefinition(previousLine: SourceLine | undefined): boolean {
    if (!previousLine) return true;
    const trimmed = previousLine.text.trim();
    if (trimmed === '') return true;
    if (/^#{1,6}(?:[ \t]|$)/u.test(trimmed)) return true;
    return hasReferenceLabelEnd(trimmed);
}

function isFenceStart(line: string): boolean {
    const stripped = line.slice(Math.min(countLeadingSpaces(line), 3));
    return /^(`{3,}|~{3,})/u.test(stripped);
}

function skipFence(lines: SourceLine[], startLine: number): number {
    const stripped = lines[startLine].text.slice(Math.min(countLeadingSpaces(lines[startLine].text), 3));
    const marker = stripped[0];
    const length = stripped.match(/^(`{3,}|~{3,})/u)?.[0].length ?? 3;
    for (let index = startLine + 1; index < lines.length; index++) {
        const line = lines[index].text.slice(Math.min(countLeadingSpaces(lines[index].text), 3));
        const match = line.match(/^(`+|~+)/u);
        if (match && match[0][0] === marker && match[0].length >= length && line.slice(match[0].length).trim() === '') {
            return index;
        }
    }
    return lines.length - 1;
}
