import { createParser } from '../core/parser.js';
import { heading } from '../plugins/block/heading.js';
import { fence } from '../plugins/block/fence.js';
import { gfmHtmlBlock } from '../plugins/block/html-block.js';
import { indentedCode } from '../plugins/block/indented-code.js';
import { hr } from '../plugins/block/hr.js';
import { createBlockquoteRule } from '../plugins/block/blockquote.js';
import { createTaskListRule } from '../plugins/block/task-list.js';
import { createTableRule } from '../plugins/block/table.js';
import {
    emAsteriskDelimiter,
    emUnderscoreDelimiter,
    strongAsteriskDelimiter,
    strongUnderscoreDelimiter,
} from '../plugins/inline/strong-em.js';
import { strikethrough, strikethroughDouble } from '../plugins/inline/strikethrough.js';
import { codeInline } from '../plugins/inline/code-inline.js';
import { link } from '../plugins/inline/link.js';
import { image } from '../plugins/inline/image.js';
import { autolink } from '../plugins/inline/autolink.js';
import { gfmAutolink, gfmEmailAutolink } from '../plugins/inline/gfm-autolink.js';
import { gfmHtmlInline } from '../plugins/inline/html-inline.js';
import { hardbreak } from '../plugins/inline/hardbreak.js';
import { footnote } from '../plugins/inline/footnote.js';
import { createFootnotesExtension } from '../plugins/footnotes.js';
import { createLinkReferenceExtension } from '../plugins/references.js';

export const gfmParser = createParser({
    block: [
        gfmHtmlBlock,
        heading,
        fence,
        hr,
        createTableRule(),
        createBlockquoteRule(),
        createTaskListRule(),
        indentedCode,
    ],
    inline: [
        strongAsteriskDelimiter,
        emAsteriskDelimiter,
        strongUnderscoreDelimiter,
        emUnderscoreDelimiter,
        strikethroughDouble,
        strikethrough,
        codeInline,
        footnote,
        image,
        link,
        autolink,
        gfmHtmlInline,
        gfmAutolink,
        gfmEmailAutolink,
        hardbreak,
    ],
    extensions: [createLinkReferenceExtension(), createFootnotesExtension()],
});
