import type { ParsedBlock, Token, TokenView } from './types.js';

export function blockTokens(blocks: readonly ParsedBlock[]): Token[] {
    return blocks.map(block => block.token);
}

export function resolveToken(
    block: ParsedBlock,
    token: Token = block.token,
    generated: boolean = block.generated || token.generated === true,
): TokenView {
    return {
        token,
        start: block.start + token.start,
        end: block.start + token.end,
        generated,
        children: (token.children ?? []).map(child =>
            resolveToken(block, child, generated || child.generated === true)
        ),
    };
}

export function tokenViews(blocks: readonly ParsedBlock[]): TokenView[] {
    return blocks.map(block => resolveToken(block));
}
