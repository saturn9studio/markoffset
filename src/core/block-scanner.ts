import { BlockScanner as IBlockScanner } from './types.js';

export class BlockScanner implements IBlockScanner {
    src: string;
    pos: number;       // start of current line
    lineStart: number;
    lineEnd: number;   // index of \n (or src.length if last line)
    private lineText: string;

    constructor(src: string) {
        this.src = src;
        this.pos = 0;
        this.lineStart = 0;
        this.lineEnd = this.findLineEnd(0);
        this.lineText = this.src.slice(this.lineStart, this.lineEnd);
    }

    private findLineEnd(from: number): number {
        const idx = this.src.indexOf('\n', from);
        return idx === -1 ? this.src.length : idx;
    }

    atEnd(): boolean {
        return this.pos >= this.src.length;
    }

    advance(): void {
        this.pos = this.lineEnd + 1;
        this.lineStart = this.pos;
        this.lineEnd = this.findLineEnd(this.pos);
        this.lineText = this.src.slice(this.lineStart, this.lineEnd);
    }

    currentLine(): string {
        return this.lineText;
    }

    currentLineStart(): number {
        return this.lineStart;
    }

    currentLineEnd(): number {
        return this.lineEnd;
    }

    // returns indent width of current line (spaces only)
    indent(): number {
        let i = this.lineStart;
        while (i < this.lineEnd && this.src.charCodeAt(i) === 32) i++;
        return i - this.lineStart;
    }
}
