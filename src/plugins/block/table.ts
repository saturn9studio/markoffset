import { BlockContext, BlockRule, BlockScanner, Token } from '../../core/types.js';

type Alignment = 'left' | 'center' | 'right';

interface SourceLine {
    start: number;
    end: number;
    text: string;
}

interface DelimiterCell {
    align?: Alignment;
}

export function createTableRule(): BlockRule {
    return {
        name: 'gfm-table',
        priority: 80,
        startChars: '|',
        requiredChars: '|',
        match(line: string, scanner: BlockScanner): boolean {
            return parseTableHeader(line, scanner) !== null;
        },
        parse(scanner: BlockScanner, context: BlockContext): Token {
            const firstLine = currentSourceLine(scanner);
            const header = parseTableHeader(firstLine.text, scanner);
            if (header === null) {
                throw new Error('table parser invoked without a table header');
            }

            const headerRow = createTableRow('table_header', 'table_header_cell', firstLine, header.cells, header.delimiters, context.parseInline);
            scanner.advance();
            scanner.advance();

            const bodyRows: Token[] = [];
            let end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : firstLine.end;
            while (!scanner.atEnd()) {
                const line = currentSourceLine(scanner);
                if (!isTableBodyLine(line.text)) break;
                bodyRows.push(createTableRow('table_row', 'table_cell', line, normalizeBodyCells(line.text, header.cells.length), header.delimiters, context.parseInline));
                end = line.end;
                scanner.advance();
            }

            const children: Token[] = [
                {
                    kind: 'table_head',
                    start: firstLine.start,
                    end: firstLine.end,
                    children: [headerRow],
                },
            ];
            if (bodyRows.length > 0) {
                children.push({
                    kind: 'table_body',
                    start: bodyRows[0].start,
                    end: bodyRows[bodyRows.length - 1].end,
                    children: bodyRows,
                });
            }

            return {
                kind: 'table',
                start: firstLine.start,
                end,
                children,
            };
        },
    };
}

function parseTableHeader(line: string, scanner: BlockScanner): { cells: string[]; delimiters: DelimiterCell[] } | null {
    const nextLine = readLine(scanner.src, scanner.lineEnd + 1);
    if (nextLine === null || isBlankLine(nextLine.text)) return null;

    const cells = splitCells(line);
    if (cells.length === 0) return null;
    const delimiterCells = splitCells(nextLine.text);
    const delimiters: DelimiterCell[] = [];
    for (let index = 0; index < delimiterCells.length; index++) {
        const delimiter = parseDelimiterCell(delimiterCells[index]);
        if (delimiter === null) return null;
        delimiters.push(delimiter);
    }
    if (cells.length !== delimiters.length) return null;

    return { cells, delimiters };
}

function parseDelimiterCell(cell: string): DelimiterCell | null {
    const trimmed = cell.trim();
    let index = 0;
    const startsWithColon = trimmed.charCodeAt(index) === 58;
    if (startsWithColon) index++;
    const dashStart = index;
    while (index < trimmed.length && trimmed.charCodeAt(index) === 45) index++;
    if (index === dashStart) return null;
    const endsWithColon = trimmed.charCodeAt(index) === 58;
    if (endsWithColon) index++;
    if (index !== trimmed.length) return null;
    if (startsWithColon && endsWithColon) return { align: 'center' };
    if (startsWithColon) return { align: 'left' };
    if (endsWithColon) return { align: 'right' };
    return {};
}

function createTableRow(
    kind: string,
    cellKind: string,
    line: SourceLine,
    cells: string[],
    delimiters: DelimiterCell[],
    parseInline: (src: string) => Token[]
): Token {
    const children: Token[] = [];
    for (let index = 0; index < cells.length; index++) {
        const content = normalizeCellContent(cells[index]);
        const align = delimiters[index]?.align;
        children.push({
            kind: cellKind,
            start: line.start,
            end: line.end,
            content,
            attrs: align === undefined ? undefined : { align },
            children: parseInline(content),
        });
    }

    return {
        kind,
        start: line.start,
        end: line.end,
        children,
    };
}

function normalizeBodyCells(line: string, width: number): string[] {
    const cells = splitCells(line);
    if (cells.length >= width) return cells.slice(0, width);
    while (cells.length < width) cells.push('');
    return cells;
}

function normalizeCellContent(cell: string): string {
    const trimmed = cell.trim();
    return trimmed.indexOf('\\|') === -1 ? trimmed : trimmed.replace(/\\\|/g, '|');
}

function isTableBodyLine(line: string): boolean {
    const stripped = stripIndent(line);
    if (isBlankLine(stripped)) return false;
    return !startsTableBreakingBlock(stripped);
}

function startsTableBreakingBlock(line: string): boolean {
    const first = line.charCodeAt(0);
    if (first === 62) return true;
    if (first === 35) return startsHeading(line);
    if (first === 96 || first === 126) return startsFence(line, first);
    if (first === 45 || first === 43 || first === 42) return isSpaceTabOrEnd(line, 1);
    return first >= 48 && first <= 57 && startsOrderedListMarker(line);
}

function startsHeading(line: string): boolean {
    let level = 0;
    while (level < line.length && line.charCodeAt(level) === 35) level++;
    return level > 0 && level <= 6 && isSpaceTabOrEnd(line, level);
}

function startsFence(line: string, marker: number): boolean {
    let count = 0;
    while (count < line.length && line.charCodeAt(count) === marker) count++;
    return count >= 3;
}

function startsOrderedListMarker(line: string): boolean {
    let index = 0;
    while (index < line.length && index < 9) {
        const char = line.charCodeAt(index);
        if (char < 48 || char > 57) break;
        index++;
    }
    if (index === 0) return false;
    const marker = line.charCodeAt(index);
    return (marker === 46 || marker === 41) && isSpaceTabOrEnd(line, index + 1);
}

function isSpaceTabOrEnd(line: string, index: number): boolean {
    if (index >= line.length) return true;
    const char = line.charCodeAt(index);
    return char === 32 || char === 9;
}

function splitCells(line: string): string[] {
    const trimmed = stripOptionalOuterPipes(stripIndent(line).trimEnd());
    const cells: string[] = [];
    let cellStart = 0;
    let codeFence = '';

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '`') {
            const runStart = i;
            while (i + 1 < trimmed.length && trimmed[i + 1] === '`') i++;
            const run = trimmed.slice(runStart, i + 1);
            codeFence = codeFence === run ? '' : (codeFence === '' ? run : codeFence);
            continue;
        }
        if (ch === '|' && codeFence === '') {
            cells.push(trimmed.slice(cellStart, i));
            cellStart = i + 1;
        }
    }

    cells.push(trimmed.slice(cellStart));
    return cells;
}

function stripIndent(line: string): string {
    let indent = 0;
    while (indent < 3 && indent < line.length && line.charCodeAt(indent) === 32) indent++;
    return line.slice(indent);
}

function isBlankLine(line: string): boolean {
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char !== 32 && char !== 9) return false;
    }
    return true;
}

function stripOptionalOuterPipes(line: string): string {
    let start = 0;
    let end = line.length;
    if (line[start] === '|') start++;
    if (end > start && line[end - 1] === '|' && !isEscaped(line, end - 1)) end--;
    return line.slice(start, end);
}

function isEscaped(src: string, index: number): boolean {
    let slashCount = 0;
    for (let i = index - 1; i >= 0 && src[i] === '\\'; i--) slashCount++;
    return slashCount % 2 === 1;
}

function currentSourceLine(scanner: BlockScanner): SourceLine {
    return {
        start: scanner.currentLineStart(),
        end: scanner.currentLineEnd(),
        text: scanner.currentLine(),
    };
}

function readLine(src: string, start: number): SourceLine | null {
    if (start >= src.length) return null;
    const end = src.indexOf('\n', start);
    const lineEnd = end === -1 ? src.length : end;
    return {
        start,
        end: lineEnd,
        text: src.slice(start, lineEnd),
    };
}
