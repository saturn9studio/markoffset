import { InlineRule, Token, InlineContext } from '../../core/types';

// Hard line breaks: two or more spaces at end of line before newline,
// or backslash at end of line before newline.
export const hardbreak: InlineRule = {
    name: 'hardbreak',
    triggers: [32, 92], // space (32) and backslash (92)
    bindingPower: 1,
    nud(ctx: InlineContext): Token | null {
        const start = ctx.pos;
        const ch = ctx.peek();

        if (ch === 92) { // backslash
            // Must be followed by newline
            if (ctx.pos + 1 < ctx.end && ctx.src.charCodeAt(ctx.pos + 1) === 10) {
                ctx.advance(2); // consume '\' and '\n'
                return { kind: 'hardbreak', start, end: ctx.pos };
            }
            return null; // not a hard break — let other rules handle it
        }

        if (ch === 32) {
            // Two or more spaces followed by newline
            let spaceCount = 0;
            let i = ctx.pos;
            while (i < ctx.end && ctx.src.charCodeAt(i) === 32) { spaceCount++; i++; }
            if (spaceCount >= 2 && i < ctx.end && ctx.src.charCodeAt(i) === 10) {
                ctx.pos = i + 1; // consume spaces and newline
                return { kind: 'hardbreak', start, end: ctx.pos };
            }
            return null;
        }

        return null;
    },
};
