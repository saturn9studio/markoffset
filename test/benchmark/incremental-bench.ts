import { Bench } from 'tinybench';
import { commonmarkParser as parser } from '../../src/presets/commonmark';
import { parseDocument, reparse, Change } from '../../src/incremental';

// Generate a large (~30k word) document to make the cost of a full reparse per
// keystroke obvious.
const doc = generateMarkdownDoc(30000);

// Simulate a keystroke in the middle of the document: insert one character at a
// paragraph offset. The incremental reparser should touch only the surrounding
// block(s) while the full reparser re-scans the entire document.
const editOffset = Math.floor(doc.length / 2);
const change: Change = { from: editOffset, to: editOffset, insert: 'x' };

const newSrc = doc.slice(0, editOffset) + change.insert + doc.slice(editOffset);

// Pre-parse the baseline state once (this cost is amortized across keystrokes in
// a real editor, so it is excluded from the per-keystroke measurement).
const baseState = parseDocument(parser, doc);

// Sanity check: confirm the invariant holds for this benchmark scenario before
// reporting numbers, so we never advertise a speed-up for incorrect output.
const incrementalTokens = reparse(parser, baseState, change).tokens;
const fullTokens = parser.parse(newSrc);
if (JSON.stringify(incrementalTokens) !== JSON.stringify(fullTokens)) {
    throw new Error('Benchmark invariant violation: incremental output != full output');
}

const bench = new Bench({ time: 2000 });

bench
    .add('full reparse per keystroke', () => {
        parser.parse(newSrc);
    })
    .add('incremental reparse per keystroke', () => {
        reparse(parser, baseState, change);
    });

(async () => {
    console.log(`Document size: ${doc.length.toLocaleString()} chars, ${baseState.tokens.length} top-level blocks`);
    await bench.run();
    console.table(
        bench.tasks.map((t) => ({
            name: t.name,
            'ops/sec': Math.round(t.result!.hz).toLocaleString(),
            'avg (ms)': t.result!.mean.toFixed(4),
            'p99 (ms)': t.result!.p99.toFixed(4),
        }))
    );

    const full = bench.tasks.find((t) => t.name.startsWith('full'))!.result!.hz;
    const incr = bench.tasks.find((t) => t.name.startsWith('incremental'))!.result!.hz;
    console.log(`\nSpeed-up: ${(incr / full).toFixed(1)}x faster per keystroke`);
})();

function generateMarkdownDoc(wordCount: number): string {
    const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
                   'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur'];
    let result = '';
    let wc = 0;
    let para = 0;
    while (wc < wordCount) {
        if (para % 10 === 0) { result += `## Section ${Math.floor(para / 10) + 1}\n\n`; }
        if (para % 7 === 0) {
            result += '- item one with **bold** text\n- item two with *italic*\n- item three\n\n';
            wc += 12;
        } else if (para % 13 === 0) {
            result += '```js\nconst x = 42;\nconsole.log(x);\n```\n\n';
            wc += 6;
        } else {
            const sentenceWords = 15 + (para % 5);
            const sentence = Array.from(
                { length: sentenceWords },
                (_, i) => words[(i + para) % words.length]
            ).join(' ');
            result += sentence + '.\n\n';
            wc += sentenceWords;
        }
        para++;
    }
    return result;
}
