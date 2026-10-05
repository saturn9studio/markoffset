import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { ParsedBlock, Token } from '../../src/core/types.js';
import { commonmarkParser } from '../../src/presets/commonmark.js';
import { gfmParser } from '../../src/presets/gfm.js';

interface SpecTest {
    markdown: string;
    html: string;
    example: number;
    section: string;
    extensions?: string[];
}

const SUPPORTED_GFM_EXTENSIONS = new Set(['table', 'strikethrough', 'autolink']);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readSpec(name: string): SpecTest[] {
    return JSON.parse(readFileSync(path.join(__dirname, name), 'utf-8'));
}

function semanticTokens(tokens: Token[]): unknown[] {
    return tokens.map(({ start: _start, end: _end, generated: _generated, children, ...token }) => ({
        ...token,
        ...(children ? { children: semanticTokens(children) } : {}),
    }));
}

function semanticBlocks(blocks: ParsedBlock[]): unknown[] {
    return semanticTokens(blocks.map(block => block.token));
}

function semanticHash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

describe('semantic parser baseline', () => {
    test('freezes CommonMark token semantics independently of source ranges', () => {
        const spec = readSpec('spec.json');
        const semantics = spec.map(example => [
            example.example,
            semanticBlocks(commonmarkParser.parse(example.markdown)),
        ]);

        expect(semanticHash(semantics))
            .toBe('1b362da5fe553f212534d2fccb23d43c0e109d1bd7ed87db0a4d2b0ed96bdd58');
    });

    test('freezes supported GFM extension token semantics independently of source ranges', () => {
        const official = readSpec('gfm.json').filter(example =>
            example.extensions?.some(extension =>
                SUPPORTED_GFM_EXTENSIONS.has(extension)
            )
        );
        const regressions = readSpec('gfm-extensions.json').filter(example =>
            example.html !== '<IGNORE>\n'
        );
        const semantics = [...official, ...regressions].map(example => [
            example.example,
            example.section,
            semanticBlocks(gfmParser.parse(example.markdown)),
        ]);

        expect(semanticHash(semantics))
            .toBe('9f336b7e13fffdbe1dd14e2f9f640c958d736c94468feaa62dcc5706621d0542');
    });
});
