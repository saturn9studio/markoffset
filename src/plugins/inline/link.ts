import { InlineRule, Token, InlineContext } from '../../core/types.js';
import { getLinkReference, parseLinkDestination, parseLinkTitle } from '../references.js';

export const link: InlineRule = {
    name: 'link',
    triggers: [91], // '['
    bindingPower: 8,
    nud(ctx: InlineContext): Token | null {
        const start = ctx.pos;
        ctx.advance();

        const textEnd = findClosingBracket(ctx.src, ctx.pos, ctx.end);
        if (textEnd === -1) return null;

        const textContent = ctx.src.slice(ctx.pos, textEnd);

        const inline = parseInlineLink(ctx, start, textEnd, textContent);
        if (inline) return inline;

        return parseReferenceLink(ctx, start, textEnd, textContent);
    },
};

function parseInlineLink(ctx: InlineContext, start: number, textEnd: number, textContent: string): Token | null {
    if (textEnd + 1 >= ctx.end || ctx.src.charCodeAt(textEnd + 1) !== 40) return null;
    if (hasCompetingInline(textContent)) return null;

    let p = textEnd + 2;
    p = skipWhitespace(ctx.src, p, ctx.end);

    let url = '';
    let newPos = p;
    const destResult = parseLinkDestination(ctx.src, p, ctx.end);
    if (destResult) {
        url = destResult.url;
        newPos = destResult.newPos;
    }

    p = skipWhitespace(ctx.src, newPos, ctx.end);

    let title: string | undefined;
    const hasTitleWhitespace = p > newPos;
    const titleResult = hasTitleWhitespace ? parseLinkTitle(ctx.src, p, ctx.end) : null;
    if (titleResult) {
        title = titleResult.title;
        p = titleResult.newPos;
    }

    p = skipWhitespace(ctx.src, p, ctx.end);
    if (p >= ctx.end || ctx.src.charCodeAt(p) !== 41) return null;

    ctx.pos = p + 1;
    return createLinkToken(ctx, start, ctx.pos, textContent, url, title);
}

function parseReferenceLink(ctx: InlineContext, start: number, textEnd: number, textContent: string): Token | null {
    if (hasCompetingInline(textContent)) return null;
    const parsedLabel = parseReferenceLabel(ctx.src, textEnd + 1, ctx.end);
    const labelText = parsedLabel?.label === '' ? textContent : parsedLabel?.label ?? textContent;
    const reference = getLinkReference(ctx, labelText);
    if (!reference) return null;

    ctx.pos = parsedLabel?.newPos ?? textEnd + 1;
    return createLinkToken(ctx, start, ctx.pos, textContent, reference.url, reference.title);
}

function hasCompetingInline(text: string): boolean {
    return hasNestedLink(text) || hasUnclosedInlineHtml(text) || hasUnclosedCodeSpan(text);
}

function hasNestedLink(text: string): boolean {
    for (let index = 0; index < text.length - 1; index++) {
        if (text.charCodeAt(index) !== 93) continue;
        const next = text.charCodeAt(index + 1);
        if (next !== 40 && next !== 91) continue;
        const opener = text.lastIndexOf('[', index);
        if (opener <= 0 || text.charCodeAt(opener - 1) !== 33) return true;
    }
    return false;
}

function hasUnclosedInlineHtml(text: string): boolean {
    const opener = text.indexOf('<');
    return opener !== -1 && text.indexOf('>', opener + 1) === -1;
}

function hasUnclosedCodeSpan(text: string): boolean {
    return (text.match(/`+/gu) ?? []).length % 2 === 1;
}

function createLinkToken(ctx: InlineContext, start: number, end: number, content: string, url: string, title: string | undefined): Token {
    const tok: Token = {
        kind: 'link',
        start,
        end,
        url,
        content,
        children: ctx.parseInline(content),
    };
    if (title !== undefined) tok.title = title;
    return tok;
}

function findClosingBracket(src: string, pos: number, end: number): number {
    let depth = 1;
    for (let i = pos; i < end; i++) {
        const c = src.charCodeAt(i);
        if (c === 91) depth++;
        else if (c === 93) {
            depth--;
            if (depth === 0) return i;
        } else if (c === 92 && i + 1 < end) {
            i++;
        }
    }
    return -1;
}

function parseReferenceLabel(src: string, pos: number, end: number): { label: string; newPos: number } | null {
    if (pos >= end || src.charCodeAt(pos) !== 91) return null;
    for (let i = pos + 1; i < end; i++) {
        const c = src.charCodeAt(i);
        if (c === 92 && i + 1 < end) {
            i++;
            continue;
        }
        if (c === 91) return null;
        if (c === 93) return { label: src.slice(pos + 1, i), newPos: i + 1 };
    }
    return null;
}

function skipWhitespace(src: string, pos: number, end: number): number {
    let p = pos;
    while (p < end && (src.charCodeAt(p) === 32 || src.charCodeAt(p) === 9 || src.charCodeAt(p) === 10)) p++;
    return p;
}
