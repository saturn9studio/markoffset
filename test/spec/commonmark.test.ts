import * as fs from 'fs';
import * as path from 'path';
import { commonmarkParser } from '../../src/presets/commonmark';
import { renderToHtml } from './html-renderer';

interface SpecTest {
    markdown: string;
    html: string;
    example: number;
    section: string;
}

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
