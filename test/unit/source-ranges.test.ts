import { describe, expect, test } from 'vitest';
import type { TokenView } from '../../src/core/types.js';
import { tokenViews } from '../../src/core/parsed-block.js';
import { commonmarkParser } from '../../src/presets/commonmark.js';
import { gfmParser } from '../../src/presets/gfm.js';

const findView = (
    views: readonly TokenView[],
    kind: string,
): TokenView | undefined => {
    for (const view of views) {
        if (view.token.kind === kind) return view;
        const nested = findView(view.children, kind);
        if (nested) return nested;
    }
    return undefined;
};

const assertContained = (
    view: TokenView,
    parent: TokenView | undefined,
): void => {
    expect(view.start).toBeLessThanOrEqual(view.end);
    if (parent) {
        expect(view.start).toBeGreaterThanOrEqual(parent.start);
        expect(view.end).toBeLessThanOrEqual(parent.end);
    }
    view.children.forEach(child => assertContained(child, view));
};

describe('resolved token source ranges', () => {
    test.each([
        ['***both***', '***both***', '**both**', 'both'],
        ['# ***heading***', '***heading***', '**heading**', 'heading'],
        ['- ***item***', '***item***', '**item**', 'item'],
        ['> ***quote***', '***quote***', '**quote**', 'quote'],
    ])(
        'maps nested emphasis through block syntax in %s',
        (markdown, emSource, strongSource, textSource) => {
            const views = tokenViews(commonmarkParser.parse(markdown));
            const em = findView(views, 'em');
            const strong = findView(views, 'strong');
            const text = findView(strong?.children ?? [], 'text');

            expect(markdown.slice(em?.start, em?.end)).toBe(emSource);
            expect(markdown.slice(strong?.start, strong?.end)).toBe(strongSource);
            expect(markdown.slice(text?.start, text?.end)).toBe(textSource);
            views.forEach(view => assertContained(view, undefined));
        },
    );

    test('maps inline children inside escaped GFM table cells', () => {
        const markdown = '| A |\n| --- |\n| `x\\|y` |';
        const views = tokenViews(gfmParser.parse(markdown));
        const code = findView(views, 'code_inline');

        expect(code?.token.content).toBe('x|y');
        expect(markdown.slice(code?.start, code?.end)).toBe('`x\\|y`');
        views.forEach(view => assertContained(view, undefined));
    });

    test('maps inline children after leading paragraph indentation', () => {
        const markdown = '  ![Alt](image.png "Title")';
        const views = tokenViews(commonmarkParser.parse(markdown));
        const image = findView(views, 'image');
        const text = findView(image?.children ?? [], 'text');

        expect(markdown.slice(image?.start, image?.end))
            .toBe('![Alt](image.png "Title")');
        expect(markdown.slice(text?.start, text?.end)).toBe('Alt');
        views.forEach(view => assertContained(view, undefined));
    });

    test('returns document-absolute views for bounded parses', () => {
        const markdown = 'before\n\n***target***\n\nafter';
        const from = markdown.indexOf('***target***');
        const to = from + '***target***'.length;
        const views = tokenViews(commonmarkParser.parseRange(markdown, from, to));
        const em = findView(views, 'em');

        expect(em?.start).toBe(from);
        expect(em?.end).toBe(to);
        expect(markdown.slice(em?.start, em?.end)).toBe('***target***');
    });

    test('marks generated footnote output as non-source-backed', () => {
        const markdown = 'Reference[^note].\n\n[^note]: Footnote text.';
        const blocks = gfmParser.parse(markdown);
        const views = tokenViews(blocks);
        const reference = findView(views, 'footnote_ref');
        const footnotes = findView(views, 'footnotes');

        expect(reference?.generated).toBe(false);
        expect(markdown.slice(reference?.start, reference?.end)).toBe('[^note]');
        expect(footnotes?.generated).toBe(true);
        expect(footnotes?.children.every(child => child.generated)).toBe(true);
        expect(blocks.find(block => block.token.kind === 'footnotes')?.generated).toBe(true);
    });
});
