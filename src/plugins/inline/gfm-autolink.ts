import { InlineRule, Token } from '../../core/types';

interface AutolinkMatch {
    end: number;
    urlPrefix: string;
}

const urlTriggers = 'FHMWXfhmwx'
    .split('')
    .map(ch => ch.charCodeAt(0));

const emailTriggers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    .split('')
    .map(ch => ch.charCodeAt(0));

export const gfmAutolink: InlineRule = {
    name: 'gfm-autolink',
    triggers: urlTriggers,
    bindingPower: 3,
    mayStart(src, pos, end): boolean {
        return mayStartAutolink(src, pos, end);
    },
    nud(ctx): Token | null {
        const match = matchUrlAutolink(ctx.src, ctx.pos, ctx.end);
        if (match === null) return null;

        const start = ctx.pos;
        const text = ctx.src.slice(start, match.end);
        ctx.advance(match.end - start);
        return {
            kind: 'autolink',
            start,
            end: ctx.pos,
            content: text,
            url: `${match.urlPrefix}${text}`,
        };
    },
};

export const gfmEmailAutolink: InlineRule = {
    name: 'gfm-email-autolink',
    triggers: emailTriggers,
    requiredChars: '@',
    bindingPower: 3,
    mayStart(src, pos, end): boolean {
        return canStartEmailAutolink(src, pos, end);
    },
    nud(ctx): Token | null {
        const match = matchEmailAutolink(ctx.src, ctx.pos, ctx.end);
        if (match === null) return null;

        const start = ctx.pos;
        const text = ctx.src.slice(start, match.end);
        ctx.advance(match.end - start);
        return {
            kind: 'autolink',
            start,
            end: ctx.pos,
            content: text,
            url: `${match.urlPrefix}${text}`,
        };
    },
};

function mayStartAutolink(src: string, pos: number, end: number): boolean {
    const previous = src.charCodeAt(pos - 1);
    const first = toLowerAscii(src.charCodeAt(pos));

    if (first === 104 && (
        startsWithAsciiIgnoreCase(src, pos, end, 'http://')
        || startsWithAsciiIgnoreCase(src, pos, end, 'https://')
    )) return true;
    if (first === 102 && startsWithAsciiIgnoreCase(src, pos, end, 'ftp://')) return true;
    if (first === 119 && startsWithAsciiIgnoreCase(src, pos, end, 'www.')) return true;
    if (!isAsciiAlphaNum(previous)) {
        if (first === 109 && startsWithAsciiIgnoreCase(src, pos, end, 'mailto:')) return true;
        if (first === 120 && startsWithAsciiIgnoreCase(src, pos, end, 'xmpp:')) return true;
    }

    return false;
}

function matchUrlAutolink(src: string, pos: number, end: number): AutolinkMatch | null {
    const first = toLowerAscii(src.charCodeAt(pos));
    if (first === 109) return matchMailtoAutolink(src, pos, end);
    if (first === 119) return matchWwwAutolink(src, pos, end);
    if (first === 104 || first === 102 || first === 120) return matchSchemeAutolink(src, pos, end);
    return null;
}

function matchMailtoAutolink(src: string, pos: number, end: number): AutolinkMatch | null {
    const emailEnd = scanEmailEnd(src, pos + 'mailto:'.length, end);
    return emailEnd === -1 ? null : { end: emailEnd, urlPrefix: '' };
}

function matchSchemeAutolink(src: string, pos: number, end: number): AutolinkMatch {
    return { end: trimTrailingPunctuationEnd(src, pos, scanAutolinkSpanEnd(src, pos, end)), urlPrefix: '' };
}

function matchWwwAutolink(src: string, pos: number, end: number): AutolinkMatch | null {
    const textEnd = trimTrailingPunctuationEnd(src, pos, scanAutolinkSpanEnd(src, pos, end));
    const slash = src.indexOf('/', pos);
    const hostEnd = slash === -1 || slash > textEnd ? textEnd : slash;
    if (!isValidHost(src, pos, hostEnd)) return null;
    return { end: textEnd, urlPrefix: 'http://' };
}

function matchEmailAutolink(src: string, pos: number, end: number): AutolinkMatch | null {
    const emailEnd = scanEmailEnd(src, pos, end);
    if (emailEnd === -1) return null;
    const next = src.charCodeAt(emailEnd);
    return next === 45 || next === 95 ? null : { end: emailEnd, urlPrefix: 'mailto:' };
}

function scanAutolinkSpanEnd(src: string, pos: number, end: number): number {
    let index = pos;
    while (index < end) {
        const char = src.charCodeAt(index);
        if (char <= 32 || char === 60) break;
        index++;
    }
    return index;
}

function trimTrailingPunctuationEnd(src: string, start: number, end: number): number {
    while (end > start && isTrailingPunctuation(src.charCodeAt(end - 1))) end--;
    const entityStart = trailingEntityStart(src, start, end);
    if (entityStart !== -1) end = entityStart;
    while (end > start && src.charCodeAt(end - 1) === 41 && hasUnmatchedClosingParen(src, start, end)) end--;
    while (end > start && isTrailingPunctuation(src.charCodeAt(end - 1))) end--;
    while (end > start + 1 && src.charCodeAt(end - 1) === 41 && isTrailingPunctuation(src.charCodeAt(end - 2))) {
        end--;
        while (end > start && isTrailingPunctuation(src.charCodeAt(end - 1))) end--;
        return end;
    }
    return end;
}

function isTrailingPunctuation(char: number): boolean {
    return char === 33
        || char === 34
        || char === 39
        || char === 42
        || char === 44
        || char === 46
        || char === 58
        || char === 63
        || char === 95
        || char === 126;
}

function trailingEntityStart(value: string, start: number, end: number): number {
    if (end - start < 4 || value.charCodeAt(end - 1) !== 59) return -1;
    let index = end - 2;
    while (index >= start && isAsciiAlphaNum(value.charCodeAt(index))) index--;
    const nameStart = index + 1;
    const nameLength = end - 1 - nameStart;
    if (nameLength < 2 || value.charCodeAt(index) !== 38) return -1;
    const first = value.charCodeAt(nameStart);
    return (first >= 65 && first <= 90) || (first >= 97 && first <= 122) ? index : -1;
}

function isAsciiAlphaNum(char: number): boolean {
    return (char >= 48 && char <= 57) || (char >= 65 && char <= 90) || (char >= 97 && char <= 122);
}

function startsWithAsciiIgnoreCase(src: string, pos: number, end: number, value: string): boolean {
    if (pos + value.length > end) return false;
    for (let index = 0; index < value.length; index++) {
        if (toLowerAscii(src.charCodeAt(pos + index)) !== value.charCodeAt(index)) return false;
    }
    return true;
}

function toLowerAscii(code: number): number {
    return code >= 65 && code <= 90 ? code + 32 : code;
}

function canStartEmailAutolink(src: string, pos: number, end: number): boolean {
    if (isEmailLocalPartChar(src.charCodeAt(pos - 1))) return false;
    let at = -1;
    for (let index = pos + 1; index < end; index++) {
        const char = src.charCodeAt(index);
        if (char === 64) {
            at = index;
            break;
        }

        if (char <= 32 || char === 60) return false;
    }
    return at > pos && at + 1 < end && isAsciiAlphaNum(src.charCodeAt(at + 1));
}

function isEmailLocalPartChar(char: number): boolean {
    return isAsciiAlphaNum(char)
        || char === 33
        || (char >= 35 && char <= 39)
        || char === 42
        || char === 43
        || char === 45
        || char === 46
        || char === 61
        || char === 63
        || char === 94
        || char === 95
        || char === 96
        || (char >= 123 && char <= 126);
}

function scanEmailEnd(src: string, pos: number, end: number): number {
    let index = pos;
    while (index < end && isEmailLocalPartChar(src.charCodeAt(index))) index++;
    if (index === pos || index >= end || src.charCodeAt(index) !== 64) return -1;
    return scanEmailDomainEnd(src, index + 1, end);
}

function scanEmailDomainEnd(src: string, pos: number, end: number): number {
    let index = pos;
    let labelCount = 0;

    while (index < end) {
        if (!isAsciiAlphaNum(src.charCodeAt(index))) return labelCount > 1 ? index : -1;

        const labelStart = index;
        let labelEnd = index + 1;
        index++;

        while (index < end && index - labelStart < 63 && isEmailDomainLabelChar(src.charCodeAt(index))) {
            if (isAsciiAlphaNum(src.charCodeAt(index))) labelEnd = index + 1;
            index++;
        }

        labelCount++;
        if (labelEnd >= end || src.charCodeAt(labelEnd) !== 46) return labelCount > 1 ? labelEnd : -1;
        if (labelEnd + 1 >= end || !isAsciiAlphaNum(src.charCodeAt(labelEnd + 1))) {
            return labelCount > 1 ? labelEnd : -1;
        }
        index = labelEnd + 1;
    }

    return -1;
}

function isEmailDomainLabelChar(char: number): boolean {
    return isAsciiAlphaNum(char) || char === 45 || char === 95;
}

function hasUnmatchedClosingParen(value: string, start: number, end: number): boolean {
    let opens = 0;
    let closes = 0;
    for (let index = start; index < end; index++) {
        const char = value.charCodeAt(index);
        if (char === 40) opens++;
        else if (char === 41) closes++;
    }
    return closes > opens;
}

function isValidHost(host: string, start: number, end: number): boolean {
    let labelIndex = 0;
    let labelStart = start;
    let hasUnderscore = false;

    for (let index = start; index <= end; index++) {
        const char = index === end ? 46 : host.charCodeAt(index);
        if (char === 95) hasUnderscore = true;
        if (char !== 46) continue;

        if (index === labelStart) return false;
        if (hasUnderscore && labelIndex !== 1) return false;
        labelIndex++;
        labelStart = index + 1;
        hasUnderscore = false;
    }

    return labelIndex > 1;
}
