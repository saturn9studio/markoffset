import { describe, expect, test } from 'vitest';
import type { ParsedBlock, Token } from '../../src/core/types.js';
import { gfmParser } from '../../src/presets/gfm.js';

interface TableResult {
    block: ParsedBlock;
    table: Token;
}

const tableFrom = (markdown: string): TableResult => {
    const block = gfmParser.parse(markdown)
        .find(candidate => candidate.token.kind === 'table');
    if (!block) throw new Error('Expected a table token');
    return { block, table: block.token };
};

const rowsFrom = (table: Token): Token[] =>
    (table.children ?? []).flatMap(section => section.children ?? []);

const sourceFor = (
    markdown: string,
    block: ParsedBlock,
    token: Token,
): string => markdown.slice(
    block.start + token.start,
    block.start + token.end,
);

describe('GFM table source ranges', () => {
    test('tracks exact cell ranges with indentation and outer pipes', () => {
        const markdown = '  | Alpha | Beta |\n  | :--- | ---: |\n  | One | Two |';
        const { block, table } = tableFrom(markdown);
        const rows = rowsFrom(table);

        expect(rows.map(row => sourceFor(markdown, block, row))).toEqual([
            '  | Alpha | Beta |',
            '  | One | Two |',
        ]);
        expect(rows.map(row =>
            (row.children ?? []).map(cell => sourceFor(markdown, block, cell))
        )).toEqual([
            ['Alpha', 'Beta'],
            ['One', 'Two'],
        ]);
        expect(rows[0].children?.map(cell => cell.attrs?.align)).toEqual([
            'left',
            'right',
        ]);
    });

    test('does not split escaped pipes or pipes inside code spans', () => {
        const markdown = '| A | B |\n| --- | --- |\n| left \\| right | `x|y` |';
        const { block, table } = tableFrom(markdown);
        const body = rowsFrom(table)[1];

        expect(body.children?.map(cell => sourceFor(markdown, block, cell)))
            .toEqual(['left \\| right', '`x|y`']);
        expect(body.children?.map(cell => cell.content))
            .toEqual(['left | right', '`x|y`']);
    });

    test('assigns deterministic zero-width ranges to missing body cells', () => {
        const markdown = 'A | B | C\n--- | --- | ---\none |';
        const { block, table } = tableFrom(markdown);
        const body = rowsFrom(table)[1];
        const cells = body.children ?? [];
        const anchor = markdown.lastIndexOf('|');

        expect(cells).toHaveLength(3);
        expect(sourceFor(markdown, block, cells[0])).toBe('one');
        expect(cells.slice(1).map(cell => [
            block.start + cell.start,
            block.start + cell.end,
        ])).toEqual([
            [anchor, anchor],
            [anchor, anchor],
        ]);
    });

    test('keeps header-only table cell ranges precise', () => {
        const markdown = '| A | B |\n| --- | --- |';
        const { block, table } = tableFrom(markdown);
        const rows = rowsFrom(table);

        expect(rows).toHaveLength(1);
        expect(rows[0].children?.map(cell => sourceFor(markdown, block, cell)))
            .toEqual(['A', 'B']);
        expect(block.end).toBe(markdown.length);
    });

    test('parses single-column tables with a pipe-less delimiter', () => {
        const markdown = 'A |\n---\none';
        const rows = rowsFrom(tableFrom(markdown).table);

        expect(rows).toHaveLength(2);
        expect(rows.map(row =>
            (row.children ?? []).map(cell => cell.content)
        )).toEqual([['A'], ['one']]);
    });

    test('does not interpret adjacent empty list items as a table', () => {
        expect(gfmParser.parse('- \n\t- ')
            .some(block => block.token.kind === 'table'))
            .toBe(false);
    });
});
