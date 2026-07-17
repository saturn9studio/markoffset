import { describe, expect, test } from 'vitest';
import type { Token } from '../../src/core/types.js';
import { gfmParser } from '../../src/presets/gfm.js';

const tableFrom = (markdown: string): Token => {
    const table = gfmParser.parse(markdown).find(token => token.kind === 'table');
    if (!table) throw new Error('Expected a table token');
    return table;
};

const rowsFrom = (table: Token): Token[] =>
    (table.children ?? []).flatMap(section => section.children ?? []);

describe('GFM table source ranges', () => {
    test('tracks exact cell ranges with indentation and outer pipes', () => {
        const markdown = '  | Alpha | Beta |\n  | :--- | ---: |\n  | One | Two |';
        const rows = rowsFrom(tableFrom(markdown));

        expect(rows.map(row => markdown.slice(row.start, row.end))).toEqual([
            '  | Alpha | Beta |',
            '  | One | Two |',
        ]);
        expect(rows.map(row =>
            (row.children ?? []).map(cell => markdown.slice(cell.start, cell.end))
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
        const body = rowsFrom(tableFrom(markdown))[1];

        expect(body.children?.map(cell => markdown.slice(cell.start, cell.end)))
            .toEqual(['left \\| right', '`x|y`']);
        expect(body.children?.map(cell => cell.content))
            .toEqual(['left | right', '`x|y`']);
    });

    test('assigns deterministic zero-width ranges to missing body cells', () => {
        const markdown = 'A | B | C\n--- | --- | ---\none |';
        const body = rowsFrom(tableFrom(markdown))[1];
        const cells = body.children ?? [];
        const anchor = markdown.lastIndexOf('|');

        expect(cells).toHaveLength(3);
        expect(markdown.slice(cells[0].start, cells[0].end)).toBe('one');
        expect(cells.slice(1).map(cell => [cell.start, cell.end])).toEqual([
            [anchor, anchor],
            [anchor, anchor],
        ]);
    });

    test('keeps header-only table cell ranges precise', () => {
        const markdown = '| A | B |\n| --- | --- |';
        const table = tableFrom(markdown);
        const rows = rowsFrom(table);

        expect(rows).toHaveLength(1);
        expect(rows[0].children?.map(cell => markdown.slice(cell.start, cell.end)))
            .toEqual(['A', 'B']);
        expect(table.end).toBe(markdown.length);
    });

    test('parses single-column tables with a pipe-less delimiter', () => {
        const markdown = 'A |\n---\none';
        const rows = rowsFrom(tableFrom(markdown));

        expect(rows).toHaveLength(2);
        expect(rows.map(row =>
            (row.children ?? []).map(cell => cell.content)
        )).toEqual([['A'], ['one']]);
    });

    test('does not interpret adjacent empty list items as a table', () => {
        expect(gfmParser.parse('- \n\t- ').some(token => token.kind === 'table'))
            .toBe(false);
    });
});
