import { Bench } from 'tinybench';
import MarkdownIt from 'markdown-it';
import { marked } from 'marked';
import { commonmarkParser } from '../../src/presets/commonmark';
import { gfmParser } from '../../src/presets/gfm';

// Generate a synthetic ~5k word document for benchmarking
const doc = generateMarkdownDoc(5000);
const gfmDoc = generateGfmMarkdownDoc(5000);

// The markdown-it baselines are configured to do comparable syntax work instead
// of using the library default for both documents. CommonMark uses the
// CommonMark preset with optional conveniences disabled. The GFM comparison uses
// markdown-it's default preset with tables, strikethrough, and linkify enabled so
// it pays the cost of table parsing, delimiter parsing for strike, and bare URL
// detection. markdown-it still does not include task-list or footnote support by
// default; adding those would require third-party plugins and would make this
// less of a core-library comparison.
const markdownItCommonmark = new MarkdownIt('commonmark', {
    html: false,
    linkify: false,
    typographer: false,
});

const markdownItGfm = new MarkdownIt('default', {
    html: false,
    breaks: false,
    linkify: true,
    typographer: false,
});
markdownItGfm.enable(['table', 'strikethrough']);

const bench = new Bench({ time: 2000 });

bench
    .add('@saturn9/markoffset commonmark', () => {
        commonmarkParser.parse(doc);
    })
    .add('@saturn9/markoffset gfm', () => {
        gfmParser.parse(gfmDoc);
    })
    .add('markdown-it commonmark', () => {
        markdownItCommonmark.render(doc);
    })
    .add('markdown-it gfm+linkify', () => {
        markdownItGfm.render(gfmDoc);
    })
    .add('marked commonmark-ish', () => {
        marked.parse(doc, { gfm: false });
    })
    .add('marked gfm', () => {
        marked.parse(gfmDoc, { gfm: true });
    });

(async () => {
    await bench.run();
    console.table(
        bench.tasks.map(t => ({
            name: t.name,
            'ops/sec': Math.round(t.result!.hz).toLocaleString(),
            'avg (ms)': t.result!.mean.toFixed(3),
            'p99 (ms)': t.result!.p99.toFixed(3),
        }))
    );
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

function generateGfmMarkdownDoc(wordCount: number): string {
    const words = ['editor', 'parser', 'table', 'task', 'github', 'flavored', 'markdown',
                   'document', 'inline', 'autolink', 'strike', 'cell'];
    let result = '';
    let wc = 0;
    let para = 0;
    while (wc < wordCount) {
        if (para % 8 === 0) {
            result += '| feature | status | link |\n';
            result += '| :-- | :-: | --: |\n';
            result += `| tables | ~ready~ | www.example${para}.com |\n`;
            result += `| tasks | **done** | https://github.com/saturn9studio/editor/${para} |\n\n`;
            wc += 16;
        } else if (para % 5 === 0) {
            result += '- [ ] write tests\n- [x] parse GFM\n- [ ] benchmark autolinks\n\n';
            wc += 9;
        } else {
            const sentenceWords = 15 + (para % 5);
            const sentence = Array.from(
                { length: sentenceWords },
                (_, i) => words[(i + para) % words.length]
            ).join(' ');
            result += `${sentence} with ~~strikethrough~~ and www.github.com/${para}.\n\n`;
            wc += sentenceWords + 4;
        }
        para++;
    }
    return result;
}
