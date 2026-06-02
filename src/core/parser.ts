import { BlockScanner } from './block-scanner';
import { decodeEntities } from './entities';
import { InlineContext } from './inline-context';
import {
    BlockRule,
    AnyInlineRule,
    DelimiterRule,
    InlineRule,
    Parser,
    ParserConfig,
    ParserExtensionState,
    Token,
    isDelimiterRule,
    BlockContext,
} from './types';
import { runDelimiterStack, RawItem } from './delimiter-stack';

export function createParser(config: ParserConfig): Parser {
    const blockRules = [...(config.block || [])].sort((a, b) => b.priority - a.priority);
    const fallbackBlockRules = blockRules.filter(rule => rule.startChars === undefined);
    const requiredCharBlockRules = blockRules.filter(rule => rule.requiredChars !== undefined);
    const delimRules = new Map<string, DelimiterRule[]>();

    // Build trigger table (128 entries, index = char code)
    const triggerTable: InlineRule[][] = Array.from({ length: 128 }, () => []);
    const rulesWithRequiredChars: InlineRule[] = [];
    // Also track delimiter chars for the delimiter stack
    const delimChars = new Uint8Array(128);

    for (const rule of config.inline || []) {
        if (isDelimiterRule(rule)) {
            const char = rule.delimiter[0];
            const rules = delimRules.get(char) ?? [];
            rules.push(rule);
            rules.sort((a, b) => b.delimiter.length - a.delimiter.length || b.bindingPower - a.bindingPower);
            delimRules.set(char, rules);
            const code = rule.delimiter.charCodeAt(0);
            if (code < 128) delimChars[code] = 1;
        } else {
            if (rule.requiredChars !== undefined) rulesWithRequiredChars.push(rule);
            for (const trigger of rule.triggers) {
                if (trigger < 128) triggerTable[trigger].push(rule);
            }
        }

    }

    // Fast pre-check for the paragraph-continuation "ruler loop": a line can
    // only interrupt a paragraph if its first non-space char could plausibly
    // start a block. Most prose lines start with a letter and can be skipped
    // without consulting every block rule. Conservative: any uncertainty falls
    // through to running the full rule match() loop.
    const blockStartChars = new Uint8Array(128);
    for (const rule of blockRules) {
        for (const ch of rule.startChars ?? '') {
            const code = ch.charCodeAt(0);
            if (code < 128) blockStartChars[code] = 1;
        }
    }

    function parseInlineContent(
        src: string,
        start: number,
        end: number,
        extensions: ReadonlyMap<string, unknown>
    ): Token[] {
        const parseInline = (content: string): Token[] =>
            parseInlineContent(content, 0, content.length, extensions);
        const ctx = new InlineContext(src, start, end, extensions, parseInline);
        const rawItems: RawItem[] = [];
        const inactiveRules = collectInactiveRules(src, start, end);
        let hasDelimiterRun = false;

        while (!ctx.atEnd()) {
            const code = ctx.peek();

            if (code === 0x0A) {
                const start = ctx.pos;
                ctx.advance();
                rawItems.push({ kind: 'softbreak', start, end: ctx.pos });
                continue;
            }

            // Check if this is a delimiter char
            if (code < 128 && delimChars[code] === 1) {
                const delimChar = String.fromCharCode(code);
                const runStart = ctx.pos;
                while (!ctx.atEnd() && ctx.peek() === code) ctx.advance();
                const runEnd = ctx.pos;
                rawItems.push({
                    kind: '__delim__',
                    start: runStart,
                    end: runEnd,
                    markup: delimChar,
                    level: runEnd - runStart,
                });
                hasDelimiterRun = true;
                continue;
            }

            // Escape handling: backslash before ASCII punctuation
            if (code === 0x5C && ctx.pos + 1 < ctx.end) {
                const nextCode = src.charCodeAt(ctx.pos + 1);
                if (isPunctCode(nextCode)) {
                    const textStart = ctx.pos;
                    ctx.advance(2);
                    rawItems.push({
                        kind: 'text',
                        start: textStart,
                        end: ctx.pos,
                        content: String.fromCharCode(nextCode),
                    });
                    continue;
                }
            }

            // Try inline rules
            if (code < 128 && triggerTable[code].length > 0) {
                let matched = false;
                for (const rule of triggerTable[code]) {
                    if (isInactiveRule(rule, inactiveRules)) continue;
                    if (rule.mayStart && !rule.mayStart(src, ctx.pos, ctx.end)) continue;
                    if (!rule.nud) continue;
                    const savedPos = ctx.pos;
                    const token = rule.nud(ctx);
                    if (token) {
                        rawItems.push({
                            kind: token.kind,
                            start: token.start,
                            end: token.end,
                            content: token.content,
                            markup: token.markup,
                            url: token.url,
                            title: token.title,
                            attrs: token.attrs,
                            children: token.children,
                        });
                        matched = true;
                        break;
                    }
                    // rule returned null — restore pos
                    ctx.pos = savedPos;
                }
                if (matched) continue;
            }

            // Accumulate text until the next interesting char. A char is
            // interesting if it could start a delimiter run, trigger an inline
            // rule, an escape, or a line break.
            // Codes >= 128 are never interesting and stay part of the text run.
            const textStart = ctx.pos;
            let scan = ctx.pos + 1;
            const scanEnd = ctx.end;
            while (scan < scanEnd) {
                const c = src.charCodeAt(scan);
                if (c < 128 && isInterestingAt(c, scan, scanEnd)) break;
                scan++;
            }
            ctx.pos = scan;
            const contentEnd = src.charCodeAt(scan) === 0x0A
                ? trimTrailingInlineWhitespace(src, textStart, scan)
                : scan;
            const content = src.slice(textStart, contentEnd);
            if (content === '') continue;
            rawItems.push({
                kind: 'text',
                start: textStart,
                end: scan,
                content: decodeEntities(content),
            });
        }

        // Process delimiter stack
        const resolved = hasDelimiterRun ? runDelimiterStack(src, rawItems, delimRules) : rawItems;

        return resolved;

        function isInterestingAt(code: number, pos: number, ruleEnd: number): boolean {
            if (delimChars[code] === 1 || code === 0x5C || code === 0x0A) return true;
            const rules = triggerTable[code];
            for (let index = 0; index < rules.length; index++) {
                const rule = rules[index];
                if (isInactiveRule(rule, inactiveRules)) continue;
                if (!rule.mayStart || rule.mayStart(src, pos, ruleEnd)) return true;
            }
            return false;
        }

        function collectInactiveRules(src: string, start: number, end: number): InlineRule[] | undefined {
            if (rulesWithRequiredChars.length === 0) return undefined;
            let inactive: InlineRule[] | undefined;
            for (const rule of rulesWithRequiredChars) {
                if (rule.requiredChars !== undefined && !containsAny(src, start, end, rule.requiredChars)) {
                    inactive ??= [];
                    inactive.push(rule);
                }
            }
            return inactive;
        }
    }

    // Conservative pre-check for the paragraph-continuation ruler loop. Skips
    // leading spaces and tabs, then tests whether the first non-blank char is
    // one that any block rule keys on. Returns true on any uncertainty (e.g. a
    // non-ASCII first char) so callers still run the full rule loop.
    function couldStartBlock(line: string): boolean {
        let i = 0;
        const len = line.length;
        while (i < len) {
            const c = line.charCodeAt(i);
            if (c !== 32 && c !== 9) break;
            i++;
        }
        if (i >= len) return false;
        const first = line.charCodeAt(i);
        if (first >= 128) return true;
        return blockStartChars[first] === 1;
    }

    function collectRequiredCharBlockRules(line: string, baseRules: BlockRule[]): BlockRule[] {
        if (requiredCharBlockRules.length === 0) return baseRules;
        let rules = baseRules;
        for (const rule of requiredCharBlockRules) {
            if (rule.requiredChars !== undefined && containsAny(line, 0, line.length, rule.requiredChars)) {
                if (rules === baseRules) rules = [...baseRules];
                rules.push(rule);
            }
        }
        return rules;
    }

    function parseBlocks(
        scanner: BlockScanner,
        definitionLineStarts: ReadonlySet<number>,
        extensions: ReadonlyMap<string, unknown>
    ): Token[] {
        const tokens: Token[] = [];
        const blockContext: BlockContext = {
            parseInline: (content: string) => parseInlineContent(content, 0, content.length, extensions),
            parseBlocks: (content: string) => parseNestedBlocks(content, extensions),
        };

        while (!scanner.atEnd()) {
            const line = scanner.currentLine();

            // Skip blank lines
            if (isBlankLine(line)) {
                scanner.advance();
                continue;
            }
            if (definitionLineStarts.has(scanner.currentLineStart())) {
                scanner.advance();
                continue;
            }

            // Try each block rule
            let matched = false;
            const candidateBlockRules = couldStartBlock(line)
                ? blockRules
                : collectRequiredCharBlockRules(line, fallbackBlockRules);
            for (const rule of candidateBlockRules) {
                if (rule.match(line, scanner)) {
                    const token = rule.parse(scanner, blockContext);
                    if (rule.inlineContent && token.content !== undefined && !token.children) {
                        token.children = parseInlineContent(token.content, 0, token.content.length, extensions);
                    }
                    tokens.push(token);
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                // Paragraph fallback: accumulate lines until blank line or block rule match
                const start = scanner.currentLineStart();
                const lines: string[] = [];
                let setextLevel: number | undefined;
                let setextEnd = start;
                while (!scanner.atEnd()) {
                    const l = scanner.currentLine();
                    if (isBlankLine(l)) break;
                    const underlineLevel = lines.length > 0 ? getSetextHeadingLevel(l) : undefined;
                    if (underlineLevel !== undefined) {
                        setextLevel = underlineLevel;
                        setextEnd = scanner.currentLineEnd();
                        scanner.advance();
                        break;
                    }
                    // Check if next line starts a new block (only if we have content already)
                    let blockedByRule = false;
                    if (lines.length > 0 && countLeadingSpaces(l) < 4 && couldStartBlock(l)) {
                        for (const rule of blockRules) {
                            if (rule.match(l, scanner) && (rule.canInterruptParagraph?.(l, scanner) ?? true)) {
                                blockedByRule = true;
                                break;
                            }
                        }
                    }
                    if (blockedByRule) break;
                    // Keep trailing spaces (they're significant for hardbreaks)
                    // but we'll trim the very last line after collecting all lines
                    lines.push(normalizeParagraphLine(l));
                    scanner.advance();

                }
                const end = setextLevel === undefined
                    ? (scanner.currentLineStart() > 0 ? scanner.currentLineStart() - 1 : start)
                    : setextEnd;
                // Trim trailing whitespace from the last line (not significant for hardbreaks)
                if (lines.length > 0) {
                    lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
                }
                const content = lines.join('\n');
                const token: Token = {
                    kind: setextLevel === undefined ? 'paragraph' : 'heading',
                    start,
                    end: Math.max(start, end),
                    content,
                };
                if (setextLevel !== undefined) token.level = setextLevel;
                token.children = parseInlineContent(content, 0, content.length, extensions);
                tokens.push(token);
            }
        }

        return tokens;
    }

    return {
        parse(src: string): Token[] {
            // Normalize line endings only when carriage returns are present,
            // so the common case (no \r) avoids two full-string regex passes.
            const normalized = normalizeLineEndings(src);
            const extensionStates = prepareExtensions(normalized, false);
            const tokens = parseRangeBlocks(normalized, 0, normalized.length, extensionStates);
            const parseBlocksForExtension = (content: string): Token[] => {
                const nestedExtensionStates = prepareExtensions(content, true);
                const nestedDefinitionLineStarts = new Set<number>();
                const nestedInlineContext = collectExtensionContext(nestedExtensionStates, nestedDefinitionLineStarts);
                return parseBlocks(new BlockScanner(content), nestedDefinitionLineStarts, nestedInlineContext);
            };
            return extensionStates.reduce(
                (current, state) => state.finalize?.(current, parseBlocksForExtension) ?? current,
                tokens
            );
        },
        parseRange(src: string, from: number, to: number): Token[] {
            const normalized = normalizeLineEndings(src);
            const safeFrom = Math.max(0, Math.min(from, normalized.length));
            const safeTo = Math.max(safeFrom, Math.min(to, normalized.length));
            return parseRangeBlocks(
                normalized,
                safeFrom,
                safeTo,
                prepareExtensions(normalized, false)
            );
        },
        incrementalMetadata(src: string) {
            const normalized = normalizeLineEndings(src);
            const extensionStates = prepareExtensions(normalized, false);
            return {
                documentStateFingerprint: stableStringify(extensionStates),
                requiresFullIncrementalReparse: extensionStates
                    .some(state => state.fullDocumentIncrementalReparse === true),
            };
        },
        extend(extra: ParserConfig): Parser {
            return createParser({
                block: [...(config.block || []), ...(extra.block || [])],
                inline: [...(config.inline || []), ...(extra.inline || [])],
                extensions: [...(config.extensions || []), ...(extra.extensions || [])],
            });
        },
    };

    function parseRangeBlocks(
        src: string,
        from: number,
        to: number,
        extensionStates: ParserExtensionState[],
    ): Token[] {
        const definitionLineStarts = new Set<number>();
        const inlineContext = collectExtensionContext(extensionStates, definitionLineStarts);
        const rangeDefinitionLineStarts = new Set(
            [...definitionLineStarts]
                .filter((lineStart) => lineStart >= from && lineStart < to)
                .map((lineStart) => lineStart - from)
        );
        return parseBlocks(
            new BlockScanner(src.slice(from, to)),
            rangeDefinitionLineStarts,
            inlineContext
        );
    }

    function parseNestedBlocks(content: string, parentContext: ReadonlyMap<string, unknown>): Token[] {
        const extensionStates = prepareExtensions(content, true);
        const definitionLineStarts = new Set<number>();
        const inlineContext = collectExtensionContext(extensionStates, definitionLineStarts, parentContext);
        return parseBlocks(new BlockScanner(content), definitionLineStarts, inlineContext);
    }

    function prepareExtensions(src: string, nested: boolean): ParserExtensionState[] {
        return (config.extensions ?? []).map(extension =>
            nested && extension.prepareNested ? extension.prepareNested(src) : extension.prepare(src)
        );
    }
}

function normalizeLineEndings(src: string): string {
    return src.indexOf('\r') === -1
        ? src
        : src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stableStringify(value: unknown): string {
    return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
    if (value instanceof Map) {
        return {
            kind: 'Map',
            entries: [...value.entries()]
                .map(([key, entryValue]) => [toStableValue(key), toStableValue(entryValue)])
                .sort(([left], [right]) => stableStringify(left).localeCompare(stableStringify(right))),
        };
    }

    if (value instanceof Set) {
        return {
            kind: 'Set',
            values: [...value.values()]
                .map(toStableValue)
                .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right))),
        };
    }

    if (Array.isArray(value)) return value.map(toStableValue);

    if (value !== null && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .filter(key => typeof (value as Record<string, unknown>)[key] !== 'function')
            .reduce<Record<string, unknown>>((acc, key) => ({
                ...acc,
                [key]: toStableValue((value as Record<string, unknown>)[key]),
            }), {});
    }

    return value;
}

function collectExtensionContext(
    states: ParserExtensionState[],
    definitionLineStarts: Set<number>,
    baseContext: ReadonlyMap<string, unknown> = new Map()
): ReadonlyMap<string, unknown> {
    const context = new Map(baseContext);
    for (const state of states) {
        for (const lineStart of state.definitionLineStarts ?? []) {
            definitionLineStarts.add(lineStart);
        }
        for (const [key, value] of state.inlineContext ?? []) {
            context.set(key, value);
        }
    }
    return context;
}

function isPunctCode(code: number): boolean {
    return (code >= 0x21 && code <= 0x2F)
        || (code >= 0x3A && code <= 0x40)
        || (code >= 0x5B && code <= 0x60)
        || (code >= 0x7B && code <= 0x7E);
}

function containsAny(src: string, start: number, end: number, chars: string): boolean {
    for (let index = 0; index < chars.length; index++) {
        const found = src.indexOf(chars[index], start);
        if (found !== -1 && found < end) return true;
    }
    return false;
}

function isInactiveRule(rule: InlineRule, inactiveRules: readonly InlineRule[] | undefined): boolean {
    if (inactiveRules === undefined) return false;
    for (let index = 0; index < inactiveRules.length; index++) {
        if (inactiveRules[index] === rule) return true;
    }
    return false;
}

function isBlankLine(line: string): boolean {
    for (let index = 0; index < line.length; index++) {
        const char = line.charCodeAt(index);
        if (char !== 32 && char !== 9) return false;
    }
    return true;
}

function trimTrailingInlineWhitespace(src: string, start: number, end: number): number {
    while (end > start) {
        const char = src.charCodeAt(end - 1);
        if (char !== 32 && char !== 9) break;
        end--;
    }
    return end;
}

function getSetextHeadingLevel(line: string): number | undefined {
    let i = 0;
    while (i < 3 && i < line.length && line.charCodeAt(i) === 32) i++;
    if (i >= line.length) return undefined;

    const marker = line.charCodeAt(i);
    if (marker !== 61 && marker !== 45) return undefined;

    let markerCount = 0;
    while (i < line.length && line.charCodeAt(i) === marker) {
        markerCount++;
        i++;
    }

    if (markerCount === 0) return undefined;

    while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
    if (i !== line.length) return undefined;

    return marker === 61 ? 1 : 2;
}

function normalizeParagraphLine(line: string): string {
    return line.trimStart();
}

function countLeadingSpaces(line: string): number {
    let spaces = 0;
    while (spaces < line.length && line.charCodeAt(spaces) === 32) spaces++;
    return spaces;
}
