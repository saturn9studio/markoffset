import { Token, DelimiterRule } from './types.js';

// Delimiter run encountered during inline scanning
interface DelimRun {
    char: string;           // '*', '_', '~', '='
    start: number;          // position in source
    origCount: number;      // original number of chars in run
    count: number;          // remaining (not yet matched) chars
    canOpen: boolean;
    canClose: boolean;
    // index in the all-items array (set when building)
    itemIdx: number;
    runIdx: number;
}

// An item in the inline token stream before delimiter resolution
export interface RawItem {
    kind: string;   // 'text', '__delim__', or any inline token kind
    start: number;
    end: number;
    content?: string;
    markup?: string;
    level?: number; // for __delim__: count of delimiter chars
    // other fields for non-delim tokens
    url?: string;
    title?: string;
    info?: string;
    attrs?: Token['attrs'];
    children?: Token[];
}

function isWhitespace(ch: number): boolean {
    return ch === 0x20 || ch === 0x09 || ch === 0x0A || ch === 0x0D || ch === 0x0C
        || ch === 0x00A0 || ch === 0x1680
        || (ch >= 0x2000 && ch <= 0x200A)
        || ch === 0x202F || ch === 0x205F || ch === 0x3000;
}

function isPunct(ch: number): boolean {
    if ((ch >= 0x21 && ch <= 0x2F) || (ch >= 0x3A && ch <= 0x40)
        || (ch >= 0x5B && ch <= 0x60) || (ch >= 0x7B && ch <= 0x7E)) return true;
    if (ch >= 0x2000 && ch <= 0x206F) return true;
    if (ch === 0x00A3 || ch === 0x00A5 || ch === 0x20AC) return true;
    if (ch >= 0x3000 && ch <= 0x303F) return true;
    return false;
}

function getCanOpenClose(src: string, start: number, count: number, char: string): { canOpen: boolean; canClose: boolean } {
    const end = start + count;
    const before = start > 0 ? src.charCodeAt(start - 1) : -1;
    const after = end < src.length ? src.charCodeAt(end) : -1;
    const bWS = before < 0 || isWhitespace(before);
    const bP  = before >= 0 && isPunct(before);
    const aWS = after < 0  || isWhitespace(after);
    const aP  = after >= 0  && isPunct(after);

    const leftFlanking  = !aWS && (!aP || bWS || bP);
    const rightFlanking = !bWS && (!bP || aWS || aP);

    if (char === '_') {
        const canOpen  = leftFlanking  && (!rightFlanking || bP);
        const canClose = rightFlanking && (!leftFlanking  || aP);
        return { canOpen, canClose };
    }
    return { canOpen: leftFlanking, canClose: rightFlanking };
}

// Represents a matched emphasis/strong span
interface MatchedSpan {
    openerRunIdx: number;    // index in delimRuns
    closerRunIdx: number;    // index in delimRuns
    openerOffset: number;    // how many chars consumed from opener's END (growing from right)
    closerOffset: number;    // how many chars consumed from closer's START (growing from left)
    useCount: number;        // number of delimiters used
    kind: string;            // 'em' | 'strong' | 'strikethrough' | ...
    markup: string;
}

/**
 * Run the CommonMark delimiter stack algorithm.
 */
export function runDelimiterStack(
    src: string,
    rawItems: RawItem[],
    delimRules: Map<string, DelimiterRule[]>
): Token[] {
    // Step 1: Separate raw items into non-delim tokens and delimiter runs
    // We build a flat list of "items" where each item is either a token or a delim run
    // Delimiter runs are tracked separately for matching

    interface Item {
        isDelim: false;
        token: Token;
    }
    interface DelimItem {
        isDelim: true;
        run: DelimRun;
    }
    type ListItem = Item | DelimItem;

    const items: ListItem[] = [];
    const delimRuns: DelimRun[] = [];

    for (const raw of rawItems) {
        if (raw.kind !== '__delim__') {
            const tok: Token = {
                kind: raw.kind,
                start: raw.start,
                end: raw.end,
            };
            if (raw.content !== undefined) tok.content = raw.content;
            if (raw.markup !== undefined) tok.markup = raw.markup;
            if (raw.url !== undefined) tok.url = raw.url;
            if (raw.title !== undefined) tok.title = raw.title;
            if (raw.attrs !== undefined) tok.attrs = raw.attrs;
            if (raw.children !== undefined) tok.children = raw.children;
            items.push({ isDelim: false, token: tok });
        } else {
            const char = raw.markup!;
            const count = raw.level!;
            const start = raw.start;
            const { canOpen, canClose } = getCanOpenClose(src, start, count, char);
            const run: DelimRun = {
                char,
                start,
                origCount: count,
                count,
                canOpen,
                canClose,
                itemIdx: items.length,
                runIdx: delimRuns.length,
            };
            delimRuns.push(run);
            items.push({ isDelim: true, run });
        }
    }

    if (delimRuns.length === 0) {
        const tokens: Token[] = [];
        for (const item of items) {
            if (!item.isDelim) tokens.push(item.token);
        }
        return tokens;
    }

    // Step 2: Match delimiter runs using the CommonMark algorithm
    // For each closer, find the nearest opener of the same char with remaining count > 0
    // Process in the order the closers appear (left-to-right)

    // We maintain a list of open openers per char type (as stacks)
    const openerStacks = new Map<string, number[]>(); // char -> indices into delimRuns[]
    const bottomOfStack = new Map<string, number>();  // char -> min index in openerStacks

    // Collect all matched spans
    const matchedSpans: MatchedSpan[] = [];

    for (let ci = 0; ci < delimRuns.length; ci++) {
        const closer = delimRuns[ci];
        if (!closer.canClose) {
            if (closer.canOpen) {
                const stack = openerStacks.get(closer.char) || [];
                stack.push(ci);
                openerStacks.set(closer.char, stack);
            }
            continue;
        }

        // Find matching opener
        const stack = openerStacks.get(closer.char) || [];
        const bottom = bottomOfStack.get(closer.char) ?? 0;
        let matchedOpenerIdx = -1;
        let matchedStackPos = -1;
        let matchedRule: DelimiterRule | null = null;

        // Search backwards through the opener stack
        for (let si = stack.length - 1; si >= 0; si--) {
            const oi = stack[si];
            if (oi < bottom) break;
            const opener = delimRuns[oi];
            if (!opener.canOpen || opener.count === 0) continue;

            const rule = selectDelimiterRule(opener, closer, delimRules);
            if (rule !== null) {
                matchedOpenerIdx = oi;
                matchedStackPos = si;
                matchedRule = rule;
                break;
            }
        }

        if (matchedOpenerIdx === -1) {
            // No opener found
            if (!closer.canOpen) {
                // This closer can never open anything; update bottom to prevent
                // future closers from matching openers before this point
                bottomOfStack.set(closer.char, stack.length);
            } else {
                // Can also open: push as potential opener
                stack.push(ci);
                openerStacks.set(closer.char, stack);
            }
            continue;
        }

        // Found a match
        const opener = delimRuns[matchedOpenerIdx];

        const rule = matchedRule;
        if (rule === null) continue;
        const useCount = rule.delimiter.length;
        const kind = rule.kind;
        const markup = rule.delimiter;

        // Record the match
        matchedSpans.push({
            openerRunIdx: matchedOpenerIdx,
            closerRunIdx: ci,
            openerOffset: opener.count - useCount,  // where in the opener the match starts (from start)
            closerOffset: closer.origCount - closer.count,  // where in the closer the match starts (from start)
            useCount,
            kind,
            markup,
        });

        // Consume from opener and closer
        opener.count -= useCount;
        closer.count -= useCount;

        // If opener is fully consumed, remove from stack
        if (opener.count === 0) {
            stack.splice(matchedStackPos, 1);
            openerStacks.set(closer.char, stack);
        }

        // Unmatched openers between a matched opener and closer cannot match
        // later delimiters without crossing this span.
        for (const [char, openers] of openerStacks) {
            let write = 0;
            for (let read = 0; read < openers.length; read++) {
                const openerIndex = openers[read];
                if (openerIndex <= matchedOpenerIdx || openerIndex >= ci) {
                    openers[write] = openerIndex;
                    write++;
                }
            }
            openers.length = write;
            openerStacks.set(char, openers);
        }

        // If closer still has remaining count, re-process it as a potential closer
        // by NOT advancing ci (but we will need to re-check it)
        if (closer.count > 0) {
            ci--; // will be incremented by the for loop
        }

        // If closer also can open and has remaining, push as opener
        if (closer.count > 0 && closer.canOpen) {
            // handled on next iteration (ci--)
        }
    }

    // For any remaining openers (not matched), push as openers if they canOpen
    // (they'll become text tokens in the final output)

    // Step 3: Build the output token tree from matched spans
    // We need to build a nested structure based on the spans

    // Sort spans by: opener position, then closer position (for nesting)
    // Actually, the spans are naturally ordered by the algorithm (innermost first due to backwards search)
    // We need to build a tree: outer spans contain inner spans

    // Build the token tree using a recursive approach
    // For each item in the original list, determine which span it belongs to

    // We'll use a different approach: process the items array in order,
    // using a stack to track open spans

    // Create a lookup: for each delim run index, what span starts/ends here?
    // An opener span at runIdx X means: items between X and the closer are children
    // A closer span at runIdx X means: collect children and create token

    interface OpenSpan {
        span: MatchedSpan;
        childStartItemIdx: number; // first item index AFTER the opener delimiter chars
        children: Token[];
    }

    const openerSpansByRun: (MatchedSpan[] | undefined)[] = [];
    const closerSpansByRun: (MatchedSpan[] | undefined)[] = [];
    for (const span of matchedSpans) {
        (openerSpansByRun[span.openerRunIdx] ??= []).push(span);
        (closerSpansByRun[span.closerRunIdx] ??= []).push(span);
    }

    const result: Token[] = [];
    const spanStack: OpenSpan[] = [];

    // Helper to add token to current context (either result or top of spanStack)
    function addToken(tok: Token): void {
        if (spanStack.length > 0) {
            spanStack[spanStack.length - 1].children.push(tok);
        } else {
            result.push(tok);
        }
    }

    // For each item, process it
    // We need to handle the fact that a delimiter run may be partially consumed
    // by multiple spans (e.g., *** -> em wrapping strong)

    // Process delimiter runs by their position in the items array
    // For each item:
    // - If it's a non-delim token: add to current context
    // - If it's a delim run: process based on matched spans

    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
        const item = items[itemIdx];

        if (!item.isDelim) {
            addToken(item.token);
            continue;
        }

        const run = item.run;
        // This run may participate in multiple matches
        // Find all spans where this run is the opener or closer
        const asOpenerSpans = openerSpansByRun[run.runIdx];
        const asCloserSpans = closerSpansByRun[run.runIdx];

        // Track position within the run's original characters
        // The run contributes: [unmatched leading chars] [opener chars for nested spans] [unmatched trailing chars]
        // For opener: matched chars are at the END of the run (closer chars from start)
        // For closer: matched chars are at the START of the run

        if (asOpenerSpans !== undefined && asOpenerSpans.length > 0) {
            // This run is an opener for some spans
            // Opener chars are consumed from the END of the run
            // Unmatched chars at the start become text

            // Count total chars consumed as opener
            const openerConsumed = asOpenerSpans.reduce((sum, s) => sum + s.useCount, 0);
            const unmatchedStart = run.origCount - openerConsumed;

            if (unmatchedStart > 0) {
                // Emit unmatched chars at start as text
                addToken({
                    kind: 'text',
                    start: run.start,
                    end: run.start + unmatchedStart,
                    content: run.char.repeat(unmatchedStart),
                });
            }

            // Push each opener span onto the stack (innermost first = last in array)
            // Opener spans are ordered by how deeply they consume from the end
            // Sort by useCount descending (strong before em if both start from end)
            // Actually, the first span to match is the outermost
            // If *** is opener for both strong (2 chars) and em (1 char):
            // - strong uses chars at positions origCount-2, origCount-1
            // - em uses char at position origCount-3 (if any remain)
            // The spans are in the order they were matched; the first match is the innermost
            // (because we search backwards for opener, so the closest opener is matched first)
            // For ***, the closer *** first matches 2 chars (strong) then 1 char (em)
            // So spans[0] = strong (matched first), spans[1] = em (matched second)
            // The strong is the INNER span (its content is between the inner delimiters)
            // The em is the OUTER span (wrapping the strong)

            // Push in REVERSE order: first matched span = innermost = goes on top of stack last
            // (outer spans pushed first, inner spans pushed last so they're on top)
            // For ***: span0=strong (inner, matched first), span1=em (outer, matched second)
            // We push em first, then strong. strong is on top → foo goes into strong.
            for (let si = asOpenerSpans.length - 1; si >= 0; si--) {
                spanStack.push({
                    span: asOpenerSpans[si],
                    childStartItemIdx: itemIdx + 1,
                    children: [],
                });
            }
        } else if (asCloserSpans !== undefined && asCloserSpans.length > 0) {
            // This run is a closer for some spans
            // Closer chars are consumed from the START of the run

            // Close spans in order (first match = innermost)
            for (const span of asCloserSpans) {
                // Find the matching open span in the stack
                const stackIdx = spanStack.findIndex(s => s.span === span);
                if (stackIdx === -1) continue;

                // Pop all spans above this one (they're nested inside)
                // Everything between the current stack top and this span is already in children
                const openSpan = spanStack.splice(stackIdx, 1)[0];

                const newToken: Token = {
                    kind: span.kind,
                    start: run.start,  // approximate
                    end: run.start + span.useCount,
                    markup: span.markup,
                    children: openSpan.children,
                };

                addToken(newToken);
            }

            // Emit any unmatched chars at end of closer as text
            const closerConsumed = asCloserSpans.reduce((sum, s) => sum + s.useCount, 0);
            const unmatchedEnd = run.origCount - closerConsumed;
            if (unmatchedEnd > 0) {
                addToken({
                    kind: 'text',
                    start: run.start + closerConsumed,
                    end: run.start + run.origCount,
                    content: run.char.repeat(unmatchedEnd),
                });
            }
        } else {
            // Unmatched delimiter run → text
            if (run.origCount > 0) {
                addToken({
                    kind: 'text',
                    start: run.start,
                    end: run.start + run.origCount,
                    content: run.char.repeat(run.origCount),
                });
            }
        }
    }

    // Close any unclosed spans (shouldn't happen in valid input)
    for (const openSpan of spanStack) {
        // Emit the delimiter chars as text
        const run = openSpan.span.openerRunIdx;
        const delimRun = delimRuns[run];
        addToken({
            kind: 'text',
            start: delimRun.start,
            end: delimRun.start + delimRun.origCount,
            content: delimRun.char.repeat(delimRun.origCount),
        });
        for (const child of openSpan.children) {
            result.push(child);
        }
    }

    return result;
}

function selectDelimiterRule(
    opener: DelimRun,
    closer: DelimRun,
    delimRules: Map<string, DelimiterRule[]>
): DelimiterRule | null {
    const rules = delimRules.get(closer.char) ?? [];
    return rules.find(rule => {
        const length = rule.delimiter.length;
        if (opener.count < length || closer.count < length) return false;
        if (rule.delimiter !== closer.char.repeat(length)) return false;
        return rule.canMatch?.({
            openerRunLength: opener.origCount,
            closerRunLength: closer.origCount,
            openerCanOpenAndClose: opener.canOpen && opener.canClose,
            closerCanOpenAndClose: closer.canOpen && closer.canClose,
        }) ?? true;
    }) ?? null;
}
