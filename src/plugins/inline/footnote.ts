import { InlineContext, InlineRule, Token } from '../../core/types';
import { getFootnoteState } from '../footnotes';

export const footnote: InlineRule = {
    name: 'footnote',
    triggers: [91], // '['
    bindingPower: 9,
    nud(ctx: InlineContext): Token | null {
        const footnotes = getFootnoteState(ctx);
        if (!footnotes) return null;
        const start = ctx.pos;
        if (ctx.src.charCodeAt(start + 1) !== 94) return null;

        for (let index = start + 2; index < ctx.end; index++) {
            if (ctx.src.charCodeAt(index) !== 93) continue;
            const label = ctx.src.slice(start + 2, index);
            const reference = footnotes.register(label);
            if (!reference) return null;
            ctx.pos = index + 1;
            return {
                kind: 'footnote_ref',
                start,
                end: ctx.pos,
                content: label,
                attrs: {
                    id: reference.id,
                    refId: reference.refId,
                    number: reference.number,
                    refIndex: reference.refIndex,
                },
            };
        }

        return null;
    },
};
