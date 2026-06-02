import { BlockRule, Token } from '../../core/types';

export const indentedCode: BlockRule = {
    name: 'indented-code',
    priority: 60,
    match(line: string): boolean {
        return countLeadingColumns(line) >= 4;
    },
    parse(scanner): Token {
        const start = scanner.currentLineStart();
        const lines: string[] = [];

        while (!scanner.atEnd()) {
            const line = scanner.currentLine();

            if (line.trim() === '') {
                lines.push(countLeadingColumns(line) >= 4 ? stripColumns(line, 4) : '');
                scanner.advance();
                continue;
            }

            if (countLeadingColumns(line) < 4) break;

            lines.push(stripColumns(line, 4));
            scanner.advance();
        }

        while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

        const end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;
        return {
            kind: 'code_block',
            start,
            end: Math.max(start, end),
            content: lines.join('\n') + '\n',
        };
    },
};

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
        if (nextColumn > columns) return ' '.repeat(nextColumn - columns) + line.slice(index + 1);
        if (nextColumn === columns) return line.slice(index + 1);
        column = nextColumn;
    }
    return '';
}

function nextTabStop(column: number): number {
    return column + (4 - (column % 4));
}
