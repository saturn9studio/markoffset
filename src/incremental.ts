import { ParsedBlock, Parser, Token } from './core/types.js';

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
 * to `\n`, exactly as the underlying parser sees it) and `blocks` are the
 * top-level parsed blocks for that source.
 */
export interface ParseState {
    src: string;
    blocks: ParsedBlock[];
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
        blocks: parser.parse(normalized),
        ...metadata,
    };
}

function shiftBlock(block: ParsedBlock, delta: number): ParsedBlock {
    if (delta === 0) return block;
    return {
        ...block,
        start: block.start + delta,
        end: block.end + delta,
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
    const oldBlocks = prev.blocks;
    const metadata = parser.incrementalMetadata(newSrc);

    if (
        prev.documentStateFingerprint !== metadata.documentStateFingerprint ||
        prev.requiresFullIncrementalReparse ||
        metadata.requiresFullIncrementalReparse
    ) {
        return {
            src: newSrc,
            blocks: parser.parse(newSrc),
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
    while (lastBefore < oldBlocks.length && oldBlocks[lastBefore].end < from) lastBefore++;
    const headEnd = Math.max(0, lastBefore - 1);

    // Region to re-parse begins at the start of the first non-head block (a
    // top-level line boundary), or document start if there is no head. This
    // offset is identical in old and new source because everything before it is
    // unchanged (the head blocks end before `from`).
    const regionStart = headEnd > 0 ? oldBlocks[headEnd].start : 0;

    const head = oldBlocks.slice(0, headEnd);

    // Candidate resync anchors: old blocks that start at/after `to` (their text
    // is unchanged by the edit). Each anchor's old start, shifted by `delta`,
    // is a position in the new source where the unchanged tail could resume.
    let firstTail = headEnd;
    while (firstTail < oldBlocks.length && oldBlocks[firstTail].start < to) firstTail++;

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
    for (let j = firstTail; j < oldBlocks.length; j++) {
        const anchorNewStart = oldBlocks[j].start + delta;
        if (anchorNewStart < regionStart || anchorNewStart > newSrc.length) continue;
        const verifyEnd = (j + 1 < oldBlocks.length ? oldBlocks[j + 1].start : oldSrc.length) + delta;
        if (verifyEnd > newSrc.length) continue;

        const regionBlocks = parser.parseRange(newSrc, regionStart, verifyEnd);

        const anchorIdx = regionBlocks.findIndex(block => block.start === anchorNewStart);
        if (anchorIdx === -1) continue;
        if (!sameShape(regionBlocks[anchorIdx].token, oldBlocks[j].token)) continue;

        const body = regionBlocks.slice(0, anchorIdx);
        const tail = oldBlocks.slice(j).map(block => shiftBlock(block, delta));
        return {
            src: newSrc,
            blocks: [...head, ...body, ...tail],
            ...metadata,
        };
    }

    // No clean resync (edit effects reach EOF, or no reusable tail). Re-parse the
    // whole tail from regionStart. Still skips the untouched head; always correct.
    const fresh = parser.parseRange(newSrc, regionStart, newSrc.length);
    return {
        src: newSrc,
        blocks: [...head, ...fresh],
        ...metadata,
    };
}
