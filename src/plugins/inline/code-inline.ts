import { InlineRule, Token, InlineContext } from '../../core/types.js';

export const codeInline: InlineRule = {
    name: 'code_inline',
    triggers: [96], // backtick
    bindingPower: 10,
    nud(ctx: InlineContext): Token | null {
        const start = ctx.pos;
        let tickCount = 0;
        while (ctx.pos < ctx.end && ctx.peek() === 96) {
            tickCount++;
            ctx.advance();
        }

        // Find matching close sequence of exactly tickCount backticks
        const closeSeq = '`'.repeat(tickCount);
        let searchPos = ctx.pos;
        let closeIdx = -1;

        while (searchPos <= ctx.end - tickCount) {
            const idx = ctx.src.indexOf(closeSeq, searchPos);
            if (idx === -1 || idx + tickCount > ctx.end) break;
            // Make sure it's exactly tickCount backticks (not more)
            const before = idx > 0 ? ctx.src.charCodeAt(idx - 1) : -1;
            const after = idx + tickCount < ctx.src.length ? ctx.src.charCodeAt(idx + tickCount) : -1;
            if (before !== 96 && after !== 96) {
                closeIdx = idx;
                break;
            }
            // Skip past this sequence
            searchPos = idx + tickCount;
        }

        if (closeIdx === -1 || closeIdx >= ctx.end) {
            // No match — return text token for the backticks
            return { kind: 'text', start, end: ctx.pos, content: ctx.src.slice(start, ctx.pos) };
        }

        let content = ctx.src.slice(ctx.pos, closeIdx);
        // Normalize: collapse newlines to spaces
        content = content.replace(/\n/g, ' ');
        // Strip one leading/trailing space if content starts and ends with space but isn't all spaces
        if (content.length >= 2 &&
            content.charCodeAt(0) === 32 &&
            content.charCodeAt(content.length - 1) === 32 &&
            content.trim() !== '') {
            content = content.slice(1, -1);
        }
        ctx.pos = closeIdx + tickCount;
        return { kind: 'code_inline', start, end: ctx.pos, content };
    },
};
