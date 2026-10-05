import { describe, expect, it } from 'vitest';
import type { ParsedBlock, Token } from '../../src/core/types.js';
import { commonmarkParser } from '../../src/presets/commonmark.js';

const absoluteStart = (block: ParsedBlock, token: Token): number =>
    block.start + token.start;

const absoluteEnd = (block: ParsedBlock, token: Token): number =>
    block.start + token.end;

describe('list token ranges resolve to normalized source offsets', () => {
    it('flat list: paragraph child starts after the list marker', () => {
        const src = '- hello world\n- second item\n';
        //           0123456789...
        //           0: '-', 1: ' ', 2: 'h'ello world, 13: '\n'
        //           14: '-', 15: ' ', 16: 's'econd item
        const [block] = commonmarkParser.parse(src);
        const list = block.token;
        const item0 = list.children![0];
        const item1 = list.children![1];
        expect(item0.kind).toBe('list_item');
        expect(absoluteStart(block, item0)).toBe(0);

        const para0 = item0.children![0];
        expect(para0.kind).toBe('paragraph');
        expect(absoluteStart(block, para0)).toBe(2);  // "- ".length = 2
        expect(src.slice(
            absoluteStart(block, para0),
            absoluteEnd(block, para0),
        )).toBe('hello world');

        const para1 = item1.children![0];
        expect(absoluteStart(block, para1)).toBe(16); // offset of 's' in "second item"
        expect(src.slice(
            absoluteStart(block, para1),
            absoluteEnd(block, para1),
        )).toBe('second item');
    });

    it('ordered list: paragraph child starts after the marker', () => {
        const src = '1. first\n2. second\n';
        //           0: '1', 1: '.', 2: ' ', 3: 'f'irst
        const [block] = commonmarkParser.parse(src);
        const list = block.token;
        const item0 = list.children![0];
        const para0 = item0.children![0];
        expect(para0.kind).toBe('paragraph');
        expect(absoluteStart(block, para0)).toBe(3); // "1. ".length = 3
        expect(src.slice(
            absoluteStart(block, para0),
            absoluteEnd(block, para0),
        )).toBe('first');
    });

    it('nested list: inner list and its items are document-absolute', () => {
        //   0         1         2
        //   0123456789012345678901234
        const src = '- outer\n    - inner item\n';
        //           0: '-', 2: 'o'uter, 7: '\n'
        //           8-11: '    ' (4 spaces), 12: '-', 13: ' ', 14: 'i'nner item
        //
        // The outer list item has indent=2 ("- "), so it strips 2 chars from each
        // continuation line, giving outerInnerSrc="outer\n  - inner item".
        // The inner list marker in that string starts at offset 6 (after "outer\n").
        // innerToSource(6) maps to sourceLineStarts[1] + 0 = (8+2) + 0 = 10.
        // So innerList.start = 10, pointing at the '-' two spaces into the line.
        const [block] = commonmarkParser.parse(src);
        const outerList = block.token;
        const outerItem = outerList.children![0];

        const innerList = outerItem.children!.find(c => c.kind === 'bullet_list')!;
        expect(innerList).toBeDefined();
        expect(absoluteStart(block, innerList)).toBe(10); // '-' in "  - inner item" after outer strips 2 spaces

        const innerItem = innerList.children![0];
        expect(absoluteStart(block, innerItem)).toBe(10);

        const innerPara = innerItem.children![0];
        expect(innerPara.kind).toBe('paragraph');
        expect(absoluteStart(block, innerPara)).toBe(14); // inner marker "  - " = 4 chars, 10+4=14
        expect(src.slice(
            absoluteStart(block, innerPara),
            absoluteEnd(block, innerPara),
        )).toBe('inner item');
    });

    it('multi-line list item: continuation line paragraph is document-absolute', () => {
        const src = '- line one\n  line two\n';
        //           0: '-', 2: 'l'ine one, 10: '\n'
        //           11: ' '(x2), 13: 'l'ine two
        const [block] = commonmarkParser.parse(src);
        const list = block.token;
        const item = list.children![0];
        const para = item.children![0];
        // paragraph spans both lines — starts at source pos 2
        expect(absoluteStart(block, para)).toBe(2);
        expect(src.slice(
            absoluteStart(block, para),
            absoluteEnd(block, para),
        )).toContain('line one');
    });
});
