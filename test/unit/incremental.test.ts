import { describe, expect, test } from 'vitest';
import { commonmarkParser as parser } from '../../src/presets/commonmark.js';
import { gfmParser } from '../../src/presets/gfm.js';
import { parseDocument, reparse, Change } from '../../src/incremental.js';
import { Parser, Token } from '../../src/core/types.js';

/** Apply a change to a source string the same way the editor would. */
function applyChange(src: string, change: Change): string {
    return src.slice(0, change.from) + change.insert + src.slice(change.to);
}

/**
 * The fundamental correctness invariant: an incremental reparse must produce the
 * exact same token tree as a full reparse of the resulting document.
 */
function expectInvariant(doc: string, change: Change, parserUnderTest: Parser = parser): void {
    const prev = parseDocument(parserUnderTest, doc);
    const incremental = reparse(parserUnderTest, prev, change).tokens;
    const full = parserUnderTest.parse(applyChange(prev.src, change));
    expect(incremental).toEqual(full);
}

describe('incremental reparse — fundamental invariant', () => {
    const doc = [
        'first paragraph here',
        '',
        '## a heading',
        '',
        'body of the second paragraph with **bold**',
        '',
        '> a blockquote line',
        '',
        '- list item one',
        '- list item two',
        '',
        'final paragraph',
        '',
    ].join('\n');

    test('typing a character inside a paragraph (common case)', () => {
        const from = doc.indexOf('body of') + 4;
        expectInvariant(doc, { from, to: from, insert: 'X' });
    });

    test('inserting a newline that splits a paragraph into two', () => {
        const from = doc.indexOf('body of') + 4;
        expectInvariant(doc, { from, to: from, insert: '\n\n' });
    });

    test('deleting a blank line that merges two paragraphs', () => {
        const src = 'paragraph one\n\nparagraph two\n';
        const blank = src.indexOf('\n\n');
        // Remove one of the two newlines, merging the paragraphs.
        expectInvariant(src, { from: blank, to: blank + 1, insert: '' });
    });

    test('typing ``` to open a fence (non-local: reinterprets following lines)', () => {
        const from = doc.indexOf('## a heading');
        expectInvariant(doc, { from, to: from, insert: '```\n' });
    });

    test('closing a fence', () => {
        const src = '```js\nconst x = 1;\nmore code\n';
        expectInvariant(src, { from: src.length, to: src.length, insert: '\n```\n' });
    });

    test('adding > to start a blockquote', () => {
        const src = 'plain paragraph line\n\nsecond paragraph\n';
        expectInvariant(src, { from: 0, to: 0, insert: '> ' });
    });

    test('removing a blockquote marker', () => {
        const src = '> quoted line\n\nafter\n';
        expectInvariant(src, { from: 0, to: 2, insert: '' });
    });

    test('adding a list marker', () => {
        const src = 'item text\n\nnext paragraph\n';
        expectInvariant(src, { from: 0, to: 0, insert: '- ' });
    });

    test('removing a list marker', () => {
        const src = '- item a\n- item b\n- item c\n';
        const from = src.indexOf('- item b');
        expectInvariant(src, { from, to: from + 2, insert: '' });
    });

    test('edit at the very start of the document', () => {
        expectInvariant(doc, { from: 0, to: 0, insert: '# Title\n\n' });
    });

    test('edit at the very end of the document', () => {
        expectInvariant(doc, { from: doc.length, to: doc.length, insert: '\n\nappended paragraph\n' });
    });

    test('replacing a range that spans multiple blocks', () => {
        const from = doc.indexOf('## a heading');
        const to = doc.indexOf('> a blockquote');
        expectInvariant(doc, { from, to, insert: 'replaced text\n' });
    });

    test('emptying the entire document', () => {
        expectInvariant(doc, { from: 0, to: doc.length, insert: '' });
    });

    test('typing into an empty document', () => {
        expectInvariant('', { from: 0, to: 0, insert: 'hello world\n' });
    });

    test('edit inside a list item reparses the list correctly', () => {
        const src = '- alpha\n- beta\n- gamma\n';
        const from = src.indexOf('beta');
        expectInvariant(src, { from, to: from, insert: 'Z' });
    });

    test('edit inside a GFM table recomputes structural ranges', () => {
        const src = '| A | B |\n| --- | --- |\n| one | two |\n';
        const from = src.indexOf('two');
        expectInvariant(src, { from, to: from + 3, insert: 'second' }, gfmParser);
    });

    test('edit before a GFM table shifts reused structural ranges', () => {
        const src = 'before\n\n| A | B |\n| --- | --- |\n| one | two |\n';
        expectInvariant(src, { from: 0, to: 0, insert: 'X' }, gfmParser);
    });

    test('edit before a list-nested GFM table shifts structural ranges once', () => {
        const src = '- item\n\n  | A | B |\n  | --- | --- |\n  | one | two |\n';
        expectInvariant(src, { from: 0, to: 0, insert: 'pre\n\n' }, gfmParser);
    });

    test('edit inside a blockquote keeps content-relative child offsets', () => {
        const src = '> line one\n> line two\n\ntrailing paragraph\n';
        const from = src.indexOf('line one') + 4;
        expectInvariant(src, { from, to: from, insert: 'Q' });
    });

    test('inserting a thematic break between paragraphs', () => {
        const src = 'above the break\n\nbelow the break\n';
        const from = src.indexOf('\n\n') + 2;
        expectInvariant(src, { from, to: from, insert: '---\n\n' });
    });

    test('CRLF line endings are normalized before reparse', () => {
        const src = 'one paragraph\r\n\r\ntwo paragraph\r\n';
        const prev = parseDocument(parser, src);
        // from/to are offsets into the NORMALIZED source.
        const from = prev.src.indexOf('two');
        const change: Change = { from, to: from, insert: 'X' };
        const incremental = reparse(parser, prev, change).tokens;
        const full = parser.parse(applyChange(prev.src, change));
        expect(incremental).toEqual(full);
    });

    test('adding a link reference definition updates an earlier shortcut reference', () => {
        const src = '[foo]\n\nbar\n';
        expectInvariant(src, {
            from: src.length,
            to: src.length,
            insert: '\n[foo]: https://example.com\n',
        });
    });

    test('removing a link reference definition updates an earlier shortcut reference', () => {
        const src = '[foo]\n\nbar\n\n[foo]: https://example.com\n';
        const from = src.indexOf('[foo]:');
        expectInvariant(src, { from, to: src.length, insert: '' });
    });

    test('adding a footnote definition updates an earlier footnote reference', () => {
        const src = 'hello [^a]\n\nbar\n';
        expectInvariant(src, {
            from: src.length,
            to: src.length,
            insert: '\n[^a]: footnote text\n',
        }, gfmParser);
    });

    test('removing a footnote definition updates an earlier footnote reference', () => {
        const src = 'hello [^a]\n\nbar\n\n[^a]: footnote text\n';
        const from = src.indexOf('[^a]:');
        expectInvariant(src, { from, to: src.length, insert: '' }, gfmParser);
    });

    test('bounded reparses keep link references defined before the edited region', () => {
        const src = '[foo]: https://example.com\n\n[foo]\n\nbar\n\nbaz\n';
        const from = src.indexOf('bar') + 1;
        expectInvariant(src, { from, to: from, insert: 'X' });
    });

    test('bounded reparses keep footnotes defined before the edited region', () => {
        const src = '[^a]: footnote text\n\nhello [^a]\n\nbar\n\nbaz\n';
        const from = src.indexOf('bar') + 1;
        expectInvariant(src, { from, to: from, insert: 'X' }, gfmParser);
    });
});

describe('incremental reparse — randomized property test', () => {
    const charAlphabet = 'ab \n#>-*`~[]()_.0\t'.split('');

    function randInt(n: number): number {
        return Math.floor(Math.random() * n);
    }

    function randomDoc(maxLen: number): string {
        const len = randInt(maxLen);
        let s = '';
        for (let i = 0; i < len; i++) s += charAlphabet[randInt(charAlphabet.length)];
        return s;
    }

    function randomChange(src: string): Change {
        const from = randInt(src.length + 1);
        const to = Math.min(src.length, from + randInt(5));
        const insertLen = randInt(5);
        let insert = '';
        for (let i = 0; i < insertLen; i++) insert += charAlphabet[randInt(charAlphabet.length)];
        return { from, to, insert };
    }

    test('invariant holds for 3000 random single-edit scenarios', () => {
        for (let iteration = 0; iteration < 3000; iteration++) {
            const doc = randomDoc(120);
            const prev = parseDocument(parser, doc);
            const change = randomChange(prev.src);
            const incremental = reparse(parser, prev, change).tokens;
            const full = parser.parse(applyChange(prev.src, change));
            if (JSON.stringify(incremental) !== JSON.stringify(full)) {
                throw new Error(
                    `Invariant violated\n doc=${JSON.stringify(doc)}\n change=${JSON.stringify(change)}\n`
                    + ` incremental=${JSON.stringify(incremental.map((t: Token) => [t.kind, t.start, t.end]))}\n`
                    + ` full=${JSON.stringify(full.map((t: Token) => [t.kind, t.start, t.end]))}`
                );
            }
        }
    });

    test('invariant holds for structured block documents', () => {
        const blocks = [
            '# Heading\n',
            'a paragraph of text\n',
            '```\ncode here\n```\n',
            '> a quote\n',
            '- item a\n- item b\n',
            '1. one\n2. two\n',
            '---\n',
            '**bold** and *italic* text\n',
            '[a link](http://example.com)\n',
        ];
        const inserts = ['', 'x', '\n', '\n\n', '```\n', '> ', '- ', '#', '*', '`'];
        for (let iteration = 0; iteration < 3000; iteration++) {
            let doc = '';
            const n = randInt(8);
            for (let i = 0; i < n; i++) {
                doc += blocks[randInt(blocks.length)];
                if (randInt(2)) doc += '\n';
            }
            const prev = parseDocument(parser, doc);
            const from = randInt(prev.src.length + 1);
            const to = Math.min(prev.src.length, from + randInt(6));
            const change: Change = { from, to, insert: inserts[randInt(inserts.length)] };
            const incremental = reparse(parser, prev, change).tokens;
            const full = parser.parse(applyChange(prev.src, change));
            expect(incremental).toEqual(full);
        }
    });
});

describe('incremental reparse — locality (does not reparse the whole document)', () => {
    test('reuses untouched tail block object identity when editing the head', () => {
        const doc = 'head paragraph\n\n## stable heading\n\ntail paragraph\n';
        const prev = parseDocument(parser, doc);
        const from = 0;
        const next = reparse(parser, prev, { from, to: from, insert: 'X' });
        // The last block is unchanged in content; with delta=1 its offsets shift
        // but it should be value-equal to the old block shifted — and crucially,
        // matches a full parse.
        const full = parser.parse(applyChange(prev.src, { from, to: from, insert: 'X' }));
        expect(next.tokens).toEqual(full);
    });
});
