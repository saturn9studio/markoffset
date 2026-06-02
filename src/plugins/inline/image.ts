import { InlineRule, Token, InlineContext } from '../../core/types';
import { getLinkReference, parseLinkDestination, parseLinkTitle } from '../references';

export const image: InlineRule = {
    name: 'image',
    triggers: [33], // '!'
    bindingPower: 8,
    nud(ctx: InlineContext): Token | null {
        const start = ctx.pos;
        if (ctx.pos + 1 >= ctx.end || ctx.src.charCodeAt(ctx.pos + 1) !== 91) return null;

        ctx.advance(2);
        const textEnd = findClosingBracket(ctx.src, ctx.pos, ctx.end);
        if (textEnd === -1) return null;

        const altText = ctx.src.slice(ctx.pos, textEnd);

        const inline = parseInlineImage(ctx, start, textEnd, altText);
        if (inline) return inline;

        return parseReferenceImage(ctx, start, textEnd, altText);
    },
};

function parseInlineImage(ctx: InlineContext, start: number, textEnd: number, altText: string): Token | null {
    if (textEnd + 1 >= ctx.end || ctx.src.charCodeAt(textEnd + 1) !== 40) return null;

    let p = skipWhitespace(ctx.src, textEnd + 2, ctx.end);

    let url = '';
    const destResult = parseLinkDestination(ctx.src, p, ctx.end);
    if (destResult) {
        url = destResult.url;
        p = destResult.newPos;
    }

    p = skipWhitespace(ctx.src, p, ctx.end);

    let title: string | undefined;
    const hasTitleWhitespace = p > (destResult?.newPos ?? textEnd + 2);
    const titleResult = hasTitleWhitespace ? parseLinkTitle(ctx.src, p, ctx.end) : null;
    if (titleResult) {
        title = titleResult.title;
        p = titleResult.newPos;
    }

    p = skipWhitespace(ctx.src, p, ctx.end);
    if (p >= ctx.end || ctx.src.charCodeAt(p) !== 41) return null;

    ctx.pos = p + 1;
    return createImageToken(ctx, start, ctx.pos, altText, url, title);
}

function parseReferenceImage(ctx: InlineContext, start: number, textEnd: number, altText: string): Token | null {
    const parsedLabel = parseReferenceLabel(ctx.src, textEnd + 1, ctx.end);
    const labelText = parsedLabel?.label === '' ? altText : parsedLabel?.label ?? altText;
    const reference = getLinkReference(ctx, labelText);
    if (!reference) return null;

    ctx.pos = parsedLabel?.newPos ?? textEnd + 1;
    return createImageToken(ctx, start, ctx.pos, altText, reference.url, reference.title);
}

function createImageToken(ctx: InlineContext, start: number, end: number, content: string, url: string, title: string | undefined): Token {
    const tok: Token = { kind: 'image', start, end, url, content, children: ctx.parseInline(content) };
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
