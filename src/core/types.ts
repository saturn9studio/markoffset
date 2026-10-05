export interface Token {
    kind: string;
    start: number;     // offset in the containing parsed block (inclusive)
    end: number;       // offset in the containing parsed block (exclusive)
    generated?: boolean;
    // optional fields used by specific kinds
    level?: number;
    markup?: string;
    content?: string;
    info?: string;
    url?: string;
    title?: string;
    tight?: boolean;
    ordered?: boolean;
    startNum?: number;
    attrs?: TokenAttrs;
    children?: Token[];
}

export interface ParsedBlock {
    start: number;     // offset in normalized source (inclusive)
    end: number;       // offset in normalized source (exclusive)
    generated: boolean;
    token: Token;
}

export interface TokenView {
    token: Token;
    start: number;
    end: number;
    generated: boolean;
    children: TokenView[];
}

export type TokenAttrValue = string | number | boolean;
export type TokenAttrs = Record<string, TokenAttrValue>;

export interface SourceSegment {
    readonly localFrom: number;
    readonly localTo: number;
    readonly sourceFrom: number;
    readonly sourceTo: number;
}

export interface MappedSource {
    readonly text: string;
    readonly segments: readonly SourceSegment[];
    readonly emptySourceOffset: number;
}

export interface MappedSourcePart {
    readonly text: string;
    readonly sourceFrom: number;
    readonly sourceTo: number;
}

export interface BlockRule {
    name: string;
    priority: number;
    startChars?: string;
    requiredChars?: string;
    match(line: string, scanner: BlockScanner): boolean;
    canInterruptParagraph?(line: string, scanner: BlockScanner): boolean;
    parse(scanner: BlockScanner, context: BlockContext): Token;
}

export interface BlockContext {
    readonly outputOffset: number;
    parseInline(source: MappedSource): Token[];
    parseBlocks(source: MappedSource): Token[];
}

export interface DelimiterRule {
    name: string;
    delimiter: string;   // e.g. "**", "*", "~~"
    kind: string;        // token kind to emit
    bindingPower: number;
    canMatch?(match: DelimiterMatch): boolean;
}

export interface DelimiterMatch {
    openerRunLength: number;
    closerRunLength: number;
    openerCanOpenAndClose: boolean;
    closerCanOpenAndClose: boolean;
}

export interface InlineRule {
    name: string;
    triggers: number[];  // char codes
    requiredChars?: string;
    bindingPower: number;
    mayStart?(src: string, pos: number, end: number): boolean;
    nud?(ctx: InlineContext): Token | null;
    led?(left: Token, ctx: InlineContext): Token | null;
}

export type AnyInlineRule = DelimiterRule | InlineRule;

export function isDelimiterRule(r: AnyInlineRule): r is DelimiterRule {
    return 'delimiter' in r;
}

// Forward declare to resolve circular refs
export interface BlockScanner {
    src: string;
    pos: number;
    lineStart: number;
    lineEnd: number;
    atEnd(): boolean;
    advance(): void;
    currentLine(): string;
    currentLineStart(): number;
    currentLineEnd(): number;
    indent(): number;
}

export interface InlineContext {
    src: string;
    pos: number;
    end: number;
    extensions: ReadonlyMap<string, unknown>;
    parseInline(from: number, to: number): Token[];
    atEnd(): boolean;
    peek(): number;
    advance(n?: number): void;
}

export interface Parser {
    parse(src: string): ParsedBlock[];
    parseRange(src: string, from: number, to: number): ParsedBlock[];
    incrementalMetadata(src: string): ParserIncrementalMetadata;
    extend(config: ParserConfig): Parser;
}

export interface ParserIncrementalMetadata {
    documentStateFingerprint: string;
    requiresFullIncrementalReparse: boolean;
}

export interface ParserExtensionState {
    definitionLineStarts?: ReadonlySet<number>;
    inlineContext?: ReadonlyMap<string, unknown>;
    fullDocumentIncrementalReparse?: boolean;
    finalize?(tokens: Token[], parseBlocks: (src: string) => Token[]): Token[];
}

export interface ParserExtension {
    name: string;
    prepare(src: string): ParserExtensionState;
    prepareNested?(src: string): ParserExtensionState;
}

export interface ParserConfig {
    block?: BlockRule[];
    inline?: AnyInlineRule[];
    extensions?: ParserExtension[];
}
