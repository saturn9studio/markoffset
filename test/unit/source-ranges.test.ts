import { describe, expect, test } from 'vitest';
import type { Parser, TokenView } from '../../src/core/types.js';
import { tokenViews } from '../../src/core/parsed-block.js';
import { parseDocument, reparse } from '../../src/incremental.js';
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

const findSourceView = (
    views: readonly TokenView[],
    markdown: string,
    kind: string,
    expectedSource: string,
): TokenView | undefined => {
    for (const view of views) {
        if (
            view.token.kind === kind
            && markdown.slice(view.start, view.end) === expectedSource
        ) {
            return view;
        }
        const nested = findSourceView(
            view.children,
            markdown,
            kind,
            expectedSource,
        );
        if (nested) return nested;
    }
    return undefined;
};

const assertContained = (
    view: TokenView,
    parent: TokenView | undefined,
): void => {
    expect(view.start).toBeLessThanOrEqual(view.end);
    if (parent && !parent.generated && !view.generated) {
        expect(view.start).toBeGreaterThanOrEqual(parent.start);
        expect(view.end).toBeLessThanOrEqual(parent.end);
    }
    view.children.forEach(child => assertContained(child, view));
};

const expectSourceRange = (
    parser: Parser,
    markdown: string,
    kind: string,
    expectedSource: string,
): void => {
    const views = tokenViews(parser.parse(markdown));
    const view = findSourceView(views, markdown, kind, expectedSource);

    expect(view, `${kind} in ${JSON.stringify(markdown)}`).toBeDefined();
    expect(markdown.slice(view?.start, view?.end)).toBe(expectedSource);
    views.forEach(root => assertContained(root, undefined));
};

describe('resolved token source ranges', () => {
    const inlineCases = [
        ['plain text', 'text', 'plain', 'plain'],
        ['emphasis', 'em', '*em*', '*em*'],
        ['strong emphasis', 'strong', '**strong**', '**strong**'],
        ['inline code', 'code_inline', '`code`', '`code`'],
        [
            'link',
            'link',
            '[link](https://example.com "title")',
            '[link](https://example.com "title")',
        ],
        [
            'image',
            'image',
            '![alt](image.png "title")',
            '![alt](image.png "title")',
        ],
        [
            'autolink',
            'autolink',
            '<https://example.com>',
            '<https://example.com>',
        ],
        ['inline HTML', 'html_inline', 'before <br> after', '<br>'],
    ] as const;

    const blockContexts = [
        ['paragraph', (source: string) => source],
        ['one-space-indented paragraph', (source: string) => ` ${source}`],
        ['two-space-indented paragraph', (source: string) => `  ${source}`],
        ['three-space-indented paragraph', (source: string) => `   ${source}`],
        ['ATX heading', (source: string) => `# ${source}`],
        ['blockquote', (source: string) => `> ${source}`],
        ['list item', (source: string) => `- ${source}`],
        ['nested list item', (source: string) => `- outer\n  - ${source}`],
        ['blockquote list item', (source: string) => `> - ${source}`],
        ['setext heading', (source: string) => `  ${source}\n  ===`],
        ['multiline paragraph', (source: string) => `before\n  ${source}`],
        ['tabbed list continuation', (source: string) => `- outer\n\t${source}`],
        ['tabbed blockquote content', (source: string) => `>\t${source}`],
    ] as const;

    test.each(
        inlineCases.flatMap(([syntaxName, kind, source, expectedSource]) => (
            blockContexts.map(([contextName, wrap]) => ({
                name: `${syntaxName} in ${contextName}`,
                kind,
                source,
                expectedSource,
                markdown: wrap(source),
            }))
        )),
    )('maps $name exactly', ({ kind, expectedSource, markdown }) => {
        expectSourceRange(commonmarkParser, markdown, kind, expectedSource);
    });

    test.each(inlineCases)(
        'keeps full, bounded, and incremental %s ranges equivalent',
        (_name, kind, source, expectedSource) => {
            const target = `  ${source}`;
            const markdown = `before\n\n${target}\n\nafter`;
            const from = markdown.indexOf(target);
            const to = from + target.length;

            expectSourceRange(commonmarkParser, markdown, kind, expectedSource);

            const boundedViews = tokenViews(
                commonmarkParser.parseRange(markdown, from, to),
            );
            const bounded = findSourceView(
                boundedViews,
                markdown,
                kind,
                expectedSource,
            );
            expect(bounded).toBeDefined();
            boundedViews.forEach(root => assertContained(root, undefined));

            const prefix = 'prefix\n\n';
            const previous = parseDocument(commonmarkParser, markdown);
            const incremental = reparse(commonmarkParser, previous, {
                from: 0,
                to: 0,
                insert: prefix,
            });
            const updated = prefix + markdown;
            const incrementalViews = tokenViews(incremental.blocks);
            const incrementalView = findSourceView(
                incrementalViews,
                updated,
                kind,
                expectedSource,
            );

            expect(incrementalView).toBeDefined();
            expect(incremental.blocks).toEqual(commonmarkParser.parse(updated));
            incrementalViews.forEach(root => assertContained(root, undefined));
        },
    );

    test.each(inlineCases)(
        'maps %s exactly inside a GFM table cell',
        (_name, kind, source, expectedSource) => {
            const markdown = `| A |\n| --- |\n| ${source} |`;

            expectSourceRange(gfmParser, markdown, kind, expectedSource);
        },
    );

    test.each([
        ['escaped punctuation', '\\*', '*'],
        ['named entity', '&amp;', '&'],
        ['numeric entity', '&#42;', '*'],
        ['hexadecimal entity', '&#x2A;', '*'],
    ])(
        'keeps the source range for decoded %s text',
        (_name, source, content) => {
            const markdown = `> - ${source}`;
            const views = tokenViews(commonmarkParser.parse(markdown));
            const text = findSourceView(views, markdown, 'text', source);

            expect(text?.token.content).toBe(content);
            views.forEach(root => assertContained(root, undefined));
        },
    );

    test.each([
        ['soft break', 'left\nright', 'softbreak', '\n'],
        ['backslash hard break', 'left\\\nright', 'hardbreak', '\\\n'],
        ['spaces hard break', 'left  \nright', 'hardbreak', '  \n'],
        ['blockquote soft break', '> left\n> right', 'softbreak', '\n'],
        ['blockquote hard break', '> left\\\n> right', 'hardbreak', '\\\n'],
        ['list soft break', '- left\n  right', 'softbreak', '\n'],
        ['list hard break', '- left\\\n  right', 'hardbreak', '\\\n'],
    ])(
        'maps %s to its exact source',
        (_name, markdown, kind, expectedSource) => {
            expectSourceRange(
                commonmarkParser,
                markdown,
                kind,
                expectedSource,
            );
        },
    );

    test.each([
        ['full reference link', '[label][ref]', 'link'],
        ['collapsed reference link', '[ref][]', 'link'],
        ['shortcut reference link', '[ref]', 'link'],
        ['full reference image', '![alt][ref]', 'image'],
        ['collapsed reference image', '![ref][]', 'image'],
        ['shortcut reference image', '![ref]', 'image'],
    ])(
        'maps %s through document-wide reference state',
        (_name, source, kind) => {
            const markdown = `  ${source}\n\n[ref]: https://example.com`;

            expectSourceRange(commonmarkParser, markdown, kind, source);
        },
    );

    test.each([
        ['strikethrough', 'strikethrough', '~~strike~~'],
        ['bare URL', 'autolink', 'https://example.com'],
        ['bare email', 'autolink', 'person@example.com'],
        ['footnote reference', 'footnote_ref', '[^note]'],
    ])(
        'maps GFM %s through transformed contexts',
        (_name, kind, source) => {
            const markdown = kind === 'footnote_ref'
                ? `> - ${source}\n\n[^note]: Note`
                : `| A |\n| --- |\n| ${source} |`;

            expectSourceRange(gfmParser, markdown, kind, source);
        },
    );

    test.each([
        ['code span', '`x\\|y`', 'code_inline'],
        ['emphasis', '*x\\|y*', 'em'],
        ['strong emphasis', '**x\\|y**', 'strong'],
        ['link label', '[x\\|y](https://example.com)', 'link'],
        ['image label', '![x\\|y](image.png)', 'image'],
    ])(
        'maps %s across escaped GFM table separators',
        (_name, source, kind) => {
            const markdown = `| A |\n| --- |\n| ${source} |`;

            expectSourceRange(gfmParser, markdown, kind, source);
        },
    );

    test.each([
        ['paragraph', 'before\n\u00a0**bold**\u2003\nafter'],
        ['blockquote', '> before\n> \u00a0**bold**\u2003\n> after'],
        ['list item', '- before\n  \u00a0**bold**\u2003\n  after'],
    ])(
        'preserves internal Unicode whitespace in a %s',
        (_name, markdown) => {
            const views = tokenViews(gfmParser.parse(markdown));
            const leading = findSourceView(views, markdown, 'text', '\u00a0');
            const trailing = findSourceView(views, markdown, 'text', '\u2003');

            expect(leading?.token.content).toBe('\u00a0');
            expect(trailing?.token.content).toBe('\u2003');
            views.forEach(root => assertContained(root, undefined));
        },
    );

    test('does not treat a Unicode-whitespace lazy continuation as blank', () => {
        const markdown = '> start\n\u00a0\ncontinuation';
        const views = tokenViews(commonmarkParser.parse(markdown));
        const blockquote = findView(views, 'blockquote');
        const unicodeWhitespace = findSourceView(
            blockquote?.children ?? [],
            markdown,
            'text',
            '\u00a0',
        );
        const continuation = findSourceView(
            blockquote?.children ?? [],
            markdown,
            'text',
            'continuation',
        );

        expect(unicodeWhitespace?.token.content).toBe('\u00a0');
        expect(continuation?.token.content).toBe('continuation');
        views.forEach(root => assertContained(root, undefined));
    });

    test('preserves Unicode-whitespace ranges in bounded and incremental parses', () => {
        const target = '> start\n\u00a0\ncontinuation';
        const markdown = `before\n\n${target}\n\nafter`;
        const from = markdown.indexOf(target);
        const to = from + target.length;
        const bounded = tokenViews(
            commonmarkParser.parseRange(markdown, from, to),
        );

        expect(
            findSourceView(bounded, markdown, 'text', '\u00a0')?.token.content,
        ).toBe('\u00a0');

        const prefix = 'prefix\n\n';
        const incremental = reparse(
            commonmarkParser,
            parseDocument(commonmarkParser, markdown),
            { from: 0, to: 0, insert: prefix },
        );
        const updated = prefix + markdown;
        const incrementalViews = tokenViews(incremental.blocks);

        expect(
            findSourceView(
                incrementalViews,
                updated,
                'text',
                '\u00a0',
            )?.token.content,
        ).toBe('\u00a0');
        expect(incremental.blocks).toEqual(commonmarkParser.parse(updated));
    });

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
