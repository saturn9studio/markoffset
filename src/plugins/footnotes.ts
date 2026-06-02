import { InlineContext, ParserExtension, Token } from '../core/types';

const FOOTNOTE_EXTENSION_KEY = 'gfm-footnotes';

interface FootnoteDefinition {
    label: string;
    id: string;
    content: string;
}

interface FootnoteScan {
    definitions: Map<string, FootnoteDefinition>;
    definitionLineStarts: Set<number>;
    context: FootnoteState;
}

interface FootnoteReference {
    label: string;
    id: string;
    number: number;
    refIndex: number;
    refId: string;
}

interface SourceLine {
    start: number;
    text: string;
}

export class FootnoteState {
    private readonly definitions: Map<string, FootnoteDefinition>;
    private readonly order: string[] = [];
    private readonly refCounts = new Map<string, number>();

    constructor(definitions: Map<string, FootnoteDefinition>) {
        this.definitions = definitions;
    }

    register(label: string): FootnoteReference | null {
        const key = normalizeFootnoteLabel(label);
        const definition = this.definitions.get(key);
        if (!definition) return null;

        if (!this.order.includes(key)) this.order.push(key);
        const number = this.order.indexOf(key) + 1;
        const refIndex = (this.refCounts.get(key) ?? 0) + 1;
        this.refCounts.set(key, refIndex);

        return {
            label: definition.label,
            id: definition.id,
            number,
            refIndex,
            refId: refIndex === 1 ? `fnref-${definition.id}` : `fnref-${definition.id}-${refIndex}`,
        };
    }

    usedDefinitions(): Array<{ definition: FootnoteDefinition; number: number; refCount: number }> {
        return this.order
            .map((key, index) => ({
                definition: this.definitions.get(key)!,
                number: index + 1,
                refCount: this.refCounts.get(key) ?? 0,
            }));
    }
}

function collectFootnotes(src: string): FootnoteScan {
    const definitions = new Map<string, FootnoteDefinition>();
    const definitionLineStarts = new Set<number>();
    if (!src.includes('[^')) {
        return { definitions, definitionLineStarts, context: new FootnoteState(definitions) };
    }

    const lines = getLines(src);

    for (let index = 0; index < lines.length; index++) {
        const parsed = parseFootnoteDefinition(lines, index);
        if (!parsed) continue;
        const key = normalizeFootnoteLabel(parsed.label);
        if (!definitions.has(key)) definitions.set(key, {
            label: parsed.label,
            id: encodeFootnoteId(parsed.label),
            content: parsed.content,
        });
        parsed.lineStarts.forEach(start => definitionLineStarts.add(start));
        index = parsed.endLine;
    }

    return { definitions, definitionLineStarts, context: new FootnoteState(definitions) };
}

function createFootnotesToken(
    footnotes: FootnoteState,
    parseBlocks: (src: string) => Token[]
): Token | null {
    const items = footnotes.usedDefinitions().map(({ definition, number, refCount }) => ({
        kind: 'footnote_item',
        start: 0,
        end: definition.content.length,
        content: definition.content,
        attrs: {
            id: definition.id,
            number,
            refCount,
        },
        children: parseBlocks(definition.content),
    } satisfies Token));

    return items.length === 0 ? null : {
        kind: 'footnotes',
        start: 0,
        end: 0,
        children: items,
    };
}

export function createFootnotesExtension(): ParserExtension {
    return {
        name: 'gfm-footnotes',
        prepare(src: string) {
            const scan = collectFootnotes(src);
            return {
                definitionLineStarts: scan.definitionLineStarts,
                inlineContext: new Map([[FOOTNOTE_EXTENSION_KEY, scan.context]]),
                fullDocumentIncrementalReparse: scan.definitions.size > 0,
                finalize(tokens: Token[], parseBlocks: (src: string) => Token[]): Token[] {
                    const footnotesToken = createFootnotesToken(scan.context, parseBlocks);
                    return footnotesToken ? [...tokens, footnotesToken] : tokens;
                },
            };
        },
        prepareNested(src: string) {
            const scan = collectFootnotes(src);
            return {
                definitionLineStarts: scan.definitionLineStarts,
            };
        },
    };
}

export function getFootnoteState(ctx: InlineContext): FootnoteState | undefined {
    const state = ctx.extensions.get(FOOTNOTE_EXTENSION_KEY);
    return state instanceof FootnoteState ? state : undefined;
}

function parseFootnoteDefinition(lines: SourceLine[], startLine: number): { label: string; content: string; lineStarts: number[]; endLine: number } | null {
    const first = lines[startLine];
    const match = first.text.match(/^ {0,3}\[\^([^\]\n]+)\]:[ \t]*(.*)$/u);
    if (!match) return null;

    const label = match[1];
    const contentLines = [match[2]];
    const lineStarts = [first.start];
    let endLine = startLine;
    let pendingBlankStarts: number[] = [];

    while (endLine + 1 < lines.length) {
        const next = lines[endLine + 1];
        if (next.text.trim() === '') {
            pendingBlankStarts.push(next.start);
            endLine++;
            continue;
        }

        if (leadingColumns(next.text) < 4) break;
        pendingBlankStarts.forEach(start => {
            contentLines.push('');
            lineStarts.push(start);
        });
        pendingBlankStarts = [];
        contentLines.push(stripColumns(next.text, 4));
        lineStarts.push(next.start);
        endLine++;
    }

    return { label, content: contentLines.join('\n'), lineStarts, endLine };
}

function normalizeFootnoteLabel(label: string): string {
    return label.trim().replace(/[ \t\r\n]+/g, ' ').toLocaleLowerCase();
}

function encodeFootnoteId(label: string): string {
    return encodeURIComponent(label.trim().replace(/[ \t\r\n]+/g, ' ')).replace(/%2F/giu, '/');
}

function getLines(src: string): SourceLine[] {
    const lines: SourceLine[] = [];
    let start = 0;
    while (start <= src.length) {
        const end = src.indexOf('\n', start);
        const lineEnd = end === -1 ? src.length : end;
        lines.push({ start, text: src.slice(start, lineEnd) });
        if (end === -1) break;
        start = end + 1;
    }
    return lines;
}

function leadingColumns(line: string): number {
    let column = 0;
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char === 32) column++;
        else if (char === 9) column += 4 - (column % 4);
        else break;
    }
    return column;
}

function stripColumns(line: string, columns: number): string {
    let column = 0;
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char !== 32 && char !== 9) return line.slice(index);
        const nextColumn = char === 9 ? column + (4 - (column % 4)) : column + 1;
        if (nextColumn > columns) return ' '.repeat(nextColumn - columns) + line.slice(index + 1);
        if (nextColumn === columns) return line.slice(index + 1);
        column = nextColumn;
    }
    return '';
}
