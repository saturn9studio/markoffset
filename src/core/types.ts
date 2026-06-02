export interface Token {
    kind: string;
    start: number;     // offset in source (inclusive)
    end: number;       // offset in source (exclusive)
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

export type TokenAttrValue = string | number | boolean;
export type TokenAttrs = Record<string, TokenAttrValue>;

export interface BlockRule {
    name: string;
    priority: number;
    startChars?: string;
    requiredChars?: string;
    inlineContent?: boolean;
    match(line: string, scanner: BlockScanner): boolean;
    canInterruptParagraph?(line: string, scanner: BlockScanner): boolean;
    parse(scanner: BlockScanner, context: BlockContext): Token;
}

export interface BlockContext {
    parseInline(src: string): Token[];
    parseBlocks(src: string): Token[];
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
    parseInline(src: string): Token[];
    atEnd(): boolean;
    peek(): number;
    advance(n?: number): void;
}

export interface Parser {
    parse(src: string): Token[];
    parseRange(src: string, from: number, to: number): Token[];
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
