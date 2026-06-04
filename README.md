# Markoffset

Fast, plugin-based Markdown parsing with source offsets.

Markoffset parses Markdown into a token tree where every token carries source
character offsets. It is designed for editor, analysis, linting, preview, and
transformation workflows that need structured Markdown without losing the
connection back to the original source text.

## Goals

- **Fast parsing** for interactive use, including editor feedback loops.
- **Source fidelity**: tokens include `start` and `end` offsets into the
  normalized source string.
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
import { gfmParser } from '@saturn9/markoffset';

const tokens = gfmParser.parse(`# Hello

- [x] parse Markdown
- [ ] keep source offsets
`);

console.log(tokens[0]);
```

Tokens are plain objects:

```ts
interface Token {
    kind: string;
    start: number;
    end: number;
    content?: string;
    children?: Token[];
}
```

`start` is inclusive and `end` is exclusive. Offsets are measured against the
source string after line endings have been normalized to `\n`.

## Presets

Markoffset includes CommonMark and GitHub Flavored Markdown presets:

```ts
import { commonmarkParser, gfmParser } from '@saturn9/markoffset';
// Or import from explicit preset subpaths:
// import { commonmarkParser } from '@saturn9/markoffset/presets/commonmark';
// import { gfmParser } from '@saturn9/markoffset/presets/gfm';

const commonmarkTokens = commonmarkParser.parse(markdown);
const gfmTokens = gfmParser.parse(markdown);
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

console.log(state.tokens);
```

A change replaces the half-open range `[from, to)` in the previous source with
`insert`. Incremental parsing reuses unchanged block tokens where it can, and
falls back to a full parse when document-wide syntax state changes, such as link
reference or footnote state that can affect earlier tokens.

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
