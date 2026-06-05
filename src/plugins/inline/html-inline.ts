import { InlineContext, InlineRule, Token } from '../../core/types.js';
import { filterDisallowedHtmlTags } from '../tagfilter.js';

export const htmlInline = createHtmlInlineRule(false);
export const gfmHtmlInline = createHtmlInlineRule(true);

function createHtmlInlineRule(tagFilter: boolean): InlineRule {
    return {
    name: 'html_inline',
    triggers: [60], // '<'
    bindingPower: 10,
    mayStart(src: string, pos: number): boolean {
        return src.charCodeAt(pos) === 60;
    },
    nud(ctx: InlineContext): Token | null {
        const start = ctx.pos;
        const source = ctx.src.slice(start, ctx.end);
        const match = matchHtmlInline(source);
        if (!match) return null;

        ctx.advance(match.length);
        return {
            kind: 'html_inline',
            start,
            end: ctx.pos,
            content: tagFilter ? filterDisallowedHtmlTags(match) : match,
        };
    },
    };
}

function matchHtmlInline(source: string): string | null {
    return matchRegex(source, /^<!--(?:>|->|[\s\S]*?-->)|^<[?][\s\S]*?[?]>|^<![A-Z]+[\s\S]*?>|^<!\[CDATA\[[\s\S]*?\]\]>|^<\/[A-Za-z][A-Za-z0-9-]*[\t\n\f\r ]*>|^<[A-Za-z][A-Za-z0-9-]*(?:[\t\n\f\r ]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:[^ \t\n\f\r"'=<>`]+|'[^']*'|"[^"]*"))?)*[\t\n\f\r ]*\/?>/u);
}

function matchRegex(source: string, regex: RegExp): string | null {
    const match = source.match(regex);
    return match?.[0] ?? null;
}
