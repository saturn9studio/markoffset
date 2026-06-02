import { BlockRule, Token } from '../../core/types';

export const hr: BlockRule = {
    name: 'hr',
    priority: 95,
    startChars: '*-_',
    match(line: string): boolean {
        // Allow 0-3 spaces of indent
        let i = 0;
        while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;

        const ch = line.charCodeAt(i);
        // Must be *, -, or _
        if (ch !== 42 && ch !== 45 && ch !== 95) return false;

        let count = 0;
        for (let j = i; j < line.length; j++) {
            const c = line.charCodeAt(j);
            if (c === ch) {
                count++;
            } else if (c !== 32 && c !== 9) {
                return false; // non-space, non-marker char
            }
        }
        return count >= 3;
    },
    parse(scanner): Token {
        const start = scanner.currentLineStart();
        const end = scanner.currentLineEnd();
        scanner.advance();
        return { kind: 'hr', start, end };
    },
};
