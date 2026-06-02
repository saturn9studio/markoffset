import { BlockContext, BlockRule, Token, BlockScanner as IBlockScanner } from '../../core/types';

/**
 * Create a blockquote rule that recursively parses its content using the given block parser.
 */
export function createBlockquoteRule(): BlockRule {
    return {
        name: 'blockquote',
        priority: 85,
        startChars: '>',
        match(line: string): boolean {
            let i = 0;
            while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
            return line.charCodeAt(i) === 62;
        },
        parse(scanner: IBlockScanner, context: BlockContext): Token {
            const start = scanner.currentLineStart();
            const lines: string[] = [];
            let canLazyContinueParagraph = false;
            let hasLazyContinuation = false;

            while (!scanner.atEnd()) {
                const line = scanner.currentLine();

                // Skip leading indent
                let i = 0;
                while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;

                if (line.charCodeAt(i) === 62) {
                    // blockquote line: strip > prefix
                    let content = line.slice(i + 1);
                    // Optionally strip one space after >
                    if (content.charCodeAt(0) === 32) content = content.slice(1);
                    else if (content.charCodeAt(0) === 9) content = expandLeadingTabsAfterMarker(content);
                    lines.push(content);
                    canLazyContinueParagraph = canStartLazyParagraph(content);
                    hasLazyContinuation = false;
                    scanner.advance();
                } else if (line.trim() === '') {
                    // Check if the next non-blank line is a blockquote continuation
                    // Per spec, a blank line interrupts a blockquote
                    break;
                } else if (canLazyContinueParagraph && (hasLazyContinuation || !isLazyBreakingLine(line))) {
                    lines.push(hasLazyContinuation && isSetextUnderline(line) ? `\\${line}` : line);
                    hasLazyContinuation = true;
                    scanner.advance();
                } else {
                    break;
                }
            }

            const end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;
            const innerSrc = lines.join('\n');
            const children = context.parseBlocks(innerSrc);

            return {
                kind: 'blockquote',
                start,
                end: Math.max(start, end),
                children,
            };
        },
    };
}

function canStartLazyParagraph(content: string): boolean {
    const trimmedStart = content.trimStart();
    if (trimmedStart === '') return false;
    if (/^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|[*_ -](?:[ \t]*[*_ -]){2,}[ \t]*$)/.test(trimmedStart)) return false;
    if (/^ {4}/.test(content)) return false;
    return true;
}

function isLazyBreakingLine(line: string): boolean {
    let i = 0;
    while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
    const rest = line.slice(i);
    if (/^(?:-{3,}|={1,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(rest)) return true;
    if (/^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/.test(rest)) return true;
    if (/^(?:`{3,}|~{3,})/.test(rest)) return true;
    return false;
}

function isSetextUnderline(line: string): boolean {
    return /^[ \t]*(?:=+|-+)[ \t]*$/.test(line);
}

function expandLeadingTabsAfterMarker(content: string): string {
    let column = 1;
    let prefixColumns = 0;
    for (let index = 0; index < content.length; index++) {
        const char = content.charCodeAt(index);
        if (char === 32) {
            column++;
            prefixColumns++;
        } else if (char === 9) {
            const nextColumn = column + (4 - (column % 4));
            prefixColumns += nextColumn - column;
            column = nextColumn;
        } else {
            return ' '.repeat(Math.max(0, prefixColumns - 1)) + content.slice(index);
        }
    }
    return ' '.repeat(Math.max(0, prefixColumns - 1));
}
