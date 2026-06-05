import { describe, expect, it } from 'vitest';
import { commonmarkParser } from '../../src/presets/commonmark.js';
import { renderToHtml } from './html-renderer.js';

// These tests guard the micro-optimizations applied to the parser hot paths
// (eager CRLF normalization, the "interesting char" lookup table, the tight
// text-accumulation scan, and the paragraph-continuation pre-check). They
// assert behavioral invariants that the optimizations must preserve.

const DOCS: Record<string, string> = {
    'plain prose': 'The quick brown fox jumps over the lazy dog. '.repeat(40),
    'emphasis and code': 'This is **bold**, *italic*, and `code` mixed with text.',
    'heading then paragraph': '# Title\n\nA paragraph that follows the heading.',
    'paragraph interrupted by heading': 'Some text here\n# Heading\nmore text',
    'paragraph interrupted by list': 'Intro line\n- one\n- two',
    'paragraph interrupted by blockquote': 'Lead in\n> quoted',
    'paragraph interrupted by fence': 'Before\n```\ncode\n```',
    'paragraph interrupted by hr': 'Above\n***\nBelow',
    'ordered list interrupt': 'Para\n1. first\n2. second',
    'underscores not block': 'a_b_c plain_text with under_scores everywhere',
    'non-ascii prose': 'Café déjà vu naïve résumé — emoji 😀 and CJK 日本語 text here.',
    'links and images': 'See [link](http://example.com) and ![img](http://example.com/a.png).',
    'nested emphasis': '**bold *and italic* together** and ~~strike~~.',
    'many delimiters': '*'.repeat(50) + 'text' + '_'.repeat(50),
    'trailing spaces hardbreak': 'line one  \nline two',
};

describe('perf optimization stability', () => {
    for (const [name, src] of Object.entries(DOCS)) {
        it(`parses "${name}" deterministically`, () => {
            const first = JSON.stringify(commonmarkParser.parse(src));
            const second = JSON.stringify(commonmarkParser.parse(src));
            expect(second).toBe(first);
            // Sanity: rendering does not throw and produces output.
            expect(typeof renderToHtml(commonmarkParser.parse(src))).toBe('string');
        });
    }

    it('CRLF input produces identical tokens to LF input', () => {
        for (const src of Object.values(DOCS)) {
            const lf = src;
            const crlf = src.replace(/\n/g, '\r\n');
            expect(JSON.stringify(commonmarkParser.parse(crlf)))
                .toBe(JSON.stringify(commonmarkParser.parse(lf)));
        }
    });

    it('lone CR is normalized like LF', () => {
        const cr = 'line one\rline two';
        const lf = 'line one\nline two';
        expect(JSON.stringify(commonmarkParser.parse(cr)))
            .toBe(JSON.stringify(commonmarkParser.parse(lf)));
    });

    it('input without carriage returns is unaffected by normalization', () => {
        const src = 'no carriage returns here\njust newlines\n';
        expect(() => commonmarkParser.parse(src)).not.toThrow();
        expect(commonmarkParser.parse(src).length).toBeGreaterThan(0);
    });
});
