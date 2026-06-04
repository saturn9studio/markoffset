import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { commonmarkParser } from '../../src/presets/commonmark.js';
import { renderToHtml } from './html-renderer.js';

interface SpecTest {
    markdown: string;
    html: string;
    example: number;
    section: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(__dirname, 'spec.json');
const spec: SpecTest[] = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

describe('CommonMark spec', () => {
    test.each(spec.map((t: SpecTest) => [t.example, t.section, t] as [number, string, SpecTest]))(
        'example %i (%s)',
        (_, __, t) => {
            const tokens = commonmarkParser.parse(t.markdown);
            const html = renderToHtml(tokens);
            expect(normalizeHtml(html)).toBe(normalizeHtml(t.html));
        }
    );
});

function normalizeHtml(html: string): string {
    return html.replace(/\r\n/g, '\n').replace(/\n+$/, '\n');
}
