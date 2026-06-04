import { createParser } from '../core/parser.js';
import { heading } from '../plugins/block/heading.js';
import { fence } from '../plugins/block/fence.js';
import { htmlBlock } from '../plugins/block/html-block.js';
import { indentedCode } from '../plugins/block/indented-code.js';
import { hr } from '../plugins/block/hr.js';
import { createBlockquoteRule } from '../plugins/block/blockquote.js';
import { createListRule } from '../plugins/block/list.js';
import {
    emAsteriskDelimiter,
    emUnderscoreDelimiter,
    strongAsteriskDelimiter,
    strongUnderscoreDelimiter,
} from '../plugins/inline/strong-em.js';
import { codeInline } from '../plugins/inline/code-inline.js';
import { link } from '../plugins/inline/link.js';
import { image } from '../plugins/inline/image.js';
import { autolink } from '../plugins/inline/autolink.js';
import { htmlInline } from '../plugins/inline/html-inline.js';
import { hardbreak } from '../plugins/inline/hardbreak.js';
import { createLinkReferenceExtension } from '../plugins/references.js';

export const commonmarkParser = createParser({
    block: [htmlBlock, heading, fence, hr, createBlockquoteRule(), createListRule(), indentedCode],
    inline: [
        strongAsteriskDelimiter,
        emAsteriskDelimiter,
        strongUnderscoreDelimiter,
        emUnderscoreDelimiter,
        codeInline,
        image,   // image before link (both triggered by '[' but image needs '!' before)
        link,
        autolink,
        htmlInline,
        hardbreak,
    ],
    extensions: [createLinkReferenceExtension()],
});
