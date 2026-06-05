import { InlineContext as IInlineContext, Token } from './types.js';

export class InlineContext implements IInlineContext {
    src: string;
    pos: number;
    end: number;
    extensions: ReadonlyMap<string, unknown>;
    parseInline: (src: string) => Token[];

    constructor(
        src: string,
        start: number,
        end: number,
        extensions: ReadonlyMap<string, unknown> = new Map(),
        parseInline: (src: string) => Token[] = () => []
    ) {
        this.src = src;
        this.pos = start;
        this.end = end;
        this.extensions = extensions;
        this.parseInline = parseInline;
    }

    atEnd(): boolean { return this.pos >= this.end; }
    peek(): number { return this.src.charCodeAt(this.pos); }
    advance(n = 1): void { this.pos += n; }
}
