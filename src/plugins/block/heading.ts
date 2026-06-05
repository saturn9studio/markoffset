import { BlockRule, Token } from '../../core/types.js';

export const heading: BlockRule = {
    name: 'heading',
    priority: 90,
    startChars: '#',
    inlineContent: true,
    match(line: string): boolean {
        // Allow 0-3 spaces of indent
        let i = 0;
        while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
        if (line.charCodeAt(i) !== 35) return false; // '#'
        let level = 0;
        while (i + level < line.length && line.charCodeAt(i + level) === 35) level++;
        if (level > 6) return false;
        // After the #s: space, tab, or end of line
        const afterHash = i + level;
        if (afterHash >= line.length) return true; // empty heading
        const ch = line.charCodeAt(afterHash);
        return ch === 32 || ch === 9;
    },
    parse(scanner): Token {
        const line = scanner.currentLine();
        const start = scanner.currentLineStart();

        // Skip leading spaces (0-3)
        let i = 0;
        while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;

        let level = 0;
        while (i + level < line.length && line.charCodeAt(i + level) === 35) level++;

        // Skip space after #s
        let contentStart = i + level;
        while (contentStart < line.length &&
               (line.charCodeAt(contentStart) === 32 || line.charCodeAt(contentStart) === 9)) {
            contentStart++;
        }

        // Strip trailing closing sequence: optional spaces, optional #s, optional spaces
        let contentEnd = line.length;
        // Trim trailing whitespace first
        while (contentEnd > contentStart && (line.charCodeAt(contentEnd - 1) === 32 || line.charCodeAt(contentEnd - 1) === 9)) {
            contentEnd--;
        }
        // Now check if there's a closing # sequence
        const trimmedEnd = contentEnd;
        let closeStart = trimmedEnd;
        while (closeStart > contentStart && line.charCodeAt(closeStart - 1) === 35) {
            closeStart--;
        }
        if (closeStart < trimmedEnd) {
            // There is a # sequence at the end
            // It's a valid closing sequence only if:
            // - it's preceded by a space or it's the entire content
            if (closeStart === contentStart) {
                // entire content is hashes → empty heading
                contentEnd = contentStart;
            } else if (line.charCodeAt(closeStart - 1) === 32 || line.charCodeAt(closeStart - 1) === 9) {
                // valid closing sequence: strip it and the preceding space
                contentEnd = closeStart - 1;
                while (contentEnd > contentStart &&
                       (line.charCodeAt(contentEnd - 1) === 32 || line.charCodeAt(contentEnd - 1) === 9)) {
                    contentEnd--;
                }
            }
            // else: the # sequence is not a closing sequence (no space before it)
        }

        const content = line.slice(contentStart, contentEnd);
        const end = scanner.currentLineEnd();
        scanner.advance();
        return { kind: 'heading', start, end, level, content };
    },
};
