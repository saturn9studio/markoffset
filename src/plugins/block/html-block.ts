import { BlockRule, Token } from '../../core/types.js';
import { filterDisallowedHtmlTags } from '../tagfilter.js';

const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center',
    'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu',
    'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section',
    'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
]);

type HtmlBlockMatch =
    | { type: 'until'; end: RegExp; canInterrupt: boolean }
    | { type: 'blank'; canInterrupt: boolean };

export const htmlBlock = createHtmlBlockRule(false);
export const gfmHtmlBlock = createHtmlBlockRule(true);

function createHtmlBlockRule(tagFilter: boolean): BlockRule {
    return {
    name: 'html-block',
    priority: 95,
    startChars: '<',
    match(line: string): boolean {
        return getHtmlBlockMatch(line) !== null;
    },
    canInterruptParagraph(line: string): boolean {
        return getHtmlBlockMatch(line)?.canInterrupt ?? false;
    },
    parse(scanner): Token {
        const start = scanner.currentLineStart();
        const match = getHtmlBlockMatch(scanner.currentLine());
        const lines: string[] = [];

        while (!scanner.atEnd()) {
            const line = scanner.currentLine();
            if (match?.type === 'blank' && line.trim() === '') break;

            lines.push(line);
            scanner.advance();

            if (!match) break;
            if (match.type === 'until' && match.end.test(line)) break;
        }

        const end = scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start;
        return {
            kind: 'html_block',
            start,
            end: Math.max(start, end),
            content: filterHtmlBlock(lines.join('\n') + '\n', tagFilter),
        };
    },
    };
}

function filterHtmlBlock(content: string, tagFilter: boolean): string {
    return tagFilter ? filterDisallowedHtmlTags(content) : content;
}

function getHtmlBlockMatch(line: string): HtmlBlockMatch | null {
    const rest = stripUpToThreeSpaces(line);
    if (!rest.startsWith('<')) return null;

    if (/^<(?:script|pre|style|textarea)(?:[\t\n\f\r />]|$)/iu.test(rest)) {
        const tag = rest.match(/^<([A-Za-z][A-Za-z0-9-]*)/u)?.[1].toLowerCase();
        return tag ? { type: 'until', end: new RegExp(`</${tag}>`, 'iu'), canInterrupt: true } : null;
    }

    if (rest.startsWith('<!--')) return { type: 'until', end: /-->/u, canInterrupt: true };
    if (rest.startsWith('<?')) return { type: 'until', end: /\?>/u, canInterrupt: true };
    if (/^<![A-Z]/u.test(rest)) return { type: 'until', end: />/u, canInterrupt: true };
    if (rest.startsWith('<![CDATA[')) return { type: 'until', end: /\]\]>/u, canInterrupt: true };

    const blockTag = rest.match(/^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[\t\n\f\r />]|$)/u)?.[1].toLowerCase();
    if (blockTag && BLOCK_TAGS.has(blockTag)) return { type: 'blank', canInterrupt: true };

    if (isCompleteTagLine(rest)) return { type: 'blank', canInterrupt: false };

    return null;
}

function isCompleteTagLine(rest: string): boolean {
    return /^<\/[A-Za-z][A-Za-z0-9-]*[\t\n\f\r ]*>[\t ]*$/u.test(rest)
        || /^<[A-Za-z][A-Za-z0-9-]*(?:[\t\n\f\r ]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:[^ \t\n\f\r"'=<>`]+|'[^']*'|"[^"]*"))?)*[\t\n\f\r ]*\/?>[\t ]*$/u.test(rest);
}

function stripUpToThreeSpaces(line: string): string {
    let i = 0;
    while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
    return line.slice(i);
}
