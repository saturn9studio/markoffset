import { BlockContext, BlockRule, Token, BlockScanner as IBlockScanner } from '../../core/types.js';

interface ListItemInfo {
    ordered: boolean;
    bullet?: string;    // '-', '*', '+'
    startNum?: number;  // for ordered lists
    delimiter?: string; // '.' or ')'
    indent: number;     // column after marker (used for continuation)
    markerWidth: number; // width of "1. " or "- " prefix
}

function getListItemInfo(line: string): ListItemInfo | null {
    let i = 0;
    let column = 0;
    // Allow 0-3 spaces of indent
    while (i < line.length) {
        const char = line.charCodeAt(i);
        if (char === 32 && column < 3) {
            i++;
            column++;
        } else if (char === 9 && nextTabStop(column) <= 3) {
            column = nextTabStop(column);
            i++;
        } else {
            break;
        }
    }

    const ch = line.charCodeAt(i);

    // Bullet list markers: -, *, +
    if (ch === 45 || ch === 42 || ch === 43) {
        const next = line.charCodeAt(i + 1);
        // Must be followed by space or tab (or end of line for empty item)
        if (i + 1 >= line.length) {
            return { ordered: false, bullet: String.fromCharCode(ch), indent: i + 2, markerWidth: i + 2 };
        }
        if (next !== 32 && next !== 9) return null;
        // Count spaces after marker
        const markerEndColumn = column + 1;
        let whitespaceColumns = 0;
        let j = i + 1;
        while (j < line.length && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) {
            const nextColumn = line.charCodeAt(j) === 9 ? nextTabStop(markerEndColumn + whitespaceColumns) : markerEndColumn + whitespaceColumns + 1;
            whitespaceColumns = nextColumn - markerEndColumn;
            j++;
        }
        // If there are five or more spaces after the marker, only one belongs
        // to the marker padding; the rest are item content (often code indent).
        const spaces = whitespaceColumns >= 5 ? 1 : whitespaceColumns;
        const indent = markerEndColumn + spaces;
        return {
            ordered: false,
            bullet: String.fromCharCode(ch),
            indent,
            markerWidth: j,
        };
    }

    // Ordered list markers: 1-9 digits followed by '.' or ')'
    if (ch >= 48 && ch <= 57) {
        let numEnd = i;
        while (numEnd < line.length && line.charCodeAt(numEnd) >= 48 && line.charCodeAt(numEnd) <= 57) {
            numEnd++;
        }
        // Max 9 digits
        if (numEnd - i > 9) return null;
        const delimChar = line.charCodeAt(numEnd);
        if (delimChar !== 46 && delimChar !== 41) return null; // '.' or ')'
        const next = line.charCodeAt(numEnd + 1);
        if (numEnd + 1 >= line.length) {
            // Empty list item
            return {
                ordered: true,
                startNum: parseInt(line.slice(i, numEnd), 10),
                delimiter: String.fromCharCode(delimChar),
                indent: numEnd + 2,
                markerWidth: numEnd + 2,
            };
        }
        if (next !== 32 && next !== 9) return null;

        const markerEndColumn = column + (numEnd - i) + 1;
        let whitespaceColumns = 0;
        let j = numEnd + 1;
        while (j < line.length && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) {
            const nextColumn = line.charCodeAt(j) === 9 ? nextTabStop(markerEndColumn + whitespaceColumns) : markerEndColumn + whitespaceColumns + 1;
            whitespaceColumns = nextColumn - markerEndColumn;
            j++;
        }
        const spaces = whitespaceColumns >= 5 ? 1 : whitespaceColumns;
        const indent = markerEndColumn + spaces;
        return {
            ordered: true,
            startNum: parseInt(line.slice(i, numEnd), 10),
            delimiter: String.fromCharCode(delimChar),
            indent,
            markerWidth: j,
        };
    }

    return null;
}

function isSameListType(info: ListItemInfo, other: ListItemInfo): boolean {
    if (info.ordered !== other.ordered) return false;
    if (info.ordered) {
        return info.delimiter === other.delimiter;
    }
    return info.bullet === other.bullet;
}

/**
 * Map a 0-based offset in innerSrc (the joined content string) to a
 * document-absolute source offset, using the per-line source start positions.
 */
function innerToSource(innerPos: number, contentLines: string[], sourceLineStarts: number[]): number {
    let remaining = innerPos;
    for (let i = 0; i < contentLines.length; i++) {
        const lineLen = contentLines[i].length;
        if (remaining <= lineLen) {
            return sourceLineStarts[i] + remaining;
        }
        remaining -= lineLen + 1; // +1 for the '\n' separator in innerSrc
    }
    // clamp to end
    return sourceLineStarts[sourceLineStarts.length - 1] + contentLines[contentLines.length - 1].length;
}

/**
 * Shift block-level children (produced by parseBlocks on innerSrc) from
 * inner-relative offsets to document-absolute offsets. Inline children
 * (paragraph/heading/fence children) remain content-relative — they are
 * handled differently by the decoration layer and are NOT shifted here.
 * Nested list children are recursed into so their block children are also
 * made document-absolute (the nested list_item start/end themselves are
 * already shifted by this function at the outer level).
 */
function shiftBlockChildren(
    tokens: Token[],
    contentLines: string[],
    sourceLineStarts: number[],
): Token[] {
    return tokens.map(t => ({
        ...t,
        start: innerToSource(t.start, contentLines, sourceLineStarts),
        end:   innerToSource(t.end,   contentLines, sourceLineStarts),
        // Do NOT shift inline children (paragraph/heading/fence children) —
        // those remain content-relative. Only recurse into nested list children
        // so their list_item block children are also made document-absolute.
        children: (t.kind === 'bullet_list' || t.kind === 'ordered_list') && t.children
            ? shiftListItemChildren(t.children, contentLines, sourceLineStarts)
            : t.children,
    }));
}

/**
 * Shift list_item tokens within a nested list. Each list_item's start/end is
 * shifted from inner-relative to document-absolute, and its own block children
 * are also shifted recursively.
 */
function shiftListItemChildren(
    items: Token[],
    contentLines: string[],
    sourceLineStarts: number[],
): Token[] {
    return items.map(item => ({
        ...item,
        start: innerToSource(item.start, contentLines, sourceLineStarts),
        end:   innerToSource(item.end,   contentLines, sourceLineStarts),
        // item.children are block children of the nested list_item — also need shifting.
        // They were produced by parseListItem recursively, which has ALREADY applied
        // the inner→source mapping for their own innerSrc level. But since the nested
        // parseListItem was called on a further-nested innerSrc, its children are
        // relative to that nested innerSrc. The nested parseListItem call will have
        // applied its own innerToSource mapping, so by the time we see item.children
        // here they are relative to THIS level's innerSrc — shift them accordingly.
        children: item.children
            ? shiftBlockChildren(item.children, contentLines, sourceLineStarts)
            : undefined,
    }));
}

function createListRule(): BlockRule {
    return {
        name: 'list',
        priority: 70,
        startChars: '-+*0123456789',
        match(line: string): boolean {
            // Don't match if it looks like a thematic break (handled by hr rule at higher priority)
            return getListItemInfo(line) !== null && !isThematicBreak(line);
        },
        canInterruptParagraph(line: string): boolean {
            const info = getListItemInfo(line);
            return info !== null
                && (!info.ordered || info.startNum === 1)
                && !isBlankLine(stripPrefixColumns(line, info.indent));
        },
        parse(scanner: IBlockScanner, context: BlockContext): Token {
            const start = scanner.currentLineStart();
            const firstLine = scanner.currentLine();
            const firstInfo = getListItemInfo(firstLine)!;

            const items: Token[] = [];
            let hasBlankBetweenItems = false;

            while (!scanner.atEnd()) {
                const line = scanner.currentLine();

                // Skip blank lines between items (these are consumed by parseListItem
                // OR appear at list boundaries)
                if (isBlankLine(line)) {
                    hasBlankBetweenItems = items.length > 0 ? true : hasBlankBetweenItems;
                    scanner.advance();
                    continue;
                }

                const info = getListItemInfo(line);
                if (!info || !isSameListType(info, firstInfo) || isThematicBreak(line)) {
                    break;
                }

                // Parse this list item
                const { token: item, hadTrailingBlanks } = parseListItem(scanner, info, context);
                items.push(item);
                if (hadTrailingBlanks) hasBlankBetweenItems = true;
            }

            const tight = !hasBlankBetweenItems && items.every(item => item.attrs?.loose !== true);

            const end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;

            return {
                kind: firstInfo.ordered ? 'ordered_list' : 'bullet_list',
                start,
                end: Math.max(start, end),
                tight,
                ordered: firstInfo.ordered,
                startNum: firstInfo.startNum,
                children: items,
            };
        },
    };
}

function parseListItem(
    scanner: IBlockScanner,
    info: ListItemInfo,
    context: BlockContext
): { token: Token; hadTrailingBlanks: boolean } {
    const start = scanner.currentLineStart();
    const firstLine = scanner.currentLine();
    const indent = info.indent; // minimum indent column for continuation

    // Extract first line content (after the marker).
    // sourceLineStarts[i] is the document-absolute offset where contentLines[i] begins.
    const firstContent = expandLeadingTabs(stripPrefixColumns(firstLine, indent));
    const contentLines: string[] = [firstContent];
    const sourceLineStarts: number[] = [start + info.markerWidth];
    scanner.advance();

    // Collect continuation lines.
    // Buffer blank lines: only commit them if followed by an indented continuation.
    // Trailing blank lines (followed by new list item or non-continuation) are tracked
    // but not included in content. They indicate a loose list.
    let pendingBlanks = 0;
    const pendingBlankSourceStarts: number[] = [];
    let hadTrailingBlanks = false;
    let hasBlankInContent = false;
    let hasDirectBlankBeforeNestedList = false;
    let allContentBlank = isBlankLine(firstContent);

    while (!scanner.atEnd()) {
        const line = scanner.currentLine();

        if (isBlankLine(line)) {
            // Blank line: record its source position, advance, and buffer it.
            pendingBlankSourceStarts.push(scanner.currentLineStart());
            pendingBlanks++;
            scanner.advance();
            continue;
        }

        // Check indentation for continuation before looking for a new item:
        // indented markers belong to this item and are parsed as nested lists.
        const lineIndent = countLeadingColumns(line);

        if (lineIndent >= indent) {
        if (pendingBlanks > 0 && allContentBlank) {
            break;
        }
            if (pendingBlanks > 0 && lineIndent === indent && getListItemInfo(stripColumns(line, indent)) !== null) {
                hasDirectBlankBeforeNestedList = true;
            }
            // Continuation line: commit pending blanks and add this line
            for (let b = 0; b < pendingBlanks; b++) {
                contentLines.push('');
                // Blank lines contribute '' content; source starts at the blank line's position.
                sourceLineStarts.push(pendingBlankSourceStarts[b]);
            }
            if (pendingBlanks > 0) hasBlankInContent = true;
            pendingBlanks = 0;
            pendingBlankSourceStarts.length = 0;
            // Record source start for this continuation line (content starts after the indent).
            const continuation = expandLeadingTabs(stripColumns(line, indent));
            contentLines.push(continuation);
            sourceLineStarts.push(scanner.currentLineStart() + indent);
            if (!isBlankLine(continuation)) allContentBlank = false;
            scanner.advance();
        } else {
            // Less-indented list markers start the next item/list. If separated
            // by buffered blanks, those blanks make the current list loose.
            const newInfo = getListItemInfo(line);
            if (newInfo) {
                if (pendingBlanks > 0) hadTrailingBlanks = true;
                break;
            }

            // A non-blank, less-indented line can lazily continue a paragraph
            // inside this item, but not after a blank line.
            if (pendingBlanks === 0 && contentLines.length > 0 && !isLazyContinuationBreakingLine(line)) {
                contentLines.push(line);
                sourceLineStarts.push(scanner.currentLineStart());
                if (!isBlankLine(line)) allContentBlank = false;
                scanner.advance();
                continue;
            }

            break;
        }
    }

    // Don't include trailing blanks in content
    // hadTrailingBlanks indicates blank lines followed this item (before next item)

    const end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;
    const innerSrc = contentLines.join('\n');

    // Parse block children from the stripped inner content, then remap their
    // offsets from inner-relative to document-absolute using the line start map.
    const innerChildren = context.parseBlocks(innerSrc);
    const children = shiftBlockChildren(innerChildren, contentLines, sourceLineStarts);

    const token: Token = {
        kind: 'list_item',
        start,
        end: Math.max(start, end),
        children,
    };
    if (isLooseListItem(hasBlankInContent, hasDirectBlankBeforeNestedList, children)) token.attrs = { loose: true };

    return { token, hadTrailingBlanks };
}

function isLooseListItem(hasBlankInContent: boolean, hasDirectBlankBeforeNestedList: boolean, children: Token[]): boolean {
    if (!hasBlankInContent) return false;
    if (children.length === 1 && children[0].kind === 'fence') return false;
    if (
        children.length === 2
        && children[0].kind === 'paragraph'
        && (children[1].kind === 'bullet_list' || children[1].kind === 'ordered_list')
    ) {
        return hasDirectBlankBeforeNestedList;
    }
    return true;
}

function isLazyContinuationBreakingLine(line: string): boolean {
    const trimmed = trimAsciiWhitespace(line);
    if (trimmed === '') return true;
    if (/^(?:-{3,}|={1,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})[ \t]*$/.test(trimmed)) return true;
    if (/^(?:`{3,}|~{3,})/.test(trimmed)) return true;
    return false;
}

function isBlankLine(line: string): boolean {
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char !== 32 && char !== 9) return false;
    }
    return true;
}

function trimAsciiWhitespace(line: string): string {
    let start = 0;
    let end = line.length;
    while (start < end && isAsciiWhitespace(line.charCodeAt(start))) start++;
    while (end > start && isAsciiWhitespace(line.charCodeAt(end - 1))) end--;
    return line.slice(start, end);
}

function isAsciiWhitespace(char: number): boolean {
    return char === 32 || char === 9;
}

function isThematicBreak(line: string): boolean {
    let i = 0;
    while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
    const ch = line.charCodeAt(i);
    if (ch !== 42 && ch !== 45 && ch !== 95) return false;
    let count = 0;
    for (let j = i; j < line.length; j++) {
        const c = line.charCodeAt(j);
        if (c === ch) count++;
        else if (c !== 32 && c !== 9) return false;
    }

    return count >= 3;
}

function countLeadingColumns(line: string): number {
    let column = 0;
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char === 32) column++;
        else if (char === 9) column = nextTabStop(column);
        else break;
    }
    return column;
}

function stripColumns(line: string, columns: number): string {
    let column = 0;
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char !== 32 && char !== 9) return line.slice(index);
        const nextColumn = char === 9 ? nextTabStop(column) : column + 1;
        if (nextColumn > columns) return ' '.repeat(nextColumn - columns) + expandLeadingTabsFrom(line.slice(index + 1), nextColumn);
        if (nextColumn === columns) return line.slice(index + 1);
        column = nextColumn;
    }
    return '';
}

function stripPrefixColumns(line: string, columns: number): string {
    let column = 0;
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        const nextColumn = char === 9 ? nextTabStop(column) : column + 1;
        if (nextColumn > columns) return ' '.repeat(nextColumn - columns) + expandLeadingTabsFrom(line.slice(index + 1), nextColumn);
        if (nextColumn === columns) return line.slice(index + 1);
        column = nextColumn;
    }

    return '';
}

function expandLeadingTabs(line: string): string {
    return expandLeadingTabsFrom(line, 0);
}

function expandLeadingTabsFrom(line: string, startColumn: number): string {
    let column = startColumn;
    let prefix = '';
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char === 32) {
            prefix += ' ';
            column++;
        } else if (char === 9) {
            const nextColumn = nextTabStop(column);
            prefix += ' '.repeat(nextColumn - column);
            column = nextColumn;
        } else {
            return prefix + line.slice(index);
        }
    }
    return prefix;
}

function nextTabStop(column: number): number {
    return column + (4 - (column % 4));
}

export { createListRule };
