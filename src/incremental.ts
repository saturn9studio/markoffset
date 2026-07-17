import { Parser, Token } from './core/types.js';

/**
 * A text edit: replace the half-open range [from, to) of the OLD source with
 * `insert`.
 */
export interface Change {
    from: number;
    to: number;
    insert: string;
}

/**
 * Reusable parse state. `src` is the normalized source (line endings collapsed
 * to `\n`, exactly as the underlying parser sees it) and `tokens` are the
 * top-level block tokens for that source.
 */
export interface ParseState {
    src: string;
    tokens: Token[];
    documentStateFingerprint: string;
    requiresFullIncrementalReparse: boolean;
}

/**
 * Normalize line endings the same way `Parser.parse` does internally so that the
 * offsets we track line up with the offsets the parser produces.
 */
function normalize(src: string): string {
    return src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Full parse that also captures reusable state for later incremental reparses.
 */
export function parseDocument(parser: Parser, src: string): ParseState {
    const normalized = normalize(src);
    const metadata = parser.incrementalMetadata(normalized);
    return {
        src: normalized,
        tokens: parser.parse(normalized),
        ...metadata,
    };
}

/**
 * All block-level tokens — including `list_item` children of bullet/ordered
 * lists, and the block children of `list_item` itself — use document-absolute
 * offsets. Inline children (paragraph/heading/fence) and blockquote children
 * remain content-relative and are never shifted.
 */
function shiftChildren(parentKind: string, children: Token[], delta: number): Token[] {
    if (parentKind === 'bullet_list' || parentKind === 'ordered_list') {
        // children are list_item tokens — document-absolute, recurse.
        return children.map(item => shiftToken(item, delta));
    }
    if (parentKind === 'list_item') {
        // children are block tokens — document-absolute, recurse.
        return children.map(child => shiftToken(child, delta));
    }
    if (
        parentKind === 'table' ||
        parentKind === 'table_head' ||
        parentKind === 'table_body' ||
        parentKind === 'table_header' ||
        parentKind === 'table_row'
    ) {
        // Table sections, rows, and cells all carry document-absolute ranges.
        return children.map(child => shiftToken(child, delta));
    }
    if (parentKind === 'blockquote') {
        // blockquote children come from parseBlocks(innerSrc) — content-relative, never shift.
        return children;
    }
    // paragraph/heading/fence: inline children — content-relative, never shift.
    return children;
}

/**
 * Shift a block token's document-absolute `start`/`end` offsets by `delta`,
 * returning a fresh token. Recurses into block-level children (lists and
 * list_item block children), which are also document-absolute. Inline children
 * and blockquote children are content-relative and left untouched.
 */
function shiftToken(token: Token, delta: number): Token {
    if (delta === 0) return token;
    return {
        ...token,
        start: token.start + delta,
        end:   token.end + delta,
        children: token.children ? shiftChildren(token.kind, token.children, delta) : undefined,
    };
}

/**
 * Structural equality of two block tokens IGNORING absolute offsets but
 * INCLUDING everything that affects rendered output (kind, content, markup,
 * nested structure, inline children). Used to detect the resync point: the first
 * place where the new parse produces a block identical (modulo position) to an
 * old block whose old-start lines up, offset-adjusted, with the new block's
 * start.
 */
function sameShape(a: Token, b: Token): boolean {
    if (a.kind !== b.kind) return false;
    if (a.content !== b.content) return false;
    if (a.markup !== b.markup) return false;
    if (a.info !== b.info) return false;
    if (a.level !== b.level) return false;
    if (a.url !== b.url) return false;
    if (a.title !== b.title) return false;
    if (JSON.stringify(a.attrs ?? null) !== JSON.stringify(b.attrs ?? null)) return false;
    if (a.ordered !== b.ordered) return false;
    if (a.startNum !== b.startNum) return false;
    if (a.tight !== b.tight) return false;
    const ac = a.children ?? [];
    const bc = b.children ?? [];
    if (ac.length !== bc.length) return false;
    for (let i = 0; i < ac.length; i++) {
        if (!sameShape(ac[i], bc[i])) return false;
    }
    return true;
}

/**
 * Re-parse only the region of the document affected by `change`, reusing the
 * previously parsed blocks before and after it.
 *
 * Strategy — block-level reuse with resynchronization:
 *
 *   1. Apply the change to produce the new source and the length `delta`.
 *   2. HEAD: every old block ending at or before `from` is unaffected. Its text
 *      is byte-identical in the new source, so reuse it verbatim.
 *   3. Re-parse the new source from the line boundary that begins the first
 *      possibly-affected block to the end of the document, producing fresh tail
 *      blocks. (Top-level block parsing is purely line-local — the parser carries
 *      no container state across top-level blocks — so a re-parse that starts on
 *      a clean line boundary is independent of everything before it.)
 *   4. RESYNC: walk the freshly parsed blocks and the old tail blocks in
 *      lockstep, looking for a new block whose start equals an old block's start
 *      shifted by `delta` AND whose shape is identical. From that point on the
 *      old (shifted) blocks are provably identical to a full re-parse, so we stop
 *      and reuse them — typically after re-parsing only one or two blocks past
 *      the edit.
 *
 * The result is guaranteed identical to `parser.parse(newSrc)`. The head/tail
 * reuse is sound by line-locality; the freshly parsed middle is, by
 * construction, exactly what a full parse produces for that span.
 */
export function reparse(parser: Parser, prev: ParseState, change: Change): ParseState {
    const { from, to, insert } = change;
    const oldSrc = prev.src;
    const insertNorm = normalize(insert);
    const newSrc = oldSrc.slice(0, from) + insertNorm + oldSrc.slice(to);
    const delta = insertNorm.length - (to - from);
    const oldTokens = prev.tokens;
    const metadata = parser.incrementalMetadata(newSrc);

    if (
        prev.documentStateFingerprint !== metadata.documentStateFingerprint ||
        prev.requiresFullIncrementalReparse ||
        metadata.requiresFullIncrementalReparse
    ) {
        return {
            src: newSrc,
            tokens: parser.parse(newSrc),
            ...metadata,
        };
    }

    // HEAD: unaffected leading blocks. A block is in the head only if it ends
    // strictly before `from` AND is not the block immediately preceding the edit
    // — because an edit at/near a block boundary can merge that block with the
    // following content (e.g. deleting the blank line between two paragraphs). We
    // therefore back up one block past the last block that ends before `from`,
    // re-parsing it as part of the region. This keeps reuse correct at boundaries.
    let lastBefore = 0;
    while (lastBefore < oldTokens.length && oldTokens[lastBefore].end < from) lastBefore++;
    const headEnd = Math.max(0, lastBefore - 1);

    // Region to re-parse begins at the start of the first non-head block (a
    // top-level line boundary), or document start if there is no head. This
    // offset is identical in old and new source because everything before it is
    // unchanged (the head blocks end before `from`).
    const regionStart = headEnd > 0 ? oldTokens[headEnd].start : 0;

    const head = oldTokens.slice(0, headEnd);

    // Candidate resync anchors: old blocks that start at/after `to` (their text
    // is unchanged by the edit). Each anchor's old start, shifted by `delta`,
    // is a position in the new source where the unchanged tail could resume.
    let firstTail = headEnd;
    while (firstTail < oldTokens.length && oldTokens[firstTail].start < to) firstTail++;

    // Try each candidate anchor in order. For anchor `j` we re-parse the BOUNDED
    // region [regionStart, verifyEnd) that INCLUDES the anchor block itself
    // (extending to the start of the following old block, j+1, or EOF). Resync is
    // confirmed only when the bounded parse reproduces a block that starts exactly
    // at the anchor's shifted position with shape identical to the old anchor
    // block. That proves no block straddles the anchor (e.g. a newly opened fence
    // that swallowed the following lines would NOT reproduce the old block there,
    // failing the check and causing us to widen). On success the old tail from `j`
    // onward is provably identical to a full re-parse by line-locality, so we
    // reuse it shifted and stop — having parsed only a bounded span past the edit.
    for (let j = firstTail; j < oldTokens.length; j++) {
        const anchorNewStart = oldTokens[j].start + delta;
        if (anchorNewStart < regionStart || anchorNewStart > newSrc.length) continue;
        const verifyEnd = (j + 1 < oldTokens.length ? oldTokens[j + 1].start : oldSrc.length) + delta;
        if (verifyEnd > newSrc.length) continue;

        const regionTokens = parser.parseRange(newSrc, regionStart, verifyEnd)
            .map((t) => shiftToken(t, regionStart));

        const anchorIdx = regionTokens.findIndex((t) => t.start === anchorNewStart);
        if (anchorIdx === -1) continue;
        if (!sameShape(regionTokens[anchorIdx], oldTokens[j])) continue;

        const body = regionTokens.slice(0, anchorIdx);
        const tail = oldTokens.slice(j).map((t) => shiftToken(t, delta));
        return {
            src: newSrc,
            tokens: [...head, ...body, ...tail],
            ...metadata,
        };
    }

    // No clean resync (edit effects reach EOF, or no reusable tail). Re-parse the
    // whole tail from regionStart. Still skips the untouched head; always correct.
    const fresh = parser.parseRange(newSrc, regionStart, newSrc.length).map((t) => shiftToken(t, regionStart));
    return {
        src: newSrc,
        tokens: [...head, ...fresh],
        ...metadata,
    };
}
