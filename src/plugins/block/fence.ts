import { BlockRule, Token } from '../../core/types.js';
import { decodeEntities } from '../../core/entities.js';

export const fence: BlockRule = {
    name: 'fence',
    priority: 100,
    startChars: '`~',
    match(line: string): boolean {
        // Allow 0-3 spaces of indent
        let i = 0;
        while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
        const ch = line.charCodeAt(i);
        if (ch !== 96 && ch !== 126) return false; // '`' or '~'
        let count = 0;
        while (i + count < line.length && line.charCodeAt(i + count) === ch) count++;
        if (count < 3) return false;
        return ch !== 96 || line.slice(i + count).indexOf('`') === -1;
    },
    parse(scanner): Token {
        const line = scanner.currentLine();
        const start = scanner.currentLineStart();

        // Skip leading indent
        let indent = 0;
        while (indent < 3 && indent < line.length && line.charCodeAt(indent) === 32) indent++;

        const fenceChar = line.charCodeAt(indent);
        let fenceLen = 0;
        while (indent + fenceLen < line.length && line.charCodeAt(indent + fenceLen) === fenceChar) fenceLen++;

        const rawInfo = line.slice(indent + fenceLen).trim();
        const info = decodeEntities(rawInfo.indexOf('\\') === -1
            ? rawInfo
            : rawInfo.replace(/\\([!-/:-@[-`{-~])/g, '$1'));
        // For backtick fences, info string cannot contain backtick
        // (tilde fences allow backticks in info string)
        scanner.advance();

        let content = '';
        let end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;

        while (!scanner.atEnd()) {
            const l = scanner.currentLine();
            // Check for closing fence: same char, length >= opening, no info string
            // Allow 0-3 spaces of indent before the closing fence
            let closeIndent = 0;
            while (closeIndent < 3 && closeIndent < l.length && l.charCodeAt(closeIndent) === 32) closeIndent++;
            let closeLen = 0;
            while (closeIndent + closeLen < l.length && l.charCodeAt(closeIndent + closeLen) === fenceChar) closeLen++;

            if (closeLen >= fenceLen && isBlankFrom(l, closeIndent + closeLen)) {
                end = scanner.currentLineEnd();
                scanner.advance();
                break;
            }
            content += stripOpeningIndent(l, indent) + '\n';
            end = scanner.currentLineEnd();
            scanner.advance();
        }

        return {
            kind: 'fence',
            start,
            end,
            info,
            content,
            markup: String.fromCharCode(fenceChar).repeat(fenceLen),
        };

        function stripOpeningIndent(line: string, indent: number): string {
            let spaces = 0;
            while (spaces < indent && spaces < line.length && line.charCodeAt(spaces) === 32) spaces++;
            return line.slice(spaces);
        }

        function isBlankFrom(line: string, start: number): boolean {
            for (let index = start; index < line.length; index++) {
                const char = line.charCodeAt(index);
                if (char !== 32 && char !== 9) return false;
            }
            return true;
        }
    },
};
