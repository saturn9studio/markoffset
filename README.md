# Markoffset

Fast, plugin-based Markdown parsing with source offsets.

Markoffset parses Markdown into immutable block-local token trees with exact
source ranges. It is designed for editor, analysis, linting, preview, and
transformation workflows that need structured Markdown without losing the
connection back to the original source text.

## Goals

- **Fast parsing** for interactive use, including editor feedback loops.
- **Source fidelity**: parsed blocks carry normalized document offsets, and
  every nested token carries an exact range relative to its block.
- **CommonMark and GFM coverage** through ready-to-use presets.
- **Incremental reparsing** for applying text edits without always reparsing the
  whole document.
- **Plugin-first design** so block rules, inline rules, delimiters, and
  document-wide extensions can be composed without changing parser core.

## Installation

```sh
npm install @saturn9/markoffset
```

Markoffset is published as a native ESM package for Node 18+ and modern
bundlers.

## Quick start

```ts
import { gfmParser, tokenViews } from '@saturn9/markoffset';

const blocks = gfmParser.parse(`# Hello

- [x] parse Markdown
- [ ] keep source offsets
`);

console.log(blocks[0].token);
console.log(tokenViews(blocks)[0]);
```

Each parsed block owns an absolute range in the normalized source and an
immutable token tree:

```ts
interface ParsedBlock {
    start: number;
    end: number;
    generated: boolean;
    token: Token;
}

interface Token {
    kind: string;
    start: number;
    end: number;
    generated?: boolean;
    content?: string;
    children?: Token[];
}
```

All ranges are half-open: `start` is inclusive and `end` is exclusive.
`ParsedBlock` offsets are measured against the source after line endings have
been normalized to `\n`. Token offsets are relative to the containing block, so
incremental reparsing can move an unchanged block without rebuilding its token
tree.

Source-backed blocks and token views have `generated: false`, and their ranges
resolve exactly into the normalized source. Extensions may emit generated
output that has no contiguous source span. Those blocks and all descendant
token views have `generated: true`; their ranges are stable anchors and must
not be used to slice source text. The GFM footnote list is generated output,
while each in-text `footnote_ref` remains source-backed.

Consumers implementing parser-compatible block adapters can use
`setextHeadingLevel(line)` to classify a CommonMark setext underline without
duplicating the parser's heading rules.

Use `tokenViews()` or `resolveToken()` when document-absolute token ranges are
needed:

```ts
import { resolveToken } from '@saturn9/markoffset';

const first = blocks[0];
const view = resolveToken(first);

console.log(source.slice(view.start, view.end));
```

Delimiter containers cover their complete source syntax. For `***text***`, the
outer emphasis range covers all three opening and closing markers, the nested
strong range covers `**text**`, and the text child covers `text`.

## Presets

Markoffset includes CommonMark and GitHub Flavored Markdown presets:

```ts
import { commonmarkParser, gfmParser } from '@saturn9/markoffset';
// Or import from explicit preset subpaths:
// import { commonmarkParser } from '@saturn9/markoffset/presets/commonmark';
// import { gfmParser } from '@saturn9/markoffset/presets/gfm';

const commonmarkBlocks = commonmarkParser.parse(markdown);
const gfmBlocks = gfmParser.parse(markdown);
```

The GFM preset layers extensions such as tables, task list items,
strikethrough, tag filtering, bare autolinks, link references, and footnotes on
top of the CommonMark-style core.

## Incremental parsing

For workloads that repeatedly apply text edits, keep a `ParseState` and call
`reparse` with each edit:

```ts
import { gfmParser, parseDocument, reparse } from '@saturn9/markoffset';

let state = parseDocument(gfmParser, initialMarkdown);

state = reparse(gfmParser, state, {
    from: 42,
    to: 47,
    insert: 'updated text',
});

console.log(state.blocks);
```

A change replaces the half-open range `[from, to)` in the previous source with
`insert`. Incremental parsing reparses a bounded block region and reuses
unchanged token trees before and after it. Moving an unchanged tail requires
updating only its block ranges; nested token trees remain immutable. Markoffset
falls back to a full parse only when document-wide syntax state changes, such as
link reference or footnote state that can affect earlier tokens.

## Custom parsers and plugins

The parser core is syntax-agnostic. Markdown behavior is supplied by block
rules, inline rules, delimiter rules, and document extensions.

```ts
import { commonmarkParser } from '@saturn9/markoffset';
import type { DelimiterRule } from '@saturn9/markoffset/core';

const highlight: DelimiterRule = {
    name: 'highlight',
    delimiter: '==',
    kind: 'highlight',
    bindingPower: 60,
};

export const parser = commonmarkParser.extend({
    inline: [highlight],
});
```

For lower-level composition, `createParser` accepts arrays of `BlockRule`,
`InlineRule`, `DelimiterRule`, and `ParserExtension` values.

```ts
import { createParser } from '@saturn9/markoffset/core';
import {
    createBlockquoteRule,
    createListRule,
    fence,
    heading,
    hr,
} from '@saturn9/markoffset/plugins/block';
import {
    autolink,
    codeInline,
    image,
    link,
    strongAsteriskDelimiter,
} from '@saturn9/markoffset/plugins/inline';
import { createLinkReferenceExtension } from '@saturn9/markoffset/plugins/references';

export const parser = createParser({
    block: [heading, fence, createBlockquoteRule(), createListRule(), hr],
    inline: [strongAsteriskDelimiter, codeInline, image, link, autolink],
    extensions: [createLinkReferenceExtension()],
});
```

Block rules that parse transformed or extracted content pass a `MappedSource`
to `BlockContext.parseInline()` or `BlockContext.parseBlocks()`. The core
exports helpers for contiguous, concatenated, and transformed source:

```ts
import { contiguousSource } from '@saturn9/markoffset/core';

const children = context.parseInline(
    contiguousSource(content, contentStart),
);
```

This keeps inline ranges connected to the original block source even when a
block rule removes markers, indentation, or prefixes before nested parsing.
The returned descendants are already relative to the containing parsed block.
If a rule creates additional structural child tokens directly from scanner
offsets, subtract `context.outputOffset` from those child ranges. The rule's
top-level token continues to use scanner offsets; Markoffset localizes that
root when it creates the `ParsedBlock`.

Public subpaths include:

- `@saturn9/markoffset/core`
- `@saturn9/markoffset/incremental`
- `@saturn9/markoffset/plugins`
- `@saturn9/markoffset/plugins/block`
- `@saturn9/markoffset/plugins/inline`
- `@saturn9/markoffset/plugins/references`
- `@saturn9/markoffset/plugins/footnotes`
- `@saturn9/markoffset/plugins/tagfilter`
- `@saturn9/markoffset/presets/commonmark`
- `@saturn9/markoffset/presets/gfm`

## Implementation notes

Markoffset uses a line-oriented block parser and a Pratt-style inline parser.
The block pass dispatches to ordered block rules, with a paragraph fallback. The
inline pass dispatches by trigger character and uses delimiter rules for nested
inline markup such as emphasis and strikethrough.

Nested block parsing carries compact source mappings for transformed content.
The mappings are resolved into one block-local coordinate space before a parsed
block is exposed. This keeps range lookup exact while allowing incremental
reparsing to reuse unchanged token trees without recursively shifting them.

Document-wide syntax, such as link reference definitions and footnote
definitions, is implemented with parser extensions. Extensions can prepare
document state, expose inline context, suppress definition lines from block
output, and finalize the emitted token tree.

## Development

```sh
npm ci
npm run build
npm run test
```

Benchmarks are available for full-document and incremental parsing:

```sh
npm run bench
npm run bench:incremental
```

## License

MIT
