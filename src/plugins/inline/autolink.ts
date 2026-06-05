import { InlineRule, Token, InlineContext } from '../../core/types.js';

// Autolinks: <url> or <email>
// Spec: absolute URIs or email addresses enclosed in < and >
export const autolink: InlineRule = {
    name: 'autolink',
    triggers: [60], // '<'
    bindingPower: 10,
    nud(ctx: InlineContext): Token | null {
        const start = ctx.pos;
        ctx.advance(); // consume '<'

        let i = ctx.pos;
        // Collect until '>' or end
        while (i < ctx.end && ctx.src.charCodeAt(i) !== 62 && ctx.src.charCodeAt(i) !== 10) {
            i++;
        }

        if (i >= ctx.end || ctx.src.charCodeAt(i) !== 62) {
            // No closing '>' — restore and fail
            ctx.pos = start;
            return null;
        }

        const inner = ctx.src.slice(ctx.pos, i);
        ctx.pos = i + 1; // consume '>'

        // Check if it's a valid autolink URI: scheme + colon + no spaces/control chars
        // Scheme: 2-32 ASCII letters
        const colonIdx = inner.indexOf(':');
        if (colonIdx >= 2 && colonIdx <= 32) {
            const scheme = inner.slice(0, colonIdx);
            if (/^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(scheme)) {
                // Valid URI scheme; check no spaces or < in rest
                const rest = inner.slice(colonIdx + 1);
                if (!/[ \t<]/.test(rest)) {
                    return {
                        kind: 'autolink',
                        start,
                        end: ctx.pos,
                        url: inner,
                        content: inner,
                    };
                }
            }
        }

        // Check if it's a valid email address
        if (/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(inner)) {
            return {
                kind: 'autolink',
                start,
                end: ctx.pos,
                url: 'mailto:' + inner,
                content: inner,
            };
        }

        // Not a valid autolink — restore pos and fail
        ctx.pos = start;
        return null;
    },
};
