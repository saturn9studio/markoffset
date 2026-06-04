import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { gfmParser } from '../../src/presets/gfm.js';
import { renderToHtml } from './html-renderer.js';

interface SpecTest {
    markdown: string;
    html: string;
    example: number;
    section: string;
    extensions?: string[];
}

const SUPPORTED_GFM_EXTENSIONS = new Set(['table', 'strikethrough', 'autolink']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.join(__dirname, 'gfm.json');
const spec: SpecTest[] = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
const extensionsPath = path.join(__dirname, 'gfm-extensions.json');
const extensionSpec: SpecTest[] = JSON.parse(fs.readFileSync(extensionsPath, 'utf-8'));

const gfmExtensionTests = spec.filter((t: SpecTest) =>
    t.extensions?.some(extension => SUPPORTED_GFM_EXTENSIONS.has(extension))
);
const extensionRegressionTests = extensionSpec.filter((t: SpecTest) =>
    t.html !== '<IGNORE>\n'
);
const ignoredOutputExtensionTests = extensionSpec.filter((t: SpecTest) =>
    t.html === '<IGNORE>\n'
);

describe('GFM spec extensions', () => {
    test.each(gfmExtensionTests.map((t: SpecTest) => [t.example, t.section, t] as [number, string, SpecTest]))(
        'official example %i (%s)',
        (_, __, t) => {
            const tokens = gfmParser.parse(t.markdown);
            const html = renderToHtml(tokens);
            expect(normalizeHtml(html)).toBe(normalizeHtml(t.html));
        }
    );
});

describe('cmark-gfm extension regression spec', () => {
    test.each(extensionRegressionTests.map((t: SpecTest) => [t.example, t.section, t] as [number, string, SpecTest]))(
        'example %i (%s)',
        (_, __, t) => {
            const tokens = gfmParser.parse(t.markdown);
            const html = renderToHtml(tokens);
            expect(normalizeHtml(html)).toBe(normalizeHtml(t.html));
        }
    );

    test.each(ignoredOutputExtensionTests.map((t: SpecTest) => [t.example, t.section, t] as [number, string, SpecTest]))(
        'crash-only example %i (%s)',
        (_, __, t) => {
            expect(() => gfmParser.parse(t.markdown)).not.toThrow();
        }
    );
});

function normalizeHtml(html: string): string {
    return html.replace(/\r\n/g, '\n').replace(/\n+$/, '\n');
}
